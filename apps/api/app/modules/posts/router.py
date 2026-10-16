"""公开文章路由（05 §6）。

  GET /posts             category、tag、cursor、limit（默认 12、最大 30）
  GET /posts/{slug}      正文与公开元信息；草稿 / 删除 / 不存在统一 404

响应契约：
  - 列表 `{"items": [], "next_cursor": null}`；详情直接是对象（不套 data）。
  - 无效游标、游标与筛选不一致 → 400；`limit` 超界 → 422（字段级错误）。
  - 数据库故障 → 503（由 core.errors 的 DBAPIError 处理器统一保证），**不是 404**。
  - 公开动态数据首版不共享缓存（01 §6）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.deps import get_session
from app.core.errors import CODE_NOT_FOUND, ApiError
from app.core.http import no_store
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT
from app.modules.posts import service
from app.modules.posts.schemas import (
    PostDetailOut,
    PostListOut,
    post_detail_out,
    post_summary_out,
)

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=PostListOut, summary="公开文章列表")
def list_posts(
    response: Response,
    category: str | None = Query(default=None, max_length=64),
    tag: str | None = Query(default=None, max_length=80),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> PostListOut:
    no_store(response)
    posts, next_cursor = service.list_public_posts(
        session, category=category, tag=tag, cursor=cursor, limit=limit
    )
    tags_map = service.tags_for_posts(session, [post.id for post in posts])
    covers = service.ready_covers(session, [post.cover_media_id for post in posts])
    items = [
        post_summary_out(
            post,
            tags=tags_map.get(post.id, []),
            cover=covers.get(post.cover_media_id) if post.cover_media_id else None,
        )
        for post in posts
    ]
    return PostListOut(items=items, next_cursor=next_cursor)


@router.get("/{slug}", response_model=PostDetailOut, summary="公开文章详情")
def read_post(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> PostDetailOut:
    no_store(response)
    post = service.get_public_post(session, slug)
    if post is None:
        # 草稿、已删除、未到发布时间与不存在完全同形。
        raise ApiError(CODE_NOT_FOUND, "文章不存在或不可访问", status_code=404)
    tags_map = service.tags_for_posts(session, [post.id])
    covers = service.ready_covers(session, [post.cover_media_id] if post.cover_media_id else [])
    return post_detail_out(
        post,
        tags=tags_map.get(post.id, []),
        cover=covers.get(post.cover_media_id) if post.cover_media_id else None,
    )
