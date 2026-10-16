"""相册 / 照片 DTO（05 §6 公开 / §7 管理、07 §5）。

公开与管理的字段集**在类型层面**分开（05 §7）：

  - 公开（`AlbumSummaryOut` / `AlbumDetailOut` / `PhotoOut`）：只含 slug、标题、
    说明、类型、实时照片数、已发布且 ready 的图片与逐场景说明。
    **不含** status / version / deleted_at / 未 ready 的关系。
  - 管理（`AlbumAdminOut`）：含 `version`（配 ETag）、状态、position、**完整**关系
    （含 not-ready / 已删除媒体，如实标出），用于表单回显与预览。

`taken_on` 与 `caption` 都可空（07 §5「说明与拍摄时间可选」）：素材没有这些信息时
就是 `null`，不替站主编一个日期或描述。`alt` 必填（验收「图片有 alt」）。

照片的展示尺寸来自 `media` 行（宽高由 T01 的媒体服务记录），因此前端可以按**自然
比例**排图格，而不必等图片加载完才知道宽高、也就不必为布局猜一个裁切比例。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.gallery.models import (
    ALBUM_KINDS,
    ALBUM_STATUSES,
    ALT_MAX_CODEPOINTS,
    CAPTION_MAX_LENGTH,
    DEFAULT_KIND,
    KIND_LABELS,
    MAX_MEDIA_PER_ALBUM,
    POSITION_MAX,
    TITLE_MAX_LENGTH,
    Album,
)
from app.modules.media.models import Media
from app.modules.media.schemas import MediaVariantOut, _variant_payloads

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

AlbumStatus = Literal["draft", "published"]
AlbumKind = Literal["photo", "screenshot", "other"]

DESCRIPTION_MAX_LENGTH = 1000
# 照片墙一次最多返回多少张：与相册上限一致，避免一次请求把整个图库拉进内存。
PHOTOS_MAX_LIMIT = 200


class PhotoOut(BaseModel):
    """一张照片的公开形态：关系字段 + 媒体尺寸 + 可用变体（**不含原图**）。"""

    media_id: uuid.UUID
    position: int
    alt: str
    caption: str
    taken_on: date | None
    width: int
    height: int
    variants: list[MediaVariantOut]


class PhotoAdminOut(PhotoOut):
    """管理回执：额外给出媒体状态，让表单能提示「这张图还不能发布」。"""

    media_status: str = "ready"
    media_deleted: bool = False
    album_id: uuid.UUID | None = None
    album_slug: str | None = None
    album_title: str | None = None


class AlbumSummaryOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    description: str
    kind: str
    kind_label: str
    photo_count: int
    published_at: datetime
    cover: PhotoOut | None


class AlbumDetailOut(AlbumSummaryOut):
    photos: list[PhotoOut]


class AlbumListOut(BaseModel):
    items: list[AlbumSummaryOut]
    next_cursor: str | None


class PhotoItemOut(BaseModel):
    """照片墙上的一项：照片 + **它属于哪个相册**。

    为什么把相册信息放在每一项里而不是让前端按相册再查一次：跨相册的照片墙是
    「相册 + 照片顺序」的混合排序，前端需要能就地渲染分组标题；再查一次相册
    会产生 N+1，也会让「同一张图属于两个相册」这种真实情况无法表达。
    """

    photo: PhotoOut
    album: "WallAlbumOut"


class WallAlbumOut(BaseModel):
    """照片墙上引用的最小相册信息（不含草稿状态与版本，公开 DTO 不能夹带管理字段）。"""

    id: uuid.UUID
    slug: str
    title: str
    kind: str
    kind_label: str
    position: int


class PhotoListOut(BaseModel):
    """照片墙的扁平列表。`total` 是当前筛选下的实时总张数，不作为权限条件。"""

    items: list[PhotoItemOut]
    next_cursor: str | None
    total: int


# --- 管理 DTO ---------------------------------------------------------------


class AlbumPhotoIn(BaseModel):
    """相册里的一张照片。`media_id` 必须是**已有**媒体（复用，不重复上传 —— 07 §5）。"""

    model_config = ConfigDict(extra="forbid")

    media_id: uuid.UUID
    position: int = Field(ge=0, le=MAX_MEDIA_PER_ALBUM - 1)
    alt: str = Field(min_length=1, max_length=ALT_MAX_CODEPOINTS)
    caption: str = Field(default="", max_length=CAPTION_MAX_LENGTH)
    # 拍摄 / 截图时间可空（07 §5）：没有 EXIF 或站主不填就是 NULL。
    taken_on: date | None = None

    @field_validator("alt")
    @classmethod
    def _alt_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("替代文本不能只有空白")
        return text

    @field_validator("caption")
    @classmethod
    def _caption_trim(cls, value: str) -> str:
        return (value or "").strip()


class AlbumCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=200, pattern=SLUG_PATTERN)
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)
    kind: AlbumKind = DEFAULT_KIND
    position: int = Field(default=0, ge=0, le=POSITION_MAX)
    photos: list[AlbumPhotoIn] = Field(default_factory=list, max_length=MAX_MEDIA_PER_ALBUM)

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("标题不能只有空白")
        return text

    @field_validator("description")
    @classmethod
    def _description_trim(cls, value: str) -> str:
        return (value or "").strip()


class AlbumUpdateIn(BaseModel):
    """PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先）。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)
    kind: AlbumKind | None = None
    position: int | None = Field(default=None, ge=0, le=POSITION_MAX)
    photos: list[AlbumPhotoIn] | None = Field(default=None, max_length=MAX_MEDIA_PER_ALBUM)

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("标题不能只有空白")
        return text


class AlbumAdminOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    description: str
    kind: str
    kind_label: str
    position: int
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int
    photo_count: int
    photos: list[PhotoAdminOut]


class AlbumAdminListOut(BaseModel):
    items: list[AlbumAdminOut]
    next_cursor: str | None


def photo_payload(
    media: Media, *, position: int, alt: str, caption: str, taken_on: date | None
) -> PhotoOut:
    return PhotoOut(
        media_id=media.id,
        position=position,
        alt=alt,
        caption=caption,
        taken_on=taken_on,
        width=int(media.width),
        height=int(media.height),
        # 公开图片**永不**包含 original 变体（05 §8：原图只给站主）。
        variants=_variant_payloads(media, include_original=False),
    )


def photo_admin_payload(
    media: Media,
    *,
    position: int,
    alt: str,
    caption: str,
    taken_on: date | None,
    album: Album | None = None,
) -> PhotoAdminOut:
    public = photo_payload(media, position=position, alt=alt, caption=caption, taken_on=taken_on)
    return PhotoAdminOut(
        **public.model_dump(),
        media_status=str(media.status),
        media_deleted=media.deleted_at is not None,
        album_id=album.id if album else None,
        album_slug=album.slug if album else None,
        album_title=album.title if album else None,
    )


def wall_album_out(album: Album) -> WallAlbumOut:
    return WallAlbumOut(
        id=album.id,
        slug=album.slug,
        title=album.title,
        kind=str(album.kind),
        kind_label=KIND_LABELS.get(str(album.kind), ""),
        position=int(album.position),
    )


def cover_of(photos: list[PhotoOut]) -> PhotoOut | None:
    """相册封面 = 顺序最小的那张照片。没有照片时是 None（不放假占位图）。"""
    if not photos:
        return None
    return min(photos, key=lambda photo: photo.position)


def album_summary_out(
    album: Album, *, photos: list[PhotoOut], photo_count: int | None = None
) -> AlbumSummaryOut:
    return AlbumSummaryOut(
        id=album.id,
        slug=album.slug,
        title=album.title,
        description=album.description,
        kind=str(album.kind),
        kind_label=KIND_LABELS.get(str(album.kind), ""),
        photo_count=len(photos) if photo_count is None else photo_count,
        published_at=album.published_at,
        cover=cover_of(photos),
    )


def album_detail_out(album: Album, *, photos: list[PhotoOut]) -> AlbumDetailOut:
    return AlbumDetailOut(
        **album_summary_out(album, photos=photos).model_dump(),
        photos=photos,
    )


def album_admin_out(
    album: Album, *, photos: list[PhotoAdminOut], photo_count: int | None = None
) -> AlbumAdminOut:
    return AlbumAdminOut(
        id=album.id,
        slug=album.slug,
        title=album.title,
        description=album.description,
        kind=str(album.kind),
        kind_label=KIND_LABELS.get(str(album.kind), ""),
        position=int(album.position),
        status=str(album.status),
        published_at=album.published_at,
        created_at=album.created_at,
        updated_at=album.updated_at,
        version=int(album.version),
        photo_count=len(photos) if photo_count is None else photo_count,
        photos=photos,
    )


__all__ = [
    "ALBUM_KINDS",
    "ALBUM_STATUSES",
    "AlbumAdminListOut",
    "AlbumAdminOut",
    "AlbumCreateIn",
    "AlbumDetailOut",
    "AlbumListOut",
    "AlbumPhotoIn",
    "AlbumSummaryOut",
    "AlbumUpdateIn",
    "DESCRIPTION_MAX_LENGTH",
    "PHOTOS_MAX_LIMIT",
    "PhotoAdminOut",
    "PhotoItemOut",
    "PhotoListOut",
    "PhotoOut",
    "SLUG_PATTERN",
    "WallAlbumOut",
    "album_admin_out",
    "album_detail_out",
    "album_summary_out",
    "cover_of",
    "photo_admin_payload",
    "photo_payload",
    "wall_album_out",
]

PhotoItemOut.model_rebuild()
