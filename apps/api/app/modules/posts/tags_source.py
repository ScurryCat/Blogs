"""文章域对「公开标签来源」的贡献（05 §6：`GET /tags` 只返回有公开内容的标签）。

只统计**公开文章**用到的标签；草稿、已撤回、已删除、未到发布时间的文章都不算，
因此「仅草稿使用的标签」不会出现在公开响应里。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.posts import service
from app.modules.posts.models import Post
from app.modules.tags import service as tags_service
from app.modules.tags.models import post_tags

SOURCE_NAME = "posts"


def public_tag_ids(session: Session) -> set[uuid.UUID]:
    statement = (
        select(post_tags.c.tag_id)
        .join(Post, Post.id == post_tags.c.post_id)
        .where(*service.public_conditions())
        .distinct()
    )
    return {row for row in session.execute(statement).scalars()}


def register() -> None:
    tags_service.register_public_tag_source(SOURCE_NAME, public_tag_ids)


def unregister() -> None:
    """仅测试使用。"""
    tags_service._sources.pop(SOURCE_NAME, None)  # noqa: SLF001 - 与 register 成对的测试后门
