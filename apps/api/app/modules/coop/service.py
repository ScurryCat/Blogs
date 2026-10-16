"""COOP 友链的读写服务（05 §6 公开 / §7 管理、07 §4）。

边界（写进交付单的约定）：

  - 公开查询在 **SQL 层**过滤草稿、软删除、未到发布时间，并且**再次**要求地址是
    http(s)（与数据库 CHECK 同形）：读接口不会把可执行 scheme 交给前端。
  - 「地址是否可达」不做判断：本站**不抓取外链站点内容**，站点打不开也保留卡片、
    也不自动删除朋友（验收第 4 条）。可达性只由访客的浏览器决定。
  - 排序是站主手动的 `(position ASC, id ASC)`，与发布时间无关；`published_at` 只用于
    首次发布留痕，不参与排序。
  - 标签是**友链自己的**标签（`friend_link_tags`），不进共享 `tags` 表，
    因此 `GET /api/v1/tags` 的含义不受本模块影响（集成时不需要登记公开标签来源）。
  - 每个写操作都在自己的事务里提交（05 §4：返回成功即已落库）。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime

from sqlalchemy import delete, select, tuple_
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import (
    CODE_CONFLICT,
    CODE_NOT_FOUND,
    CODE_UNPROCESSABLE,
    ApiError,
)
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT, filter_fingerprint
from app.core.text import normalize_for_match
from app.modules.coop import cursors, schemas
from app.modules.coop.models import (
    MAX_TAGS_PER_LINK,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    FriendLink,
    FriendLinkTag,
)
from app.modules.coop.urls import normalize_external_url, unsafe_url_reason
from app.modules.media import service as media_service
from app.modules.media.models import Media
from app.modules.media.schemas import MediaPublicOut, media_public_out

__all__ = [
    "clamp_limit",
    "create_link",
    "detail_out",
    "admin_detail_out",
    "get_admin_link",
    "get_public_link",
    "list_admin_links",
    "list_public_links",
    "list_public_tags",
    "not_found",
    "normalize_tags",
    "public_avatar_exists_for_media",
    "public_conditions",
    "publish_link",
    "replace_tags",
    "soft_delete_link",
    "unpublish_link",
    "update_link",
]


def not_found(message: str = "友链不存在或不可访问") -> ApiError:
    """不存在、草稿、已删除、地址不可用统一同形（05 §6）。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def _unprocessable(message: str, field: str) -> ApiError:
    return ApiError(CODE_UNPROCESSABLE, message, status_code=422, fields={field: [message]})


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


# --- 公开条件 ---------------------------------------------------------------


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        FriendLink.status == STATUS_PUBLISHED,
        FriendLink.deleted_at.is_(None),
        FriendLink.published_at.is_not(None),
        FriendLink.published_at <= moment,
        # 兜底：即使有人绕过服务层直接写库（数据库 CHECK 也拦，但这里再确认一次），
        # 公开响应里也永远不会出现非 http(s) 地址。
        FriendLink.url.op("~*")("^https?://"),
    ]


def public_avatar_exists_for_media(session: Session, media_id: uuid.UUID) -> bool:
    """媒体的公开引用检查（供 `wiring` 注册；见 SHARED-CONTRACTS §5）。"""
    statement = select(FriendLink.id).where(
        FriendLink.avatar_media_id == media_id, *public_conditions()
    )
    return session.execute(statement).first() is not None


def public_media_ids_for_links(session: Session, links: Sequence[FriendLink]) -> dict[uuid.UUID, uuid.UUID]:
    """已发布友链引用的头像媒体（集成自检用，避免测试自己重写一份判断）。"""
    wanted = [link.id for link in links]
    if not wanted:
        return {}
    rows = session.execute(
        select(FriendLink.id, FriendLink.avatar_media_id).where(
            FriendLink.id.in_(wanted),
            FriendLink.avatar_media_id.is_not(None),
            *public_conditions(),
        )
    ).all()
    return {link_id: media_id for link_id, media_id in rows if media_id is not None}


# --- 公开读取 ---------------------------------------------------------------


def _avatar_payload(media: Media | None) -> MediaPublicOut | None:
    """头像可空 / 失败都要兜底：未 ready 或已删除的媒体当作「没有头像」。

    缺失时前端用站名首字渲染，不给坏图，也不因此隐藏整张卡片（验收第 4 条）。
    """
    if media is None or not media.is_ready:
        return None
    return media_public_out(media)


