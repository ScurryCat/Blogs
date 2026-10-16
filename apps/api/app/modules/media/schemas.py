"""媒体 DTO（05 §6 / §8）。

两个 DTO 严格分开：
  - `MediaAdminOut`：站主自己看的上传结果，含 sha256 与全部变体（含 `original`）。
  - `MediaPublicOut`：交给公开内容（文章封面、后续动态图片）嵌入的形态，
    只有 id / 宽高 / 变体 URL。

两者都**不含** `storage_key`、原始文件名、绝对路径、owner、软删除时间。
URL 一律是本站相对地址（05 §6：不返回任意第三方地址）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.modules.media.models import Media
from app.modules.media.storage import ALLOWED_VARIANT_NAMES, ORIGINAL_VARIANT

# 与 app.router.API_V1_PREFIX 一致（SHARED-CONTRACTS §5：所有业务路由在 /api/v1 下）。
API_V1_PREFIX = "/api/v1"


class MediaVariantOut(BaseModel):
    name: str
    width: int
    height: int
    bytes: int
    url: str


class MediaPublicOut(BaseModel):
    id: uuid.UUID
    width: int
    height: int
    variants: list[MediaVariantOut]


class MediaAdminOut(BaseModel):
    id: uuid.UUID
    mime_type: str
    bytes: int
    width: int
    height: int
    sha256: str
    status: str
    created_at: datetime
    variants: list[MediaVariantOut]
    original_url: str


def variant_url(media_id: uuid.UUID, name: str) -> str:
    return f"{API_V1_PREFIX}/media/{media_id}/{name}"


def _variant_payloads(media: Media, *, include_original: bool) -> list[MediaVariantOut]:
    payloads: list[MediaVariantOut] = []
    if include_original:
        payloads.append(
            MediaVariantOut(
                name=ORIGINAL_VARIANT,
                width=media.width,
                height=media.height,
                bytes=media.bytes,
                url=variant_url(media.id, ORIGINAL_VARIANT),
            )
        )
    variants = media.variants or {}
    for name in ALLOWED_VARIANT_NAMES:
        if name == ORIGINAL_VARIANT:
            continue
        entry = variants.get(name)
        if not isinstance(entry, dict):
            continue
        payloads.append(
            MediaVariantOut(
                name=name,
                width=int(entry.get("width", 0)),
                height=int(entry.get("height", 0)),
                bytes=int(entry.get("bytes", 0)),
                url=variant_url(media.id, name),
            )
        )
    return payloads


def media_public_out(media: Media) -> MediaPublicOut:
    return MediaPublicOut(
        id=media.id,
        width=media.width,
        height=media.height,
        variants=_variant_payloads(media, include_original=False),
    )


def media_admin_out(media: Media) -> MediaAdminOut:
    return MediaAdminOut(
        id=media.id,
        mime_type=media.mime_type,
        bytes=media.bytes,
        width=media.width,
        height=media.height,
        sha256=media.sha256,
        status=media.status,
        created_at=media.created_at,
        variants=_variant_payloads(media, include_original=True),
        original_url=variant_url(media.id, ORIGINAL_VARIANT),
    )
