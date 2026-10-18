"""媒体路由（05 §6 / §7 / §8；P5 契约 §3.4 补管理侧列表 / 详情）。

公开：

  GET  /media/{id}/{variant}   公开读取；原图、未 ready、被删除、无公开引用一律 404

管理（站主 + `private, no-store`）：

  POST /admin/media            multipart 单图上传（站主 + CSRF + Origin）
  GET  /admin/media            分页列出站主媒体（created_at 倒序；cursor + limit ≤ 30）
  GET  /admin/media/{id}       媒体详情（含 `publicly_referenced` 与尺寸 / 状态）

要点：
  - 变体名是**固定枚举**（original / w320.webp / w640.webp / w1280.webp），
    不接受任意路径或文件名；猜测的变体名与路径穿越都直接 404。
  - 媒体卷不挂成静态目录：文件只能从这里出去，每次请求都重新校验授权。
  - 响应头带 `X-Content-Type-Options: nosniff` 与 `private, no-store`（05 §8：
    首版不共享缓存，避免「撤回」与缓存延迟混在一起）。
  - 管理侧列表 / 详情不改变上传接口契约（仍用现有 `POST /admin/media`）。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.deps import get_media_root, get_session, get_settings_dep
from app.core.errors import CODE_UNPROCESSABLE, ApiError
from app.core.http import private_no_store
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT
from app.modules.auth.deps import (
    AdminContext,
    optional_admin,
    require_admin,
    require_admin_write,
)
from app.modules.media import public_refs, service
from app.modules.media.models import MEDIA_STATUSES
from app.modules.media.pipeline import ImageLimits
from app.modules.media.schemas import (
    MediaAdminListOut,
    MediaAdminOut,
    MediaAdminReferenceOut,
    media_admin_out,
    media_admin_reference_out,
)
from app.modules.media.storage import ALLOWED_VARIANT_NAMES, ORIGINAL_VARIANT

public_router = APIRouter(prefix="/media", tags=["media"])
admin_router = APIRouter(prefix="/admin/media", tags=["admin-media"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)


def limits_from_settings(settings: Settings) -> ImageLimits:
    return ImageLimits(
        max_bytes=settings.media_max_bytes,
        max_pixels=settings.media_max_pixels,
        max_side=settings.media_max_side,
    )


@public_router.get(
    "/{media_id}/{variant}",
    summary="读取媒体变体",
)
def read_media(
    media_id: str,
    variant: str,
    session: Session = Depends(get_session),
    root=Depends(get_media_root),
    admin: AdminContext | None = Depends(optional_admin),
) -> Response:
    """站主可以读原图与已撤回对象；匿名只读有公开引用的 ready 变体。"""
    try:
        parsed_id = uuid.UUID(media_id)
    except (ValueError, AttributeError, TypeError):
        # UUID 解析失败与「不存在」同形：不提供「格式对但不存在」的探测信号。
        raise service.not_found() from None

    if variant not in ALLOWED_VARIANT_NAMES:
        raise service.not_found()

    media = service.get_media(session, parsed_id)
    if media is None:
        raise service.not_found()

    if admin is None:
        service.ensure_anonymous_readable(session, media, variant)
    elif media.deleted_at is not None and variant != ORIGINAL_VARIANT:
        # 站主看已撤回媒体的派生图没有意义，但原图仍可管理访问。
        raise service.not_found()

    resolved = service.resolve_variant(media, variant)
    if resolved is None:
        raise service.not_found()

    data = service.read_object_bytes(root, resolved.key)
    return Response(
        content=data,
        status_code=200,
        headers={
            "Content-Type": resolved.mime_type,
            "Content-Length": str(len(data)),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@admin_router.post(
    "",
    response_model=MediaAdminOut,
    status_code=201,
    summary="上传单张图片（站主）",
    dependencies=[Depends(private_no_store)],
)
async def upload_media(
    file: UploadFile = File(...),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
    root=Depends(get_media_root),
) -> MediaAdminOut:
    """上传 → 校验 → 派生变体 → 文件落位 → 记录 ready。

    任何一步失败都不会返回 201：失败时客户端拿不到「上传成功」的假信号。
    """
    data = await service.read_upload_within_limit(file, max_bytes=settings.media_max_bytes)
    media = await service.create_media(
        session,
        root=root,
        owner_id=context.user.id,
        data=data,
        limits=limits_from_settings(settings),
        max_concurrency=settings.media_max_concurrency,
    )
    return media_admin_out(media)


# --- 管理侧列表 / 详情（P5 共享图片选择器，契约 §3.4）----------------------


def _parse_media_id(value: str) -> uuid.UUID:
    """媒体 ID 必须是 UUID；格式不对与「不存在」同形 404（不给 UUID 探测信号）。"""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


@admin_router.get(
    "",
    response_model=MediaAdminListOut,
    summary="站主媒体分页（共享图片选择器）",
    dependencies=[Depends(private_no_store)],
)
def list_admin_media(
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    status: str | None = Query(default=None, max_length=16),
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> MediaAdminListOut:
    """`created_at DESC, id DESC` 分页；列表项带 `publicly_referenced`。

    公开引用检查走统一的 `media.public_refs.is_publicly_referenced`（只读、带公开
    条件、未登记 = 不公开）。页面大小上限 30，因此这里是「有界」的逐项检查；
    真正的跨域批量查询需要扩展点提供批量接口（见交付单「未完成项」）。
    """
    if status is not None and status not in MEDIA_STATUSES:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "媒体状态筛选不合法",
            status_code=422,
            fields={"status": [f"只能是 {' / '.join(MEDIA_STATUSES)}"]},
        )
    rows, next_cursor = service.list_admin_media(
        session,
        owner_id=context.user.id,
        status=status,
        cursor=cursor,
        limit=limit,
    )
    items = [
        media_admin_reference_out(
            media, publicly_referenced=public_refs.is_publicly_referenced(session, media.id)
        )
        for media in rows
    ]
    return MediaAdminListOut(items=items, next_cursor=next_cursor)


@admin_router.get(
    "/{media_id}",
    response_model=MediaAdminReferenceOut,
    summary="站主媒体详情",
    dependencies=[Depends(private_no_store)],
)
def read_admin_media(
    media_id: str,
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> MediaAdminReferenceOut:
    media = service.get_admin_media(
        session, _parse_media_id(media_id), owner_id=context.user.id
    )
    return media_admin_reference_out(
        media, publicly_referenced=public_refs.is_publicly_referenced(session, media.id)
    )
