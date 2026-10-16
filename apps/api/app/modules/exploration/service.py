"""问题记录服务（07 §6「印象空间」、05 §4 / §6 / §7）。

事务边界（与本包 skills、T06 projects 同形）：一次写操作里的**标量字段、结果链接、
文章 / 作品关系、工作状态与 version 在同一个事务里提交**；发布门槛校验与状态改变
也同事务完成。

公开条件（写在 SQL 里，而不是浏览器里）：

    status = 'published' AND deleted_at IS NULL AND published_at <= now()

**工作状态与发布状态相互独立**（任务卡执行清单）：

  - 公开条件**只看** `status`，不看 `work_status`：一条「待探索」的记录可以公开，
    一条「已解决」的记录也可以是草稿。两者正交，各有用例。
  - 「已解决」不自动等于公开（验收 3）：把 `work_status` 改成 `resolved` **不会**
    改动 `status`，也不会让记录出现在任何公开列表 / 统计 / 链接摘要里。
  - 「已解决」必须有实际结果说明（任务卡要求）：`outcome` 不能只有空白，
    否则 409。`resolved_at` 由服务端在进入「已解决」时写入，离开时清空 ——
    与数据库的 `ck_exploration_records_resolved_at_valid` 一致。

**撤回关联内容时不泄漏隐藏标题**（验收 3）：

  - 关系表只存 `post_id` / `project_id` 与顺序，**没有标题快照**；
  - 公开读取时用 posts / projects 的公开条件解析，解析不到就整条丢弃，
    连「（已隐藏）」这样的占位都不留 —— 那本身就是泄漏（读者会知道有东西被藏了）。
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
from app.modules.exploration.models import (
    MAX_POSTS_PER_RECORD,
    MAX_PROJECTS_PER_RECORD,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    WORK_RESOLVED,
    WORK_STATUSES,
    ExplorationRecord,
    exploration_record_posts,
    exploration_record_projects,
)
from app.modules.exploration.schemas import (
    RelatedPostOut,
    RelatedPostRelationIn,
    RelatedPostRelationOut,
    RelatedProjectOut,
    RelatedProjectRelationIn,
    RelatedProjectRelationOut,
    normalize_evidence_links,
)
from app.modules.posts.models import Post
from app.modules.posts.service import public_conditions as post_public_conditions
from app.modules.projects.models import Project
from app.modules.projects.service import public_conditions as project_public_conditions

POST_HREF_PREFIX = "/posts/"
PROJECT_HREF_PREFIX = "/showcase/projects/"


def not_found(message: str = "问题记录不存在或不可访问") -> ApiError:
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


# --- 查询基础 ---------------------------------------------------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        ExplorationRecord.status == STATUS_PUBLISHED,
        ExplorationRecord.deleted_at.is_(None),
        ExplorationRecord.published_at.is_not(None),
        ExplorationRecord.published_at <= moment,
    ]


def _filter_fingerprint(work_status: str | None) -> str:
    return filter_fingerprint({"work_status": work_status})


def list_public_records(
    session: Session,
    *,
    work_status: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[ExplorationRecord], str | None]:
    """公开列表，`(published_at DESC, id DESC)` + 不透明游标（与 05 §6 一致）。

    筛选指纹包含 `work_status`：换工作状态后继续用旧游标 → 400（05 §6）。
    """
    bounded = clamp_limit(limit)
    fingerprint = _filter_fingerprint(work_status)

    statement: Select = select(ExplorationRecord).where(*public_conditions(now))
    if work_status:
        statement = statement.where(ExplorationRecord.work_status == work_status)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(ExplorationRecord.published_at, ExplorationRecord.id)
            < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(
        ExplorationRecord.published_at.desc(), ExplorationRecord.id.desc()
    ).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.published_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_record(
    session: Session, slug: str, *, now: datetime | None = None
) -> ExplorationRecord | None:
    """按 slug 取公开记录。草稿 / 已删除 / 未到发布时间 / 不存在统一返回 None。"""
    if not slug or len(slug) > 200:
        return None
    return (
        session.execute(
            select(ExplorationRecord).where(
                ExplorationRecord.slug == slug, *public_conditions(now)
            )
        )
        .scalars()
        .first()
    )


def get_admin_record(session: Session, record_id: uuid.UUID) -> ExplorationRecord | None:
    return (
        session.execute(
            select(ExplorationRecord).where(
                ExplorationRecord.id == record_id, ExplorationRecord.deleted_at.is_(None)
            )
        )
        .scalars()
        .first()
    )


def get_record_by_slug(session: Session, slug: str) -> ExplorationRecord | None:
    return (
        session.execute(
            select(ExplorationRecord).where(ExplorationRecord.slug == slug)
        )
        .scalars()
        .first()
    )


def list_admin_records(
    session: Session,
    *,
    status: str | None = None,
    work_status: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[ExplorationRecord], str | None]:
    """管理列表：草稿与已发布都在，按 `(created_at DESC, id DESC)` 排序。"""
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint(
        {"scope": "admin", "status": status, "work_status": work_status}
    )

    statement: Select = select(ExplorationRecord).where(ExplorationRecord.deleted_at.is_(None))
    if status:
        statement = statement.where(ExplorationRecord.status == status)
    if work_status:
        statement = statement.where(ExplorationRecord.work_status == work_status)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(ExplorationRecord.created_at, ExplorationRecord.id)
            < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(
        ExplorationRecord.created_at.desc(), ExplorationRecord.id.desc()
    ).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.created_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def public_work_status_counts(
    session: Session, *, now: datetime | None = None
) -> dict[str, int]:
    """当前公开记录按工作状态的分布（只统计公开记录，不泄漏草稿数量）。"""
    rows = session.execute(
        select(ExplorationRecord.work_status).where(*public_conditions(now))
    ).scalars()
    counts = {status: 0 for status in WORK_STATUSES}
    for status in rows:
        counts[str(status)] = counts.get(str(status), 0) + 1
    return counts


# --- 关系读取 ---------------------------------------------------------------


def post_relation_rows(
    session: Session, record_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, int]]]:
    wanted = list(dict.fromkeys(record_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(
            exploration_record_posts.c.record_id,
            exploration_record_posts.c.post_id,
            exploration_record_posts.c.position,
        )
        .where(exploration_record_posts.c.record_id.in_(wanted))
        .order_by(
            exploration_record_posts.c.record_id.asc(),
            exploration_record_posts.c.position.asc(),
        )
    ).all()
    grouped: dict[uuid.UUID, list[tuple[uuid.UUID, int]]] = {}
    for record_id, post_id, position in rows:
        grouped.setdefault(record_id, []).append((post_id, int(position)))
    return grouped


def project_relation_rows(
    session: Session, record_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, int]]]:
    wanted = list(dict.fromkeys(record_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(
            exploration_record_projects.c.record_id,
            exploration_record_projects.c.project_id,
            exploration_record_projects.c.position,
        )
        .where(exploration_record_projects.c.record_id.in_(wanted))
        .order_by(
            exploration_record_projects.c.record_id.asc(),
            exploration_record_projects.c.position.asc(),
        )
    ).all()
    grouped: dict[uuid.UUID, list[tuple[uuid.UUID, int]]] = {}
    for record_id, project_id, position in rows:
        grouped.setdefault(record_id, []).append((project_id, int(position)))
    return grouped


def public_posts_for_records(
    session: Session, record_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, list[RelatedPostOut]]:
    """公开用：只返回**当前公开**的文章（草稿 / 撤回的文章整条丢弃，不留占位）。"""
    grouped = post_relation_rows(session, record_ids)
    wanted = [post_id for rows in grouped.values() for post_id, _ in rows]
    if not wanted:
        return {}
    posts = {
        post.id: post
        for post in session.execute(
            select(Post).where(Post.id.in_(list(dict.fromkeys(wanted))), *post_public_conditions(now))
        ).scalars()
    }
    result: dict[uuid.UUID, list[RelatedPostOut]] = {}
    for record_id, rows in grouped.items():
        payloads: list[RelatedPostOut] = []
        for post_id, _position in rows:
            post = posts.get(post_id)
            if post is None:
                continue
            payloads.append(
                RelatedPostOut(
                    id=post.id,
                    slug=post.slug,
                    title=post.title,
                    href=f"{POST_HREF_PREFIX}{post.slug}",
                )
            )
        result[record_id] = payloads
    return result


def public_projects_for_records(
    session: Session, record_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, list[RelatedProjectOut]]:
    """公开用：只返回**当前公开**的作品（撤回的作品整条丢弃，不留占位）。"""
    grouped = project_relation_rows(session, record_ids)
    wanted = [project_id for rows in grouped.values() for project_id, _ in rows]
    if not wanted:
        return {}
    projects = {
        project.id: project
        for project in session.execute(
            select(Project).where(
                Project.id.in_(list(dict.fromkeys(wanted))), *project_public_conditions(now)
            )
        ).scalars()
    }
    result: dict[uuid.UUID, list[RelatedProjectOut]] = {}
    for record_id, rows in grouped.items():
        payloads: list[RelatedProjectOut] = []
        for project_id, _position in rows:
            project = projects.get(project_id)
            if project is None:
                continue
            payloads.append(
                RelatedProjectOut(
                    id=project.id,
                    slug=project.slug,
                    title=project.title,
                    summary=project.summary or "",
                    href=f"{PROJECT_HREF_PREFIX}{project.slug}",
                )
            )
        result[record_id] = payloads
    return result


def public_counts_for_records(
    session: Session, record_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, tuple[int, int]]:
    """`(公开文章数, 公开作品数)`，与列表 / 详情用同一套公开条件。"""
    posts = public_posts_for_records(session, record_ids, now=now)
    projects = public_projects_for_records(session, record_ids, now=now)
    return {
        record_id: (len(posts.get(record_id, [])), len(projects.get(record_id, [])))
        for record_id in dict.fromkeys(record_ids)
    }


# --- 写入校验 ---------------------------------------------------------------


def _as_post_relation(
    entry: RelatedPostRelationIn | dict,
) -> RelatedPostRelationIn:
    if isinstance(entry, RelatedPostRelationIn):
        return entry
    return RelatedPostRelationIn.model_validate(entry)


def _as_project_relation(
    entry: RelatedProjectRelationIn | dict,
) -> RelatedProjectRelationIn:
    if isinstance(entry, RelatedProjectRelationIn):
        return entry
    return RelatedProjectRelationIn.model_validate(entry)


def _normalize_post_relations(
    session: Session, entries: Iterable[RelatedPostRelationIn | dict]
) -> list[RelatedPostRelationIn]:
    """校验文章引用：数量、重复、position、文章真实存在。

    允许关联**草稿**文章（站主可以先记问题再写文章）；公开侧由
    `public_posts_for_records()` 的公开条件兜底，草稿标题不会露出来。
    引用**不存在**的文章则直接拒绝 —— 那一定是调用方搞错了。
    """
    normalized = [_as_post_relation(entry) for entry in entries]
    if len(normalized) > MAX_POSTS_PER_RECORD:
        raise conflict(
            f"一条记录最多关联 {MAX_POSTS_PER_RECORD} 篇文章",
            {"posts": [f"最多 {MAX_POSTS_PER_RECORD} 篇"]},
        )
    post_ids = [entry.post_id for entry in normalized]
    if len(set(post_ids)) != len(post_ids):
        raise conflict("同一篇文章不能重复关联", {"posts": ["post_id 重复"]})
    positions = [entry.position for entry in normalized]
    if len(set(positions)) != len(positions):
        raise conflict("关联顺序不能重复", {"posts": ["position 重复"]})
    if not post_ids:
        return normalized
    found = set(
        session.execute(select(Post.id).where(Post.id.in_(post_ids))).scalars().all()
    )
    missing = [str(pid) for pid in post_ids if pid not in found]
    if missing:
        raise conflict("关联的文章不存在", {"posts": missing})
    return normalized


def _normalize_project_relations(
    session: Session, entries: Iterable[RelatedProjectRelationIn | dict]
) -> list[RelatedProjectRelationIn]:
    normalized = [_as_project_relation(entry) for entry in entries]
    if len(normalized) > MAX_PROJECTS_PER_RECORD:
        raise conflict(
            f"一条记录最多关联 {MAX_PROJECTS_PER_RECORD} 件作品",
            {"projects": [f"最多 {MAX_PROJECTS_PER_RECORD} 件"]},
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


def _replace_posts(
    session: Session, record: ExplorationRecord, entries: Sequence[RelatedPostRelationIn]
) -> None:
    session.execute(
        delete(exploration_record_posts).where(
            exploration_record_posts.c.record_id == record.id
        )
    )
    session.flush()
    for entry in sorted(entries, key=lambda item: item.position):
        session.execute(
            insert(exploration_record_posts).values(
                record_id=record.id, post_id=entry.post_id, position=entry.position
            )
        )


def _replace_projects(
    session: Session,
    record: ExplorationRecord,
    entries: Sequence[RelatedProjectRelationIn],
) -> None:
    session.execute(
        delete(exploration_record_projects).where(
            exploration_record_projects.c.record_id == record.id
        )
    )
    session.flush()
    for entry in sorted(entries, key=lambda item: item.position):
        session.execute(
            insert(exploration_record_projects).values(
                record_id=record.id, project_id=entry.project_id, position=entry.position
            )
        )


def _check_slug_available(
    session: Session, slug: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    statement = select(ExplorationRecord.id).where(ExplorationRecord.slug == slug)
    if exclude_id is not None:
        statement = statement.where(ExplorationRecord.id != exclude_id)
    if session.execute(statement).first() is not None:
        raise conflict("这个 slug 已被占用", {"slug": ["已存在同 slug 的问题记录"]})


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - 正常情况下由上面的校验拦住
        session.rollback()
        raise conflict(
            "数据约束冲突，请检查 slug、关联内容与顺序", {"body": [type(exc).__name__]}
        ) from None


def _normalize_scalar(patch: dict, name: str, *, max_length: int) -> None:
    value = patch.get(name)
    if value is None:
        return
    text = str(value).strip()
    if len(text) > max_length:
        raise conflict(f"{name} 超过 {max_length} 个字符", {name: [f"最多 {max_length} 个字符"]})
    patch[name] = text


def _apply_work_status(
    record: ExplorationRecord, work_status: str, *, outcome: str | None = None
) -> None:
    """统一处理「工作状态 → 解决时间」的联动，避免两处各写一份。

    - 进入「已解决」：必须有实际结果说明（`outcome` 现有值或本次传入值），
      `resolved_at` 由服务端写入第一次解决的时间（重复保存保持原时间，
      不让「保存一次」把解决时间往后推）。
    - 离开「已解决」：清空 `resolved_at`，与数据库 CHECK 约束一致。
    """
    if work_status not in WORK_STATUSES:
        raise conflict("工作状态不合法", {"work_status": [f"只能是 {' / '.join(WORK_STATUSES)}"]})
    if work_status == WORK_RESOLVED:
        resolved_text = (outcome if outcome is not None else record.outcome) or ""
        if not resolved_text.strip():
            raise conflict(
                "标记为「已解决」前需要填写实际结果说明",
                {"outcome": ["已解决的记录不能只有空白结果"]},
            )
        if record.resolved_at is None:
            record.resolved_at = utcnow()
    else:
        record.resolved_at = None
    record.work_status = work_status


# --- 管理写入 ---------------------------------------------------------------


def create_record(
    session: Session,
    *,
    slug: str,
    title: str,
    background: str = "",
    attempts: str = "",
    outcome: str = "",
    evidence_links: Sequence[dict] | None = None,
    work_status: str = "pending",
    posts: Sequence[RelatedPostRelationIn | dict] | None = None,
    projects: Sequence[RelatedProjectRelationIn | dict] | None = None,
) -> ExplorationRecord:
    """新建**草稿 + 待探索**（与 journal 的「草稿 + 私密」同形：

    刚记下的一个问题不可能因为某个查询漏了条件而直接对外可见）。
    """
    normalized_slug = slug.strip()
    _check_slug_available(session, normalized_slug)
    post_list = _normalize_post_relations(session, posts or [])
    project_list = _normalize_project_relations(session, projects or [])

    record = ExplorationRecord(
        slug=normalized_slug,
        title=title.strip(),
        background=(background or "").strip(),
        attempts=(attempts or "").strip(),
        outcome=(outcome or "").strip(),
        evidence_links=normalize_evidence_links(list(evidence_links or [])),
        work_status="pending",
        resolved_at=None,
        status=STATUS_DRAFT,
        published_at=None,
    )
    # 工作状态走同一个联动函数：直接建成「已解决」也必须带结果说明。
    _apply_work_status(record, work_status, outcome=record.outcome)

    session.add(record)
    session.flush()
    if post_list:
        _replace_posts(session, record, post_list)
    if project_list:
        _replace_projects(session, record, project_list)
    _commit(session)
    return record


def update_record(
    session: Session, record: ExplorationRecord, *, patch: dict, if_match: str | None
) -> ExplorationRecord:
    """按 `If-Match` 更新。传入 `posts` / `projects` / `evidence_links` 时**完整替换**。

    冲突（412）时不做任何修改：调用方负责保留未保存输入（05 §7）。
    """
    require_version(record.version, if_match)

    raw_posts = patch.get("posts")
    raw_projects = patch.get("projects")
    normalized_posts = None if raw_posts is None else _normalize_post_relations(session, raw_posts)
    normalized_projects = (
        None if raw_projects is None else _normalize_project_relations(session, raw_projects)
    )

    for field_name, max_length in (
        ("title", 200),
        ("background", 8000),
        ("attempts", 8000),
        ("outcome", 8000),
    ):
        if field_name in patch:
            _normalize_scalar(patch, field_name, max_length=max_length)

    for field_name in ("title", "background", "attempts", "outcome"):
        if field_name in patch and patch[field_name] is not None:
            setattr(record, field_name, patch[field_name])
    if "evidence_links" in patch and patch["evidence_links"] is not None:
        record.evidence_links = normalize_evidence_links(patch["evidence_links"])
    if "work_status" in patch and patch["work_status"] is not None:
        _apply_work_status(record, patch["work_status"], outcome=record.outcome)
    elif "outcome" in patch:
        # 只改结果说明时也要重新检查：「已解决 + 被清空的结果」必须被挡住。
        _apply_work_status(record, str(record.work_status), outcome=record.outcome)

    if normalized_posts is not None:
        _replace_posts(session, record, normalized_posts)
    if normalized_projects is not None:
        _replace_projects(session, record, normalized_projects)

    record.bump_version()
    _commit(session)
    return record


def publish_record(
    session: Session, record: ExplorationRecord, *, if_match: str | None
) -> ExplorationRecord:
    """发布门槛（07 §6）。

    与 projects / skills 的差别：问题记录的门槛是**标题 + 背景**。
    07 §6 的用例是「为什么某个动画结束后无法点击页面？」—— 一条只有标题的公开记录
    对读者没有价值，读者需要知道在什么场景下出现。

    刻意**不要求**工作状态是「已解决」：待探索 / 调查中的问题也可以公开，
    「正在查」本身就是内容（07 §6 的四个状态都在公开列表里有位置）。
    """
    require_version(record.version, if_match)

    if not record.title.strip():
        raise conflict("发布前需要填写标题", {"title": ["不能为空"]})
    if not record.background.strip():
        raise conflict("发布前需要填写背景说明", {"background": ["不能为空"]})

    record.status = STATUS_PUBLISHED
    record.published_at = utcnow()
    record.bump_version()
    _commit(session)
    return record


def unpublish_record(
    session: Session, record: ExplorationRecord, *, if_match: str | None
) -> ExplorationRecord:
    """撤回：回到 draft，**清空发布时间**。工作状态与关系保留，便于改完再发。"""
    require_version(record.version, if_match)
    record.status = STATUS_DRAFT
    record.published_at = None
    record.bump_version()
    _commit(session)
    return record


def soft_delete_record(
    session: Session, record: ExplorationRecord, *, if_match: str | None
) -> None:
    """软删除。关联内容（文章 / 作品）完全不受影响。"""
    require_version(record.version, if_match)
    record.deleted_at = utcnow()
    record.status = STATUS_DRAFT
    record.published_at = None
    record.bump_version()
    _commit(session)


# --- 管理组合输出 -----------------------------------------------------------


def admin_relations_out(
    session: Session, record_ids: Sequence[uuid.UUID]
) -> tuple[
    dict[uuid.UUID, list[RelatedPostRelationOut]],
    dict[uuid.UUID, list[RelatedProjectRelationOut]],
]:
    """管理回执：按 position 返回关系，并带上标题与状态（含草稿）。

    与公开侧的区别是**不过滤**：站主必须看到「关联的是一篇草稿」并据此决定是否发布，
    而不是被悄悄过滤掉后看起来像没关联（T03 / T06 都踩过同样的坑）。
    """
    post_rows = post_relation_rows(session, record_ids)
    project_rows = project_relation_rows(session, record_ids)
    wanted_posts = list(dict.fromkeys(pid for rows in post_rows.values() for pid, _ in rows))
    wanted_projects = list(
        dict.fromkeys(pid for rows in project_rows.values() for pid, _ in rows)
    )
    posts_by_id: dict[uuid.UUID, Post] = {}
    if wanted_posts:
        posts_by_id = {
            post.id: post
            for post in session.execute(
                select(Post).where(Post.id.in_(wanted_posts))
            ).scalars()
        }
    projects_by_id: dict[uuid.UUID, Project] = {}
    if wanted_projects:
        projects_by_id = {
            project.id: project
            for project in session.execute(
                select(Project).where(Project.id.in_(wanted_projects))
            ).scalars()
        }

    post_payloads: dict[uuid.UUID, list[RelatedPostRelationOut]] = {}
    for record_id, rows in post_rows.items():
        entries: list[RelatedPostRelationOut] = []
        for post_id, position in rows:
            post = posts_by_id.get(post_id)
            if post is None:
                continue
            entries.append(
                RelatedPostRelationOut(
                    post_id=post_id,
                    slug=post.slug,
                    title=post.title,
                    status=str(post.status),
                    position=position,
                )
            )
        post_payloads[record_id] = entries

    project_payloads: dict[uuid.UUID, list[RelatedProjectRelationOut]] = {}
    for record_id, rows in project_rows.items():
        entries = []
        for project_id, position in rows:
            project = projects_by_id.get(project_id)
            if project is None:
                continue
            entries.append(
                RelatedProjectRelationOut(
                    project_id=project_id,
                    slug=project.slug,
                    title=project.title,
                    status=str(project.status),
                    position=position,
                )
            )
        project_payloads[record_id] = entries

    return post_payloads, project_payloads


__all__ = [
    "POST_HREF_PREFIX",
    "PROJECT_HREF_PREFIX",
    "admin_relations_out",
    "clamp_limit",
    "conflict",
    "create_record",
    "get_admin_record",
    "get_public_record",
    "get_record_by_slug",
    "list_admin_records",
    "list_public_records",
    "not_found",
    "post_relation_rows",
    "project_relation_rows",
    "public_conditions",
    "public_counts_for_records",
    "public_posts_for_records",
    "public_projects_for_records",
    "public_work_status_counts",
    "publish_record",
    "soft_delete_record",
    "unpublish_record",
    "update_record",
]