def _avatar_keys(links: Sequence[FriendLink]) -> set[uuid.UUID]:
    """头像媒体的键集合。

    统一转成 `uuid.UUID`：数据库里存的就是 UUID，而内存里的属性**可能**还是字符串
    （例如测试或脚本直接构造对象时）。这里不依赖调用方传什么型，否则
    `Media.id.in_({...})` 会静默查不到行 —— 表现是「有头像却渲染成没有」。
    """
    keys: set[uuid.UUID] = set()
    for link in links:
        value = link.avatar_media_id
        if value is None:
            continue
        keys.add(value if isinstance(value, uuid.UUID) else uuid.UUID(str(value)))
    return keys


def _avatars_for(session: Session, links: Sequence[FriendLink]) -> dict[uuid.UUID, MediaPublicOut]:
    media_ids = _avatar_keys(links)
    if not media_ids:
        return {}
    rows = session.execute(select(Media).where(Media.id.in_(media_ids))).scalars().all()
    payloads: dict[uuid.UUID, MediaPublicOut] = {}
    for media in rows:
        payload = _avatar_payload(media)
        if payload is not None:
            payloads[media.id] = payload
    return payloads


def _tags_for(session: Session, links: Sequence[FriendLink]) -> dict[uuid.UUID, list[FriendLinkTag]]:
    wanted = [link.id for link in links]
    if not wanted:
        return {}
    grouped: dict[uuid.UUID, list[FriendLinkTag]] = {}
    for tag in (
        session.execute(select(FriendLinkTag).where(FriendLinkTag.friend_link_id.in_(wanted)))
        .scalars()
        .all()
    ):
        grouped.setdefault(tag.friend_link_id, []).append(tag)
    return grouped


def summary_out(
    link: FriendLink,
    *,
    tags: Sequence[FriendLinkTag] = (),
    avatar: MediaPublicOut | None = None,
) -> schemas.FriendLinkSummaryOut:
    return schemas.FriendLinkSummaryOut(
        id=link.id,
        name=link.name,
        url=link.url,
        summary=link.summary,
        arcana=link.arcana,
        tags=[tag.name for tag in tags],
        avatar=avatar,
        has_story=bool((link.story or "").strip()),
    )


def summary_list_out(
    session: Session, links: Sequence[FriendLink]
) -> list[schemas.FriendLinkSummaryOut]:
    tags = _tags_for(session, links)
    avatars = _avatars_for(session, links)
    return [
        summary_out(
            link,
            tags=tags.get(link.id, ()),
            avatar=avatars.get(link.avatar_media_id) if link.avatar_media_id else None,
        )
        for link in links
    ]


def detail_out(
    session: Session, link: FriendLink
) -> schemas.FriendLinkDetailOut:
    tags = _tags_for(session, [link]).get(link.id, ())
    avatars = _avatars_for(session, [link])
    avatar = avatars.get(link.avatar_media_id) if link.avatar_media_id else None
    base = summary_out(link, tags=tags, avatar=avatar)
    return schemas.FriendLinkDetailOut(**base.model_dump(), story=link.story)


def public_list_fingerprint(tag: str | None) -> str:
    """筛选指纹：切换标签后继续用旧游标会得到 400，而不是混乱的第二页。"""
    return filter_fingerprint({"tag": tag or ""})


