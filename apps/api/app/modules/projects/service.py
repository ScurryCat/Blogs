"""作品服务（07 §5、05 §4 / §6 / §7、05 §11）。

事务边界（与 T03 的 moments 同形）：一次写操作里的**标量字段、图片顺序、技术栈、链接
与 version 在同一个事务里提交**；发布门槛校验与状态改变也同事务完成。中途任何校验
失败都在 `commit()` 之前抛出，因此不会留下「状态改了但图片没换」的半成品。

公开条件（写在 SQL 里，而不是浏览器里）：

    status = 'published' AND deleted_at IS NULL AND published_at <= now()

**关联专题撤回的行为**（验收 5、07 §5）：

  - 专题撤回（`palaces.status = 'draft'`）**不连带删除或撤回作品**；
  - 作品详情里的「攻略记录」链接由 `palace_link_for_project()` 在**读取时**用 nav 的
    公开条件解析；专题不再公开时返回 `None`，页面显示「暂时没有可读的攻略记录」，
    **绝不回显隐藏专题的标题**。这里刻意不把标题快照进 projects 表 —— 存了快照就
    没法保证撤回后不泄漏。

媒体公开引用（05 §11、SHARED-CONTRACTS §5）：作品图片只在作品本身公开时构成公开
引用；撤回一个引用只影响那一处，一张图仍有其他公开引用（动态 / 相册）就继续公开。
本域的实现是 `public_refs.py`，由 `wiring.register()` 登记。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from datetime import date, datetime

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
from app.modules.media.models import STATUS_READY, Media
from app.modules.projects.models import (
    MAINTENANCE_STATES,
    MAX_MEDIA_PER_PROJECT,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Project,
    project_media,
)
from app.modules.projects.schemas import (
    PROJECT_IMAGE_KINDS,
    ProjectImageIn,
    ProjectImageOut,
    ProjectLinkIn,
    ProjectPalaceLinkOut,
    _image_payload,
    admin_image_payload,
    cover_of,
    detail_out,
    summary_out,
)


def not_found(message: str = "作品不存在或不可访问") -> ApiError:
    """公开读不到与站主读不到管理资源统一用它 —— 不区分「不存在」与「无权」。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """业务冲突：slug 占用、图片未 ready、发布门槛不满足（05 §9 的 409）。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


# --- 查询基础 -------------------------------------------------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        Project.status == STATUS_PUBLISHED,
        Project.deleted_at.is_(None),
        Project.published_at.is_not(None),
        Project.published_at <= moment,
    ]


def _filter_fingerprint(maintenance: str | None, tech: str | None) -> str:
    return filter_fingerprint({"maintenance": maintenance, "tech": tech})


def list_public_projects(
    session: Session,
    *,
    maintenance: str | None = None,
    tech: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[Project], str | None]:
    """公开列表，`(published_at DESC, id DESC)` + 不透明游标。

    筛选指纹包含 `maintenance` 与 `tech`：换筛选后继续用旧游标 → 400（05 §6）。
    """
    bounded = clamp_limit(limit)
    fingerprint = _filter_fingerprint(maintenance, tech)

    statement: Select = select(Project).where(*public_conditions(now))
    if maintenance:
        statement = statement.where(Project.maintenance == maintenance)
    if tech:
        needle = tech.strip()
        # JSONB 数组包含判断：技术栈是短字符串数组，用 `@>` 走 GIN 之外的全扫也够用
        # （个人站点规模），但语义正确 —— 不做 LIKE 模糊匹配，避免 "Go" 命中 "Golang"。
        statement = statement.where(Project.tech_stack.contains([needle]))

    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Project.published_at, Project.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Project.published_at.desc(), Project.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.published_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_project(
    session: Session, slug: str, *, now: datetime | None = None
) -> Project | None:
    """按 slug 取公开作品。草稿 / 已撤回 / 已删除 / 未到发布时间都返回 None（统一 404）。"""
    return (
        session.execute(
            select(Project).where(Project.slug == slug, *public_conditions(now))
        )
        .scalars()
        .first()
    )


def get_admin_project(session: Session, project_id: uuid.UUID) -> Project | None:
    """管理读取：任何状态都能取到，但已软删除的不再返回（列表同样不显示）。"""
    return (
        session.execute(
            select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
        )
        .scalars()
        .first()
    )


def get_project_by_slug(session: Session, slug: str) -> Project | None:
    return session.execute(select(Project).where(Project.slug == slug)).scalars().first()


def list_admin_projects(
    session: Session,
    *,
    status: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Project], str | None]:
    """管理列表：草稿与已发布都在，按 `(created_at DESC, id DESC)` 排序。"""
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint({"scope": "admin", "status": status})

    statement: Select = select(Project).where(Project.deleted_at.is_(None))
    if status:
        statement = statement.where(Project.status == status)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Project.created_at, Project.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Project.created_at.desc(), Project.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.created_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


# --- 图片关系批量读取 ------------------------------------------------------


ImageRef = tuple[uuid.UUID, int, str, str, str, date | None]


def image_refs_for_projects(
    session: Session, project_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[ImageRef]]:
    """管理用：**不过滤** media 状态，如实返回已保存的顺序关系。

    管理表单必须看到「有一张图还没处理完 / 已被删除」并据此提示不能发布，
    而不是被悄悄过滤掉后看起来像少了一张图（T03 踩过同样的坑）。
    """
    if not project_ids:
        return {}
    rows = session.execute(
        select(
            project_media.c.project_id,
            project_media.c.media_id,
            project_media.c.position,
            project_media.c.kind,
            project_media.c.alt,
            project_media.c.caption,
            project_media.c.taken_on,
        )
        .where(project_media.c.project_id.in_(list(project_ids)))
        .order_by(project_media.c.project_id.asc(), project_media.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[ImageRef]] = {}
    for project_id, media_id, position, kind, alt, caption, taken_on in rows:
        grouped.setdefault(project_id, []).append(
            (media_id, int(position), str(kind), str(alt), str(caption), taken_on)
        )
    return grouped


def public_images_for_projects(
    session: Session, project_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[ProjectImageOut]]:
    """公开用：只返回 `ready` 且未删除的媒体（不指向不可读对象）。

    `kind` 过滤发生在 Python 侧而不是 SQL：非法 kind 不可能写进数据库（由 schema 与
    service 双重拒绝），这里只是把关系行的取值映射成公开 DTO。
    """
    if not project_ids:
        return {}
    rows = session.execute(
        select(
            project_media.c.project_id,
            project_media.c.media_id,
            project_media.c.position,
            project_media.c.kind,
            project_media.c.alt,
            project_media.c.caption,
            project_media.c.taken_on,
            Media,
        )
        .join(Media, Media.id == project_media.c.media_id)
        .where(
            project_media.c.project_id.in_(list(project_ids)),
            Media.deleted_at.is_(None),
            Media.status == STATUS_READY,
        )
        .order_by(project_media.c.project_id.asc(), project_media.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[ProjectImageOut]] = {}
    for project_id, _media_id, position, kind, alt, caption, taken_on, media in rows:
        grouped.setdefault(project_id, []).append(
            _image_payload(
                media,
                position=int(position),
                kind=str(kind),
                alt=str(alt),
                caption=str(caption),
                taken_on=taken_on,
            )
        )
    return grouped


def load_media_rows(session: Session, media_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Media]:
    """按 ID 取媒体行（**不过滤** status / deleted_at，供管理预览）。"""
    wanted = list(dict.fromkeys(media_ids))
    if not wanted:
        return {}
    return {
        media.id: media
        for media in session.execute(select(Media).where(Media.id.in_(wanted))).scalars()
    }


def admin_images_for_projects(
    session: Session, project_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list]:
    refs = image_refs_for_projects(session, project_ids)
    media_ids = [ref[0] for group in refs.values() for ref in group]
    media_by_id = load_media_rows(session, media_ids)
    result: dict[uuid.UUID, list] = {}
    for project_id, group in refs.items():
        payloads = []
        for media_id, position, kind, alt, caption, taken_on in group:
            media = media_by_id.get(media_id)
            if media is None:
                # 媒体行被物理删除（理论上被 FK RESTRICT 拦住）：如实报告而不是静默丢弃。
                continue
            payloads.append(
                admin_image_payload(
                    media,
                    position=position,
                    kind=kind,
                    alt=alt,
                    caption=caption,
                    taken_on=taken_on,
                )
            )
        result[project_id] = payloads
    return result


# --- 关联专题（跨模块只读门面：nav 的公开条件） ---------------------------


def palace_link_for_project(
    session: Session, palace_id: uuid.UUID | None, *, now: datetime | None = None
) -> ProjectPalaceLinkOut | None:
    """作品 → 公开专题链接。专题不公开时返回 `None`（不泄漏隐藏专题的标题）。

    只调用 nav 的**只读门面**（T04 交付，SHARED-CONTRACTS §2：跨域读取不直接查别人的表）。
    `public_palace_options()` 一次返回当前公开专题，个人站点规模（几十座）下比新增一个
    「按 id 查公开专题」的门面更省事，也避免动别人的文件。
    """
    if palace_id is None:
        return None
    from app.modules.nav import service as nav_service

    for palace in nav_service.public_palace_options(session, now=now):
        if palace.id == palace_id:
            return ProjectPalaceLinkOut(
                slug=palace.slug, title=palace.title, summary=palace.summary
            )
    return None


def palace_links_for_projects(
    session: Session, projects: Sequence[Project], *, now: datetime | None = None
) -> dict[uuid.UUID, ProjectPalaceLinkOut | None]:
    """批量解析（列表页避免 N+1）：一次取公开专题清单，再在内存里配对。"""
    from app.modules.nav import service as nav_service

    by_id = {
        palace.id: ProjectPalaceLinkOut(
            slug=palace.slug, title=palace.title, summary=palace.summary
        )
        for palace in nav_service.public_palace_options(session, now=now)
    }
    return {
        project.id: (by_id.get(project.palace_id) if project.palace_id else None)
        for project in projects
    }


def palace_exists(session: Session, palace_id: uuid.UUID) -> bool:
    """任何状态（含草稿 / 已删除）的专题是否存在。用于表单校验而不是权限判断。

    允许作品关联**草稿**专题：站主可以先建作品再等专题发布；公开侧由
    `palace_link_for_project()` 的公开条件兜底，草稿专题不会连标题一起露出来。
    """
    from app.modules.nav.models import Palace

    return (
        session.execute(select(Palace.id).where(Palace.id == palace_id)).scalars().first()
        is not None
    )


def public_palace_options(session: Session, *, now: datetime | None = None) -> list:
    """给管理表单的「关联专题」下拉：只列**当前公开**的专题。"""
    from app.modules.nav import service as nav_service

    return nav_service.public_palace_options(session, now=now)


# --- 列表 / 详情的公开组合 -------------------------------------------------


def public_list_out(session: Session, projects: Sequence[Project], *, now: datetime | None = None):
    ids = [project.id for project in projects]
    images = public_images_for_projects(session, ids)
    palaces = palace_links_for_projects(session, projects, now=now)
    return [
        summary_out(
            project,
            images=images.get(project.id, []),
            palace=palaces.get(project.id),
        )
        for project in projects
    ]


def public_detail_out(session: Session, project: Project, *, now: datetime | None = None):
    images = public_images_for_projects(session, [project.id]).get(project.id, [])
    palace = palace_link_for_project(session, project.palace_id, now=now)
    return detail_out(project, images=images, palace=palace)


def public_cover_for_project(
    session: Session, project_id: uuid.UUID
) -> ProjectImageOut | None:
    """作品的公开封面（供其他域的紧凑视图复用）。"""
    return cover_of(public_images_for_projects(session, [project_id]).get(project_id, []))


# --- 写入校验 -------------------------------------------------------------


def _as_image_input(image: ProjectImageIn | dict) -> ProjectImageIn:
    """接受 `ProjectImageIn` 或它的 `model_dump()` 结果。

    为什么需要它（T03 的真实缺陷）：router 用 `payload.model_dump(exclude_unset=True)` 取
    「只改了哪些字段」，于是 `images` 到 service 时是 **dict 列表**而不是模型实例，
    直接访问 `.media_id` 会变成 500。这里统一归一化，回归用例从 router 入口进。
    """
    if isinstance(image, ProjectImageIn):
        return image
    return ProjectImageIn.model_validate(image)


def _as_link_input(link: ProjectLinkIn | dict) -> ProjectLinkIn:
    if isinstance(link, ProjectLinkIn):
        return link
    return ProjectLinkIn.model_validate(link)


def _normalize_images(
    session: Session, images: Iterable[ProjectImageIn | dict]
) -> list[ProjectImageIn]:
    """校验图片引用：数量、重复、position、kind、媒体存在且 ready 且未删除。"""
    normalized = [_as_image_input(image) for image in images]
    if len(normalized) > MAX_MEDIA_PER_PROJECT:
        raise conflict(
            f"最多 {MAX_MEDIA_PER_PROJECT} 张图片",
            {"images": [f"最多 {MAX_MEDIA_PER_PROJECT} 张"]},
        )
    media_ids = [image.media_id for image in normalized]
    if len(set(media_ids)) != len(media_ids):
        raise conflict("同一张图片不能重复出现", {"images": ["media_id 重复"]})
    positions = [image.position for image in normalized]
    if len(set(positions)) != len(positions):
        raise conflict("图片顺序不能重复", {"images": ["position 重复"]})
    for image in normalized:
        if image.kind not in PROJECT_IMAGE_KINDS:
            raise conflict("图片用途不合法", {"images": [f"kind={image.kind} 不支持"]})
    if not media_ids:
        return normalized
    found = load_media_rows(session, media_ids)
    for image in normalized:
        media = found.get(image.media_id)
        if media is None or media.deleted_at is not None:
            raise conflict("引用的图片不存在或已删除", {"images": [f"{image.media_id} 不可用"]})
        if media.status != STATUS_READY:
            # 与 03 §5 / 05 §8 一致：引用的媒体必须 ready，否则发布出去的页面会有坏图。
            raise conflict(
                "引用的图片尚未处理完成", {"images": [f"{image.media_id} 未就绪"]}
            )
    return normalized


def _replace_images(
    session: Session, project: Project, images: Sequence[ProjectImageIn]
) -> None:
    """完整替换有序图片关系（05 §7）。调用方已完成媒体校验。"""
    session.execute(delete(project_media).where(project_media.c.project_id == project.id))
    session.flush()
    for image in sorted(images, key=lambda item: item.position):
        session.execute(
            insert(project_media).values(
                project_id=project.id,
                media_id=image.media_id,
                position=image.position,
                kind=image.kind,
                alt=image.alt.strip(),
                caption=image.caption.strip() if image.caption else "",
                taken_on=image.taken_on,
            )
        )


def _normalize_tech_stack(values: Iterable[str] | None) -> list[str]:
    cleaned: list[str] = []
    for item in values or []:
        text = (item or "").strip()
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned


def _normalize_links(links: Iterable[ProjectLinkIn | dict] | None) -> list[dict]:
    normalized: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for raw in links or []:
        link = _as_link_input(raw)
        key = (link.kind, link.url)
        if key in seen:
            continue
        seen.add(key)
        normalized.append({"kind": link.kind, "label": link.label.strip(), "url": link.url})
    return normalized


def _check_slug_available(
    session: Session, slug: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    statement = select(Project.id).where(Project.slug == slug)
    if exclude_id is not None:
        statement = statement.where(Project.id != exclude_id)
    if session.execute(statement).first() is not None:
        raise conflict("这个 slug 已被占用", {"slug": ["已存在同 slug 的作品"]})


def _commit(session: Session) -> None:
    """提交并把完整性冲突翻译成可读错误，而不是 500。"""
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - 正常情况下由上面的校验拦住
        session.rollback()
        raise conflict(
            "数据约束冲突，请检查 slug、图片顺序与关联专题", {"body": [type(exc).__name__]}
        ) from None


def _normalize_scalar(patch: dict, name: str, *, max_length: int) -> None:
    """把标量字段去首尾空白并检查码点上限（pydantic 已按码点校验一次，这里是兜底）。"""
    value = patch.get(name)
    if value is None:
        return
    text = str(value).strip()
    if len(text) > max_length:
        raise conflict(f"{name} 超过 {max_length} 个字符", {name: [f"最多 {max_length} 个字符"]})
    patch[name] = text


# --- 管理写入 -------------------------------------------------------------


def create_project(
    session: Session,
    *,
    slug: str,
    title: str,
    summary: str = "",
    role: str = "",
    problem: str = "",
    tradeoffs: str = "",
    outcomes: str = "",
    tech_stack: Sequence[str] | None = None,
    links: Sequence[ProjectLinkIn | dict] | None = None,
    maintenance: str = "maintained",
    palace_id: uuid.UUID | None = None,
    images: Sequence[ProjectImageIn | dict] | None = None,
) -> Project:
    """新建**草稿**（与 moments / nav 一致：创建总是草稿，发布是单独动作）。"""
    normalized_slug = slug.strip()
    _check_slug_available(session, normalized_slug)
    if maintenance not in MAINTENANCE_STATES:
        raise conflict("维护状态不合法", {"maintenance": [f"只能是 {' / '.join(MAINTENANCE_STATES)}"]})
    if palace_id is not None and not palace_exists(session, palace_id):
        raise conflict("关联的专题不存在", {"palace_id": ["找不到这个专题"]})
    image_list = _normalize_images(session, images or [])

    project = Project(
        slug=normalized_slug,
        title=title.strip(),
        summary=summary.strip(),
        role=role,
        problem=problem,
        tradeoffs=tradeoffs,
        outcomes=outcomes,
        tech_stack=_normalize_tech_stack(tech_stack),
        links=_normalize_links(links),
        maintenance=maintenance,
        palace_id=palace_id,
        status=STATUS_DRAFT,
        published_at=None,
    )
    session.add(project)
    session.flush()
    if image_list:
        _replace_images(session, project, image_list)
    _commit(session)
    return project


def update_project(
    session: Session, project: Project, *, patch: dict, if_match: str | None
) -> Project:
    """按 `If-Match` 更新。传入 `images` / `links` / `tech_stack` 时**完整替换**。

    冲突（412）时不做任何修改：调用方负责保留未保存输入（05 §7）。
    """
    require_version(project.version, if_match)

    images = patch.get("images")
    normalized_images = None if images is None else _normalize_images(session, images)

    if "palace_id" in patch:
        new_palace_id = patch["palace_id"]
        if new_palace_id is not None and not palace_exists(session, new_palace_id):
            raise conflict("关联的专题不存在", {"palace_id": ["找不到这个专题"]})
    if patch.get("maintenance") is not None and patch["maintenance"] not in MAINTENANCE_STATES:
        raise conflict("维护状态不合法", {"maintenance": [f"只能是 {' / '.join(MAINTENANCE_STATES)}"]})

    for field_name, max_length in (
        ("title", 200),
        ("summary", 500),
        ("role", 8000),
        ("problem", 8000),
        ("tradeoffs", 8000),
        ("outcomes", 8000),
    ):
        if field_name in patch:
            _normalize_scalar(patch, field_name, max_length=max_length)

    for field_name in ("title", "summary", "role", "problem", "tradeoffs", "outcomes"):
        if field_name in patch and patch[field_name] is not None:
            setattr(project, field_name, patch[field_name])
    if "maintenance" in patch and patch["maintenance"] is not None:
        project.maintenance = patch["maintenance"]
    if "palace_id" in patch:
        project.palace_id = patch["palace_id"]
    if "tech_stack" in patch and patch["tech_stack"] is not None:
        project.tech_stack = _normalize_tech_stack(patch["tech_stack"])
    if "links" in patch and patch["links"] is not None:
        project.links = _normalize_links(patch["links"])
    if normalized_images is not None:
        _replace_images(session, project, normalized_images)

    project.bump_version()
    _commit(session)
    return project


def publish_project(session: Session, project: Project, *, if_match: str | None) -> Project:
    """发布门槛：至少一张 ready 图片（07 §5「效果图」是作品的必要组成）。

    与 moments 的差别是**下限只有 1 张且允许没有正文之外的材料**：作品可以是纯代码
    项目，因此这里不要求 outcomes / links 非空 —— 缺材料时页面少显示一块，
    而不是逼站主编一段成果。
    """
    require_version(project.version, if_match)

    refs = image_refs_for_projects(session, [project.id]).get(project.id, [])
    if not refs:
        raise conflict("发布前至少需要一张图片", {"images": ["至少 1 张图片"]})

    media_by_id = load_media_rows(session, [ref[0] for ref in refs])
    unready = [
        str(media_id)
        for media_id, _position, _kind, _alt, _caption, _taken in refs
        if (media := media_by_id.get(media_id)) is None
        or media.status != STATUS_READY
        or media.deleted_at is not None
    ]
    if unready:
        raise conflict("有图片尚未处理完成，不能发布", {"images": unready})

    if not project.summary.strip():
        # 「一句话用途」是作品卡片的门面（07 §5）：没有它就只剩标题，卡片无法解释这是什么。
        raise conflict("发布前需要填写一句话用途", {"summary": ["不能为空"]})

    project.status = STATUS_PUBLISHED
    # 服务端生成发布时间，不信任客户端时钟（与 03 §5 一致）。
    project.published_at = utcnow()
    project.bump_version()
    _commit(session)
    return project


def unpublish_project(session: Session, project: Project, *, if_match: str | None) -> Project:
    """撤回：回到 draft，**清空发布时间**。图片关系保留，便于改完再发。"""
    require_version(project.version, if_match)
    project.status = STATUS_DRAFT
    project.published_at = None
    project.bump_version()
    _commit(session)
    return project


def soft_delete_project(session: Session, project: Project, *, if_match: str | None) -> None:
    """软删除。文件不物理删除（可能还有相册 / 动态等公开引用），由清理任务处理。"""
    require_version(project.version, if_match)
    project.deleted_at = utcnow()
    project.status = STATUS_DRAFT
    project.published_at = None
    project.bump_version()
    _commit(session)


# --- 内容域贡献（供 public_refs 使用）--------------------------------------


def public_project_exists_for_media(session: Session, media_id: uuid.UUID) -> bool:
    """该媒体是否是某件**当前公开**作品的图片（媒体公开引用检查用，只读）。

    一张图可以有多个公开引用：这里只回答「本域是否成立」，不回答「总数」。
    """
    statement = (
        select(Project.id)
        .join(project_media, project_media.c.project_id == Project.id)
        .where(project_media.c.media_id == media_id, *public_conditions())
        .limit(1)
    )
    return session.execute(statement).scalars().first() is not None


def public_media_ids(session: Session) -> set[uuid.UUID]:
    """当前被公开作品引用的媒体 id（管理端「这张图还有别处引用吗」提示用）。"""
    rows = session.execute(
        select(project_media.c.media_id)
        .join(Project, Project.id == project_media.c.project_id)
        .where(*public_conditions())
        .distinct()
    ).scalars()
    return set(rows)


def media_reference_summary(session: Session, media_id: uuid.UUID) -> dict[str, bool]:
    """这张图当前在**哪些已登记的域**里有公开引用（管理端提示用，只读）。

    为什么需要它（07 §5 末段 / 05 §11）：「管理端必须明确提示」一次撤回收不回其他
    公开相册里的同一张照片。这里逐个调用已注册的检查器，因此新增域会自动出现在提示里。

    注意：`media.public_refs` 的注册表可能为空（未接线的测试环境），那时返回空字典 ——
    提示为「没有其他公开引用」，与真实的匿名可读性判断一致（默认拒绝）。
    """
    from app.modules.media import public_refs as media_public_refs

    checkers = getattr(media_public_refs, "_checkers", {})
    result: dict[str, bool] = {}
    for name, checker in list(checkers.items()):
        try:
            result[name] = bool(checker(session, media_id))
        except Exception:  # pragma: no cover - 单个域的检查失败不应该让整个提示 500
            result[name] = False
    return result


__all__ = [
    "ImageRef",
    "clamp_limit",
    "conflict",
    "create_project",
    "get_admin_project",
    "get_project_by_slug",
    "get_public_project",
    "image_refs_for_projects",
    "list_admin_projects",
    "list_public_projects",
    "load_media_rows",
    "media_reference_summary",
    "not_found",
    "palace_exists",
    "palace_link_for_project",
    "palace_links_for_projects",
    "public_cover_for_project",
    "public_conditions",
    "public_detail_out",
    "public_images_for_projects",
    "public_list_out",
    "public_media_ids",
    "public_palace_options",
    "public_project_exists_for_media",
    "publish_project",
    "soft_delete_project",
    "unpublish_project",
    "update_project",
]
