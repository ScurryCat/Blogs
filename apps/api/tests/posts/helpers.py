"""文章测试辅助：造公开 / 草稿 / 已撤回文章与标签关联。

每个用例都用**唯一 category / 唯一标签名**（`unique_category()`），
这样即使临时库里还留着别的用例（或 CLI 测试）提交过的文章，断言也不会串味。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.posts.models import STATUS_DRAFT, STATUS_PUBLISHED, Post
from app.modules.tags import service as tags_service
from app.modules.tags.models import post_tags

UTC = timezone.utc


def unique_category(prefix: str = "T01") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def unique_tag(prefix: str = "标签") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def make_post(
    session: Session,
    *,
    slug: str | None = None,
    title: str = "测试文章",
    category: str = "",
    status: str = STATUS_PUBLISHED,
    published_at: datetime | None = None,
    display_date: date | None = None,
    excerpt: str = "",
    content_md: str = "## 标题\n\n正文内容。",
    tags: tuple[str, ...] = (),
    cover_media_id=None,
    deleted_at: datetime | None = None,
    commit: bool = False,
) -> Post:
    post = Post(
        slug=slug or f"post-{uuid.uuid4().hex[:12]}",
        title=title,
        excerpt=excerpt,
        content_md=content_md,
        category=category,
        status=status,
        published_at=published_at if published_at is not None else datetime.now(UTC) - timedelta(days=1),
        display_date=display_date,
        cover_media_id=cover_media_id,
        deleted_at=deleted_at,
    )
    session.add(post)
    session.flush()
    if tags:
        for tag in tags_service.get_or_create_tags(session, list(tags)):
            session.execute(post_tags.insert().values(post_id=post.id, tag_id=tag.id))
        session.flush()
    if commit:
        session.commit()
    return post


def make_draft(session: Session, **kwargs) -> Post:
    kwargs.setdefault("status", STATUS_DRAFT)
    kwargs.setdefault("published_at", None)
    return make_post(session, **kwargs)
