"""技能服务（07 §6、05 §4 / §6 / §7、05 §11）。

事务边界（与 T06 的 projects 同形）：一次写操作里的**标量字段、站外链接、
作品关系与 version 在同一个事务里提交**；发布门槛校验与状态改变也同事务完成。
中途任何校验失败都在 `commit()` 之前抛出，因此不会留下「状态改了但关系没换」的半成品。

公开条件（写在 SQL 里，而不是浏览器里）：

    status = 'published' AND deleted_at IS NULL AND published_at <= now()

**「合体」筛选**（07 §6「选择两个技能，展示同时使用它们的已发布作品」、任务卡执行清单）：

  - 只返回**同时**关联二者的**当前公开**作品 —— 两个 `project_skills` 连接各自约束一个
    技能，因此是交集而不是并集；
  - 同一技能选两次不返回「全部作品冒充合体」，而是明确报错（由 router 在参数层挡住，
    service 这里再兜一层，防止别的调用方绕过）；
  - 未发布技能 = 不存在：`skill_for_combo()` 只认公开技能，草稿 / 已删除 / 未到发布时间
    一律当作「找不到」；
  - 撤回作品后它立刻从交集里消失（公开条件是**当前**状态，不缓存）；
  - 空交集**是正常结果**：返回空列表 + 一句「还没有对应作品」，
    **绝不**用 AI 或模板编造一件新作品顶替（07 §6 末段）。

**同一关系来源**（验收 2）：技能 → 作品与作品 → 技能都只读 `project_skills` 这一张表。
`projects_for_skill()` 与 `skills_for_project()` 是它的两个方向，不存在第二份关系数据。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from datetime import datetime

from sqlalchemy import Select, delete, insert, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import CODE_CONFLICT, CODE_NOT_FOUND, ApiError
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.preconditions import require_version
from app.core.text import normalize_for_match
from app.modules.projects.models import (
    MAINTENANCE_LABELS,
    Project,
)
from app.modules.projects.service import (
    public_conditions as project_public_conditions,
)
from app.modules.skills.models import (
    DOMAIN_OTHER,
    MAX_PROJECTS_PER_SKILL,
    SKILL_DOMAINS,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Skill,
    project_skills,
)
from app.modules.skills.schemas import (
    COMBO_MAX_ITEMS,
    SkillProjectRefOut,
    SkillProjectRelationIn,
    SkillProjectRelationOut,
    normalize_skill_links,
)

COMBO_EMPTY_NOTE = "还没有同时用到这两个技能的公开作品。"


def not_found(message: str = "技能不存在或不可访问") -> ApiError:
    """公开读不到与管理读不到统一用它 —— 不区分「不存在」与「无权」。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """业务冲突：slug 占用、关系重复、发布门槛不满足（05 §9 的 409）。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


# --- 查询基础 ---------------------------------------------------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        Skill.status == STATUS_PUBLISHED,
        Skill.deleted_at.is_(None),
        Skill.published_at.is_not(None),
        Skill.published_at <= moment,
    ]


def _filter_fingerprint(domain: str | None) -> str:
    return filter_fingerprint({"domain": domain})


def list_public_skills(
    session: Session,
    *,
    domain: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[Skill], str | None]:
    """公开全书列表，`(position ASC, name ASC, id ASC)` + 不透明游标。

    排序键是站主手动维护的展示顺序（07 §8「展示顺序」）：`position` 允许重复，
    重复时用 (name, id) 稳定收尾，因此翻页不会漏项也不会重复。
    筛选指纹包含 `domain`：换领域后继续用旧游标 → 400（05 §6）。
    """
    bounded = clamp_limit(limit)
    fingerprint = _filter_fingerprint(domain)

    statement: Select = select(Skill).where(*public_conditions(now))
    if domain:
        statement = statement.where(Skill.domain == domain)
    if cursor:
        sort_position, sort_name, entity_id = _decode_skill_cursor(cursor, fingerprint)
        # 三键游标：position 相同时继续用 (name, id) 向后，不漏不重。
        statement = statement.where(
            tuple_(Skill.position, Skill.name, Skill.id)
            > tuple_(sort_position, sort_name, entity_id)
        )
    statement = (
        statement.order_by(Skill.position.asc(), Skill.name.asc(), Skill.id.asc())
        .limit(bounded + 1)
    )
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = _encode_skill_cursor(
            position=int(last.position), name=last.name, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


# 技能列表的排序键是三元组（position / name / id），比 05 §6 的 `(published_at, id)`
# 多一维。`core.pagination` 的游标只承载「一个时刻 + 一个 UUID」，因此这里用一个同形的
# 本地编码器：载荷字段名与 core 保持一致（v / f 版本与指纹），
# 排序值放在 `k`（一个 JSON 数组）里。这样「换筛选后旧游标 → 400」的语义完全一样。
CURSOR_VERSION = 1


def _encode_skill_cursor(*, position: int, name: str, entity_id: uuid.UUID, fingerprint: str) -> str:
    import base64
    import json

    payload = {
        "v": CURSOR_VERSION,
        "f": fingerprint,
        "k": [int(position), str(name), str(entity_id)],
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_skill_cursor(cursor: str, fingerprint: str) -> tuple[int, str, uuid.UUID]:
    import base64
    import binascii
    import json

    from app.core.errors import CODE_VALIDATION_FAILED

    message = "游标无效，请从第一页重新开始"
    candidate = (cursor or "").strip()
    if not candidate or len(candidate) > 512:
        raise ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})
    try:
        payload = json.loads(base64.urlsafe_b64decode(candidate + "=" * (-len(candidate) % 4)))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise ApiError(
            CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]}
        ) from None
    if not isinstance(payload, dict) or payload.get("v") != CURSOR_VERSION:
        raise ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})
    if payload.get("f") != fingerprint:
        detail = "游标与当前筛选条件不一致，请从第一页重新开始"
        raise ApiError(
            CODE_VALIDATION_FAILED, detail, status_code=400, fields={"cursor": [detail]}
        )
    key = payload.get("k")
    if not isinstance(key, list) or len(key) != 3:
        raise ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})
    try:
        return int(key[0]), str(key[1]), uuid.UUID(str(key[2]))
    except (TypeError, ValueError):
        raise ApiError(
            CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]}
        ) from None


def get_public_skill(
    session: Session, slug: str, *, now: datetime | None = None
) -> Skill | None:
    """按 slug 取公开技能。草稿 / 已删除 / 未到发布时间 / 不存在统一返回 None。"""
    if not slug or len(slug) > 200:
        return None
    return (
        session.execute(select(Skill).where(Skill.slug == slug, *public_conditions(now)))
        .scalars()
        .first()
    )


def get_admin_skill(session: Session, skill_id: uuid.UUID) -> Skill | None:
    """管理读取：任何状态都能取到，但已软删除的不再返回。"""
    return (
        session.execute(
            select(Skill).where(Skill.id == skill_id, Skill.deleted_at.is_(None))
        )
        .scalars()
        .first()
    )


def get_skill_by_slug(session: Session, slug: str) -> Skill | None:
    return session.execute(select(Skill).where(Skill.slug == slug)).scalars().first()


def list_admin_skills(
    session: Session,
    *,
    status: str | None = None,
    domain: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Skill], str | None]:
    """管理列表：草稿与已发布都在，按 `(position ASC, name ASC, id ASC)` 排序。"""
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint({"scope": "admin", "status": status, "domain": domain})

    statement: Select = select(Skill).where(Skill.deleted_at.is_(None))
    if status:
        statement = statement.where(Skill.status == status)
    if domain:
        statement = statement.where(Skill.domain == domain)
    if cursor:
        sort_position, sort_name, entity_id = _decode_skill_cursor(cursor, fingerprint)
        statement = statement.where(
            tuple_(Skill.position, Skill.name, Skill.id)
            > tuple_(sort_position, sort_name, entity_id)
        )
    statement = (
        statement.order_by(Skill.position.asc(), Skill.name.asc(), Skill.id.asc())
        .limit(bounded + 1)
    )
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = _encode_skill_cursor(
            position=int(last.position), name=last.name, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


# --- 关系读取（唯一关系来源：project_skills）--------------------------------


def relation_rows_for_skills(
    session: Session, skill_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, int]]]:
    """按技能取关系行（`(project_id, position)`），**不过滤**作品状态（管理用）。"""
    wanted = list(dict.fromkeys(skill_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(project_skills.c.skill_id, project_skills.c.project_id, project_skills.c.position)
        .where(project_skills.c.skill_id.in_(wanted))
        .order_by(project_skills.c.skill_id.asc(), project_skills.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[tuple[uuid.UUID, int]]] = {}
    for skill_id, project_id, position in rows:
        grouped.setdefault(skill_id, []).append((project_id, int(position)))
    return grouped


def public_project_rows_for_skills(
    session: Session, skill_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, list[Project]]:
    """公开用：只返回**当前公开**的作品，按技能内的 position 排序。

    这是「技能全书展示哪些证据」的唯一来源；撤回的作品不会出现在这里。
    """
    wanted = list(dict.fromkeys(skill_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(project_skills.c.skill_id, Project, project_skills.c.position)
        .join(Project, Project.id == project_skills.c.project_id)
        .where(project_skills.c.skill_id.in_(wanted), *project_public_conditions(now))
        .order_by(project_skills.c.skill_id.asc(), project_skills.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[Project]] = {}
    for skill_id, project, _position in rows:
        grouped.setdefault(skill_id, []).append(project)
    return grouped


def project_count_for_skill(
    session: Session, skill_id: uuid.UUID, *, now: datetime | None = None
) -> int:
    """当前公开关联作品数（实时统计，不缓存为列）。"""
    return len(public_project_rows_for_skills(session, [skill_id], now=now).get(skill_id, []))


def project_counts_for_skills(
    session: Session, skill_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, int]:
    grouped = public_project_rows_for_skills(session, skill_ids, now=now)
    return {skill_id: len(items) for skill_id, items in grouped.items()}


def project_refs_out(
    session: Session, skill_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, list[SkillProjectRefOut]]:
    """技能 → 公开作品引用（批量，避免列表页 N+1）。"""
    grouped = public_project_rows_for_skills(session, skill_ids, now=now)
    return {
        skill_id: [project_ref(project) for project in projects]
        for skill_id, projects in grouped.items()
    }


def project_ref(project: Project) -> SkillProjectRefOut:
    return SkillProjectRefOut(
        id=project.id,
        slug=project.slug,
        title=project.title,
        summary=project.summary or "",
        maintenance=str(project.maintenance),
        maintenance_label=MAINTENANCE_LABELS.get(str(project.maintenance), ""),
        published_at=project.published_at,
    )


def tech_overlap(projects: Sequence[Project], skill_name: str) -> list[str]:
    """当前公开关联作品的技术栈里，与本技能**同名**的项（只读一致性诊断）。

    同名 = `normalize_for_match`（NFKC + trim + 大小写折叠 + 空白折叠）后相等。
    这不是一份要维护的数据：技能表不存技术标签副本，因此不存在
    「技能写 FastAPI、作品写 fastapi」两边各自维护不同事实的问题 ——
    两边本来就不同名，这里如实报告「没有对得上的技术项」。
    """
    needle = normalize_for_match(skill_name)
    if not needle:
        return []
    found: list[str] = []
    for project in projects:
        for item in project.tech_stack or []:
            text = str(item)
            if normalize_for_match(text) == needle and text not in found:
                found.append(text)
    return found


# --- 「合体」筛选 -----------------------------------------------------------


def skill_for_combo(
    session: Session, slug: str, *, now: datetime | None = None
) -> Skill | None:
    """把 slug 解析成一个**当前公开**技能；未发布 / 已删除 / 不存在都返回 None。

    公开侧不区分这几种情况（否则可以用「草稿技能」探测站主还没发布的东西）。

    slug 先过 `normalize_for_match`：手机端复制的链接可能带首尾空白或全角字符，
    归一化后「同一个技能」不会因为写法不同被当成两个不同技能
    （否则 `a=前端&b= 前端 ` 会绕过「重复选择」的校验）。
    """
    candidate = normalize_for_match(slug)
    if not candidate:
        return None
    return get_public_skill(session, candidate, now=now)


def combo_projects(
    session: Session,
    skill_a: Skill,
    skill_b: Skill,
    *,
    now: datetime | None = None,
) -> list[Project]:
    """**同时**关联两个技能的当前公开作品（交集），按 `(published_at DESC, id DESC)` 排序。

    两个连接各自约束一个技能：这是 SQL 层的交集，不是「先查 A 再在 Python 里过滤」
    那种会随数据量退化的写法，也不存在把并集冒充交集的余地。
    """
    if skill_a.id == skill_b.id:
        raise conflict(
            "「合体」需要两个不同的技能",
            {"b": ["不能和技能 A 选同一个技能"]},
        )
    alias_a = project_skills.alias("ps_a")
    alias_b = project_skills.alias("ps_b")
    statement = (
        select(Project)
        .join(alias_a, alias_a.c.project_id == Project.id)
        .join(alias_b, alias_b.c.project_id == Project.id)
        .where(
            alias_a.c.skill_id == skill_a.id,
            alias_b.c.skill_id == skill_b.id,
            *project_public_conditions(now),
        )
        .order_by(Project.published_at.desc(), Project.id.desc())
        .limit(COMBO_MAX_ITEMS)
    )
    return list(session.execute(statement).scalars().all())


def combo_note(count: int) -> str:
    """空交集的文案（**明确无结果，不用 AI 编造新作品**）。"""
    if count == 0:
        return COMBO_EMPTY_NOTE
    return ""


# --- 作品侧（同一个关系来源的另一个方向）-----------------------------------


def skills_for_project(
    session: Session, project_id: uuid.UUID, *, now: datetime | None = None
) -> list[Skill]:
    """当前公开技能里，关联到这件作品的（作品详情「使用的技能」用）。

    与 `projects_for_skill()` 读同一张 `project_skills`、同一套公开条件，
    因此两个方向不可能给出互相矛盾的答案（验收 2）。
    """
    return list(
        session.execute(
            select(Skill)
            .join(project_skills, project_skills.c.skill_id == Skill.id)
            .where(project_skills.c.project_id == project_id, *public_conditions(now))
            .order_by(Skill.position.asc(), Skill.name.asc(), Skill.id.asc())
        )
        .scalars()
        .all()
    )


def skills_for_projects(
    session: Session, project_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, list[Skill]]:
    wanted = list(dict.fromkeys(project_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(project_skills.c.project_id, Skill)
        .join(Skill, Skill.id == project_skills.c.skill_id)
        .where(project_skills.c.project_id.in_(wanted), *public_conditions(now))
        .order_by(
            project_skills.c.project_id.asc(),
            Skill.position.asc(),
            Skill.name.asc(),
            Skill.id.asc(),
        )
    ).all()
    grouped: dict[uuid.UUID, list[Skill]] = {}
    for project_id, skill in rows:
        grouped.setdefault(project_id, []).append(skill)
    return grouped


def public_skill_exists_for_project(session: Session, project_id: uuid.UUID) -> bool:
    return bool(skills_for_project(session, project_id))


# --- 写入校验 ---------------------------------------------------------------


def _as_relation(entry: SkillProjectRelationIn | dict) -> SkillProjectRelationIn:
    if isinstance(entry, SkillProjectRelationIn):
        return entry
    return SkillProjectRelationIn.model_validate(entry)


def _normalize_relations(
    session: Session, entries: Iterable[SkillProjectRelationIn | dict]
) -> list[SkillProjectRelationIn]:
    """校验作品引用：数量、重复、position、作品真实存在。

    允许关联**草稿**作品：站主可以先建技能再等作品发布；公开侧由
    `public_project_rows_for_skills()` 的公开条件兜底，草稿作品不会露出来
    （与 projects 允许关联草稿专题同形）。
    """
    normalized = [_as_relation(entry) for entry in entries]
    if len(normalized) > MAX_PROJECTS_PER_SKILL:
        raise conflict(
            f"一个技能最多关联 {MAX_PROJECTS_PER_SKILL} 件作品",
            {"projects": [f"最多 {MAX_PROJECTS_PER_SKILL} 件"]},
        )
    project_ids = [entry.project_id for entry in normalized]
    if len(set(project_ids)) != len(project_ids):
        raise conflict("同一件作品不能重复关联", {"projects": ["project_id 重复"]})
    positions = [entry.position for entry in normalized]
    if len(set(positions)) != len(positions):
        raise conflict("关联顺序不能重复", {"projects": ["position 重复"]})
    if not project_ids:
        return normalized
    found = set(
        session.execute(select(Project.id).where(Project.id.in_(project_ids))).scalars().all()
    )
    missing = [str(pid) for pid in project_ids if pid not in found]
    if missing:
        raise conflict("关联的作品不存在", {"projects": missing})
    return normalized


def _replace_relations(
    session: Session, skill: Skill, entries: Sequence[SkillProjectRelationIn]
) -> None:
    """完整替换作品关系（05 §7）。调用方已完成校验。"""
    session.execute(delete(project_skills).where(project_skills.c.skill_id == skill.id))
    session.flush()
    for entry in sorted(entries, key=lambda item: item.position):
        session.execute(
            insert(project_skills).values(
                skill_id=skill.id, project_id=entry.project_id, position=entry.position
            )
        )


def _check_slug_available(
    session: Session, slug: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    statement = select(Skill.id).where(Skill.slug == slug)
    if exclude_id is not None:
        statement = statement.where(Skill.id != exclude_id)
    if session.execute(statement).first() is not None:
        raise conflict("这个 slug 已被占用", {"slug": ["已存在同 slug 的技能"]})


def _commit(session: Session) -> None:
    """提交并把完整性冲突翻译成可读错误，而不是 500。"""
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - 正常情况下由上面的校验拦住
        session.rollback()
        raise conflict(
            "数据约束冲突，请检查 slug、关联作品与顺序", {"body": [type(exc).__name__]}
        ) from None


def _normalize_scalar(patch: dict, name: str, *, max_length: int) -> None:
    value = patch.get(name)
    if value is None:
        return
    text = str(value).strip()
    if len(text) > max_length:
        raise conflict(f"{name} 超过 {max_length} 个字符", {name: [f"最多 {max_length} 个字符"]})
    patch[name] = text


# --- 管理写入 ---------------------------------------------------------------


def create_skill(
    session: Session,
    *,
    slug: str,
    name: str,
    domain: str = DOMAIN_OTHER,
    scope: str = "",
    evidence: str = "",
    links: Sequence[dict] | None = None,
    position: int = 0,
    projects: Sequence[SkillProjectRelationIn | dict] | None = None,
) -> Skill:
    """新建**草稿**（与 moments / nav / projects 一致：创建总是草稿）。"""
    normalized_slug = slug.strip()
    _check_slug_available(session, normalized_slug)
    if domain not in SKILL_DOMAINS:
        raise conflict("技能领域不合法", {"domain": [f"只能是 {' / '.join(SKILL_DOMAINS)}"]})
    relation_list = _normalize_relations(session, projects or [])

    skill = Skill(
        slug=normalized_slug,
        name=name.strip(),
        domain=domain,
        scope=(scope or "").strip(),
        evidence=(evidence or "").strip(),
        links=normalize_skill_links(list(links or [])),
        position=int(position),
        status=STATUS_DRAFT,
        published_at=None,
    )
    session.add(skill)
    session.flush()
    if relation_list:
        _replace_relations(session, skill, relation_list)
    _commit(session)
    return skill


def update_skill(session: Session, skill: Skill, *, patch: dict, if_match: str | None) -> Skill:
    """按 `If-Match` 更新。传入 `links` / `projects` 时**完整替换**。

    冲突（412）时不做任何修改：调用方负责保留未保存输入（05 §7）。
    """
    require_version(skill.version, if_match)

    raw_relations = patch.get("projects")
    normalized_relations = (
        None if raw_relations is None else _normalize_relations(session, raw_relations)
    )
    if patch.get("domain") is not None and patch["domain"] not in SKILL_DOMAINS:
        raise conflict("技能领域不合法", {"domain": [f"只能是 {' / '.join(SKILL_DOMAINS)}"]})

    for field_name, max_length in (("name", 80), ("scope", 1000), ("evidence", 2000)):
        if field_name in patch:
            _normalize_scalar(patch, field_name, max_length=max_length)

    for field_name in ("name", "scope", "evidence"):
        if field_name in patch and patch[field_name] is not None:
            setattr(skill, field_name, patch[field_name])
    if "domain" in patch and patch["domain"] is not None:
        skill.domain = patch["domain"]
    if "position" in patch and patch["position"] is not None:
        skill.position = int(patch["position"])
    if "links" in patch and patch["links"] is not None:
        skill.links = normalize_skill_links(patch["links"])
    if normalized_relations is not None:
        _replace_relations(session, skill, normalized_relations)

    skill.bump_version()
    _commit(session)
    return skill


def publish_skill(session: Session, skill: Skill, *, if_match: str | None) -> Skill:
    """发布门槛（07 §6「不自封数值等级」的反面：要发布就得给证据）。

    与 projects 的差别是**门槛落在证据而不是图片**：技能没有自己的媒体，
    它的证据是文字说明与（可选的）站外链接，因此这里要求
    「掌握证据非空」，而不是要求一张图。
    刻意**不要求**关联作品非空：「还没有对应作品」是 07 §6 明确允许的正常状态
    （合体筛选的空交集文案就是为它准备的），逼站主随便挂一件作品更糟。
    """
    require_version(skill.version, if_match)

    if not skill.evidence.strip():
        raise conflict("发布前需要填写掌握证据", {"evidence": ["不能为空"]})
    if not skill.scope.strip():
        # 「范围说明」是能力卡解释「这门技能管到哪儿」的那一句；
        # 没有它，卡片只剩名称，与 07 §6「不自封数值等级」的替代方案相矛盾。
        raise conflict("发布前需要填写范围说明", {"scope": ["不能为空"]})

    skill.status = STATUS_PUBLISHED
    skill.published_at = utcnow()
    skill.bump_version()
    _commit(session)
    return skill


def unpublish_skill(session: Session, skill: Skill, *, if_match: str | None) -> Skill:
    """撤回：回到 draft，**清空发布时间**。作品关系保留，便于改完再发。"""
    require_version(skill.version, if_match)
    skill.status = STATUS_DRAFT
    skill.published_at = None
    skill.bump_version()
    _commit(session)
    return skill


def soft_delete_skill(session: Session, skill: Skill, *, if_match: str | None) -> None:
    """软删除。作品关系随 `project_skills` 的 CASCADE 清理；作品本身不受影响。"""
    require_version(skill.version, if_match)
    skill.deleted_at = utcnow()
    skill.status = STATUS_DRAFT
    skill.published_at = None
    skill.bump_version()
    _commit(session)


# --- 管理组合输出 -----------------------------------------------------------


def admin_relations_out(
    session: Session, skill_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[SkillProjectRelationOut]]:
    """管理回执：按 position 返回关系，并带上作品标题与状态（含草稿）。"""
    grouped = relation_rows_for_skills(session, skill_ids)
    project_ids = [project_id for rows in grouped.values() for project_id, _ in rows]
    titles: dict[uuid.UUID, Project] = {}
    if project_ids:
        titles = {
            project.id: project
            for project in session.execute(
                select(Project).where(Project.id.in_(list(dict.fromkeys(project_ids))))
            ).scalars()
        }
    result: dict[uuid.UUID, list[SkillProjectRelationOut]] = {}
    for skill_id, rows in grouped.items():
        payloads: list[SkillProjectRelationOut] = []
        for project_id, position in rows:
            project = titles.get(project_id)
            if project is None:
                # 作品行被物理删除（理论上被 FK CASCADE 清理）：如实跳过，不伪造标题。
                continue
            payloads.append(
                SkillProjectRelationOut(
                    project_id=project_id,
                    slug=project.slug,
                    title=project.title,
                    status=str(project.status),
                    position=position,
                )
            )
        result[skill_id] = payloads
    return result


__all__ = [
    "COMBO_EMPTY_NOTE",
    "admin_relations_out",
    "clamp_limit",
    "combo_note",
    "combo_projects",
    "conflict",
    "create_skill",
    "get_admin_skill",
    "get_public_skill",
    "get_skill_by_slug",
    "list_admin_skills",
    "list_public_skills",
    "not_found",
    "project_count_for_skill",
    "project_counts_for_skills",
    "project_ref",
    "project_refs_out",
    "public_conditions",
    "public_project_rows_for_skills",
    "public_skill_exists_for_project",
    "publish_skill",
    "relation_rows_for_skills",
    "skill_for_combo",
    "skills_for_project",
    "skills_for_projects",
    "soft_delete_skill",
    "tech_overlap",
    "unpublish_skill",
    "update_skill",
]
