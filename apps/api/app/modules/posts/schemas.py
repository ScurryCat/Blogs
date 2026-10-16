"""文章 DTO（05 §6）。

公开与管理的字段集**在类型层面**分开：
  - `PostSummaryOut` / `PostDetailOut` 只含公开字段：id / slug / title / excerpt /
    category / display_date / published_at / tags / cover。
  - 不含 `status`、`version`、`deleted_at`、`created_at`、`updated_at`、
    `storage_key` 或任何内部路径 —— 站主登录后读公共端点也不会多拿草稿（05 §7）。

`content_md` 只在详情返回（列表不返回正文）。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.modules.media.models import Media
from app.modules.media.schemas import MediaPublicOut, media_public_out
from app.modules.posts.models import Post
from app.modules.tags.models import Tag
from app.modules.tags.schemas import TagPublicOut, tag_public_out


class PostSummaryOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    excerpt: str
    category: str
    display_date: date | None
    published_at: datetime
    tags: list[TagPublicOut]
    cover: MediaPublicOut | None


class PostDetailOut(PostSummaryOut):
    content_md: str


class PostListOut(BaseModel):
    """列表统一结构（05 §6）：`{items, next_cursor}`；没有下一页时 `next_cursor` 为 null。"""

    items: list[PostSummaryOut]
    next_cursor: str | None


def _cover_out(media: Media | None) -> MediaPublicOut | None:
    if media is None or media.deleted_at is not None:
        return None
    return media_public_out(media)


def post_summary_out(post: Post, *, tags: list[Tag] | None = None, cover: Media | None = None) -> PostSummaryOut:
    return PostSummaryOut(
        id=post.id,
        slug=post.slug,
        title=post.title,
        excerpt=post.excerpt or "",
        category=post.category or "",
        display_date=post.display_date,
        published_at=post.published_at,
        tags=[tag_public_out(tag) for tag in (tags or [])],
        cover=_cover_out(cover),
    )


def post_detail_out(post: Post, *, tags: list[Tag] | None = None, cover: Media | None = None) -> PostDetailOut:
    summary = post_summary_out(post, tags=tags, cover=cover)
    return PostDetailOut(**summary.model_dump(), content_md=post.content_md or "")