def list_public_links(
    session: Session,
    *,
    tag: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[FriendLink], str | None]:
    """已发布友链，按站主排序 `(position ASC, id ASC)` + 不透明游标分页。"""
    bounded = clamp_limit(limit)
    fingerprint = public_list_fingerprint(tag)
    statement = select(FriendLink).where(*public_conditions(now))
    normalized_tag = normalize_for_match(tag or "")
    if normalized_tag:
        statement = statement.where(
            select(FriendLinkTag.id)
            .where(
                FriendLinkTag.friend_link_id == FriendLink.id,
                FriendLinkTag.normalized == normalized_tag,
            )
            .exists()
        )
    if cursor:
        position, entity_id = cursors.decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(FriendLink.position, FriendLink.id) > tuple_(position, entity_id)
        )
    statement = statement.order_by(FriendLink.position.asc(), FriendLink.id.asc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())
    next_cursor = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = cursors.encode_cursor(
            position=int(last.position), entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_link(
    session: Session, link_id: uuid.UUID, *, now: datetime | None = None
) -> FriendLink | None:
    return (
        session.execute(
            select(FriendLink).where(FriendLink.id == link_id, *public_conditions(now))
        )
        .scalars()
        .first()
    )


def list_public_tags(session: Session, *, now: datetime | None = None) -> list[tuple[str, str]]:
    """已发布友链用到的标签（展示名 + 规范值），按规范值排序。

    展示名取**排序最靠前**的那条友链上的写法：同一标签在不同友链上大小写不同时，
    结果仍然确定（不随查询计划变化）。这里不返回计数 —— 友链不做排名统计。
    """
    rows = session.execute(
        select(FriendLinkTag.name, FriendLinkTag.normalized)
        .join(FriendLink, FriendLink.id == FriendLinkTag.friend_link_id)
        .where(*public_conditions(now))
        .order_by(FriendLinkTag.normalized.asc(), FriendLink.position.asc(), FriendLink.id.asc())
    ).all()
    # 归一化值 → 展示名（展示名取排序最靠前的那条写法）。
    seen: dict[str, str] = {}
    for name, normalized in rows:
        if normalized not in seen:
            seen[normalized] = name
    # **返回 (展示名, 规范值)**，与 docstring、router 的解包顺序和
    # `FriendTagOut(name=…, normalized=…)` 一致。
    # 注意：`sorted(seen.items())` 得到的是 (规范值, 展示名)，直接返回会让调用方
    # 把两个字段装反 —— API 的 `name` 与 `normalized` 会互换，且因为展示名恰好
    # 等于规范值时看不出来，表现为**间歇性失败**。
    return [(name, normalized) for normalized, name in sorted(seen.items())]


# --- 管理读取 ---------------------------------------------------------------


def get_admin_link(session: Session, link_id: uuid.UUID) -> FriendLink | None:
    """管理读取包含草稿与已删除（与公开端点完全分离，05 §7）。"""
    return session.execute(select(FriendLink).where(FriendLink.id == link_id)).scalars().first()


def list_admin_links(
    session: Session, *, cursor: str | None = None, limit: int | None = None
) -> tuple[list[FriendLink], str | None]:
    """全部友链（含草稿 / 已删除），按站主排序，同一套游标。"""
    bounded = clamp_limit(limit)
    fingerprint = public_list_fingerprint(None)
    statement = select(FriendLink)
    if cursor:
        position, entity_id = cursors.decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(FriendLink.position, FriendLink.id) > tuple_(position, entity_id)
        )
    statement = statement.order_by(FriendLink.position.asc(), FriendLink.id.asc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())
    next_cursor = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = cursors.encode_cursor(
            position=int(last.position), entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def admin_detail_out(session: Session, link: FriendLink) -> schemas.FriendLinkAdminOut:
    tags = _tags_for(session, [link]).get(link.id, ())
    avatars = _avatars_for(session, [link])
    return schemas.FriendLinkAdminOut(
        id=link.id,
        name=link.name,
        url=link.url,
        summary=link.summary,
        story=link.story,
        arcana=link.arcana,
        avatar_media_id=link.avatar_media_id,
        avatar=avatars.get(link.avatar_media_id) if link.avatar_media_id else None,
        tags=[schemas.FriendTagOut(name=tag.name, normalized=tag.normalized) for tag in tags],
        position=int(link.position),
        status=link.status,
        published_at=link.published_at,
        created_at=link.created_at,
        updated_at=link.updated_at,
        deleted_at=link.deleted_at,
        version=int(link.version),
    )


def admin_list_out(
    session: Session, links: Sequence[FriendLink]
) -> list[schemas.FriendLinkAdminOut]:
    return [admin_detail_out(session, link) for link in links]


# --- 写入 -------------------------------------------------------------------


def normalize_url(raw: str) -> str:
    """校验并规范化公开地址；非法输入转成 422 的字段级错误（不静默清空）。"""
    try:
        return normalize_external_url(raw)
    except ValueError as error:
        raise _unprocessable(str(error), "url") from None


def normalize_tags(values: Iterable[str]) -> list[tuple[str, str]]:
    """标签列表 → [(展示名, 规范值)]；同一友链内规范值重复 → 422。"""
    items = list(values)
    if len(items) > MAX_TAGS_PER_LINK:
        raise _unprocessable(f"一条友链最多 {MAX_TAGS_PER_LINK} 个标签", "tags")
    collected: list[tuple[str, str]] = []
    seen: set[str] = set()
    for value in items:
        text = (value or "").strip()
        normalized = normalize_for_match(text)
        if not normalized:
            raise _unprocessable("标签不能只有空白", "tags")
        if normalized in seen:
            raise _unprocessable(f"标签重复：{text}", "tags")
        seen.add(normalized)
        collected.append((text, normalized))
    return collected


def replace_tags(session: Session, link: FriendLink, tags: Sequence[tuple[str, str]]) -> None:
    """完整替换标签列表（05 §7「关系列表完整替换」）。"""
    session.execute(delete(FriendLinkTag).where(FriendLinkTag.friend_link_id == link.id))
    session.flush()
    for name, normalized in tags:
        session.add(FriendLinkTag(friend_link_id=link.id, name=name, normalized=normalized))
    session.flush()
    session.expire(link, ["tags"])


def resolve_avatar_media_id(session: Session, media_id: uuid.UUID | None) -> uuid.UUID | None:
    """头像必须指向一个 ready 且未删除的媒体；否则 422（不静默丢掉站主的选择）。"""
    if media_id is None:
        return None
    media = media_service.get_media(session, media_id)
    if media is None:
        raise _unprocessable("头像媒体不存在", "avatar_media_id")
    if media.deleted_at is not None:
        raise _unprocessable("这张图已被撤回，不能作为新头像", "avatar_media_id")
    if not media.is_ready:
        raise _unprocessable("这张图还没有处理完成，不能作为头像", "avatar_media_id")
    return media.id


def create_link(
    session: Session,
    *,
    name: str,
    url: str,
    summary: str = "",
    story: str | None = None,
    arcana: str | None = None,
    tags: Sequence[tuple[str, str]] = (),
    avatar_media_id: uuid.UUID | None = None,
    position: int = 0,
    now: datetime | None = None,
) -> FriendLink:
    """新建总是草稿：是否公开由 `publish` 决定（站主先整理，再上线）。"""
    moment = now or utcnow()
    link = FriendLink(
        name=name.strip(),
        url=normalize_url(url),
        summary=(summary or "").strip(),
        story=_clean_optional(story),
        arcana=_clean_optional(arcana),
        avatar_media_id=resolve_avatar_media_id(session, avatar_media_id),
        position=int(position),
        status=STATUS_DRAFT,
        published_at=None,
        created_at=moment,
        updated_at=moment,
        version=1,
    )
    session.add(link)
    session.flush()
    replace_tags(session, link, tags)
    session.commit()
    session.refresh(link)
    return link


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def update_link(
    session: Session,
    link: FriendLink,
    *,
    changes: Mapping[str, object],
    now: datetime | None = None,
) -> FriendLink:
    """按字段更新；`tags` 出现时完整替换；版本递增（05 §2 / §7）。"""
    moment = now or utcnow()
    if "name" in changes:
        link.name = str(changes["name"]).strip()
    if "url" in changes:
        link.url = normalize_url(str(changes["url"]))
    if "summary" in changes:
        link.summary = str(changes["summary"] or "").strip()
    if "story" in changes:
        link.story = _clean_optional(changes["story"])  # type: ignore[arg-type]
    if "arcana" in changes:
        link.arcana = _clean_optional(changes["arcana"])  # type: ignore[arg-type]
    if "avatar_media_id" in changes:
        link.avatar_media_id = resolve_avatar_media_id(
            session, changes["avatar_media_id"]  # type: ignore[arg-type]
        )
    if "position" in changes:
        link.position = int(changes["position"])  # type: ignore[arg-type]
    if "tags" in changes:
        replace_tags(session, link, changes["tags"])  # type: ignore[arg-type]
    link.bump_version()
    link.updated_at = moment
    session.commit()
    session.refresh(link)
    return link


def assert_publishable(link: FriendLink) -> None:
    """发布前复检地址。手工写库或历史数据里的非法 scheme 不能借发布变成公开外链。"""
    reason = unsafe_url_reason(str(link.url))
    if reason is not None:
        raise ApiError(
            CODE_CONFLICT,
            f"地址不是可用的 http(s) 外链，不能发布：{reason}",
            status_code=409,
            fields={"url": [reason]},
        )


def publish_link(session: Session, link: FriendLink, *, now: datetime | None = None) -> FriendLink:
    moment = now or utcnow()
    assert_publishable(link)
    link.status = STATUS_PUBLISHED
    if link.published_at is None:
        link.published_at = moment
    link.bump_version()
    link.updated_at = moment
    session.commit()
    session.refresh(link)
    return link


def unpublish_link(session: Session, link: FriendLink, *, now: datetime | None = None) -> FriendLink:
    """撤回：回到草稿。`published_at` 保留历史值，公开条件只看 status。"""
    moment = now or utcnow()
    link.status = STATUS_DRAFT
    link.bump_version()
    link.updated_at = moment
    session.commit()
    session.refresh(link)
    return link


def soft_delete_link(session: Session, link: FriendLink, *, now: datetime | None = None) -> None:
    """软删除。**不删除媒体对象**，也不影响同一张图在其他友链上的公开引用。"""
    moment = now or utcnow()
    link.deleted_at = moment
    link.bump_version()
    link.updated_at = moment
    session.commit()
