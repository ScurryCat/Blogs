"""媒体路由（05 §6 / §7 / §8）。

  GET  /media/{id}/{variant}   公开读取；原图、未 ready、被删除、无公开引用一律 404
  POST /admin/media            multipart 单图上传（站主 + CSRF + Origin）

要点：
  - 变体名是**固定枚举**（original / w320.webp / w640.webp / w1280.webp），
    不接受任意路径或文件名；猜测的变体名与路径穿越都直接 404。
  - 媒体卷不挂成静态目录：文件只能从这里出去，每次请求都重新校验授权。
  - 响应头带 `X-Content-Type-Options: nosniff` 与 `private, no-store`（05 §8：
    首版不共享缓存，避免「撤回」与缓存延迟混在一起）。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Response, UploadFile
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.deps import get_media_root, get_session, get_settings_dep
from app.core.http import private_no_store
from app.modules.auth.deps import AdminContext, optional_admin, require_admin_write
from app.modules.media import service
from app.modules.media.pipeline import ImageLimits
from app.modules.media.schemas import MediaAdminOut, media_admin_out
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
