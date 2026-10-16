"""文章读取服务（05 §6）。

公开条件（三者的**同时**满足，写在 SQL 里而不是浏览器里）：
    status = 'published' AND deleted_at IS NULL AND published_at <= now()

排序 `(published_at DESC, id DESC)` + 不透明游标：同一时间戳的多篇文章分页不漏不重。
按标签筛选走 `post_tags` 关联（该关系表由 tags 模块拥有，这里只读）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Select, func, select, tuple_
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.text import normalize_tag_slug
from app.modules.media.models import STATUS_READY, Media
from app.modules.posts.models import STATUS_PUBLISHED, Post
from app.modules.tags.models import Tag, post_tags


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        Post.status == STATUS_PUBLISHED,
        Post.deleted_at.is_(None),
        Post.published_at.is_not(None),
        Post.published_at <= moment,
    ]


def _filter_fingerprint(category: str | None, tag: str | None) -> str:
    return filter_fingerprint({"category": category, "tag": tag})


def list_public_posts(
    session: Session,
    *,
    category: str | None = None,
    tag: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[Post], str | None]:
    """返回 (文章列表, next_cursor)。游标与当前筛选不一致时抛 400。"""
    bounded = clamp_limit(limit)
    fingerprint = _filter_fingerprint(category, tag)

    statement: Select = select(Post).where(*public_conditions(now))
    if category:
        statement = statement.where(Post.category == category.strip())
    if tag:
        slug = normalize_tag_slug(tag)
        statement = statement.where(
            Post.id.in_(
                select(post_tags.c.post_id)
                .join(Tag, Tag.id == post_tags.c.tag_id)
                .where(Tag.slug == slug)
            )
        )

    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        # 与排序键一一对应的游标比较：同时间戳时靠 id 继续向后，不漏不重。
        statement = statement.where(
            tuple_(Post.published_at, Post.id) < tuple_(sort_value, entity_id)
        )

    statement = statement.order_by(Post.published_at.desc(), Post.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.published_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_post(session: Session, slug: str, *, now: datetime | None = None) -> Post | None:
    """按 slug 取公开文章。草稿 / 已删除 / 未到发布时间 / 不存在都返回 None（统一 404）。"""
    if not slug or len(slug) > 200:
        return None
    return session.execute(
        select(Post).where(Post.slug == slug, *public_conditions(now))
    ).scalars().first()


def tags_for_posts(session: Session, post_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Tag]]:
    """批量取文章标签，避免列表页 N+1 查询。"""
    if not post_ids:
        return {}
    rows = session.execute(
        select(post_tags.c.post_id, Tag)
        .join(Tag, Tag.id == post_tags.c.tag_id)
        .where(post_tags.c.post_id.in_(post_ids))
        .order_by(Tag.slug.asc())
    ).all()
    grouped: dict[uuid.UUID, list[Tag]] = {}
    for post_id, tag in rows:
        grouped.setdefault(post_id, []).append(tag)
    return grouped


def ready_covers(session: Session, media_ids: list[uuid.UUID]) -> dict[uuid.UUID, Media]:
    """批量取公开可用的封面媒体（ready + 未删除）。"""
    wanted = [media_id for media_id in media_ids if media_id is not None]
    if not wanted:
        return {}
    rows = session.execute(
        select(Media).where(
            Media.id.in_(wanted),
            Media.status == STATUS_READY,
            Media.deleted_at.is_(None),
        )
    ).scalars()
    return {row.id: row for row in rows}


def public_post_exists_for_media(session: Session, media_id: uuid.UUID) -> bool:
    """该媒体是否是某篇公开文章的封面（媒体公开引用检查用，只读）。"""
    statement = select(func.count()).select_from(Post).where(
        Post.cover_media_id == media_id, *public_conditions()
    )
    return bool(session.execute(statement).scalar())
