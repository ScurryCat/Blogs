"""图文动态 DTO（05 §6 / §7）。

三个形态严格分开：

  - `MomentOut` / `MomentListOut`：**公开**响应。字段只有
    `id / text / tags[] / published_at / images[]`，其中每张图是
    `media_id / position / alt / width / height / variants[]`。
    **不含** `status`、`version`、`deleted_at`、`created_at`、`updated_at`、
    `storage_key`、原始文件名或任何内部路径 —— 站主登录后读公共端点也不会多拿草稿。
  - `MomentAdminOut`：管理响应。在公开字段之外加 `status` / `version` /
    `created_at` / `updated_at`，并给出可直接回填的 `images[]`（只有
    `media_id / position / alt`），因此管理表单「读回来 → 改 → 提交」不需要
    自己从公开变体数组里反推顺序关系。
  - `MomentCreateIn` / `MomentUpdateIn`：写入。字段级约束全部落在这里，
    越界由 FastAPI 统一映射成 422 + 字段级错误（05 §9）。

列表统一 `{items, next_cursor}`（05 §6）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.text import codepoint_length
from app.modules.media.models import Media
from app.modules.media.schemas import MediaVariantOut, media_public_out
from app.modules.moments.models import (
    IMAGES_MAX,
    TAGS_MAX,
    TAG_MAX_CODEPOINTS,
    TEXT_MAX_CODEPOINTS,
    Moment,
)
from app.modules.tags.models import Tag
from app.modules.tags.schemas import TagPublicOut, tag_public_out

# 单条动态最多 9 张图（IMAGES_MAX）：album_links 里一个相册的 media_ids 超过它一定是
# 无效输入；相册数量没有业务上限，给一个防御性的数组上限即可。
ALBUM_LINKS_MAX = 200

# --- 写入 -----------------------------------------------------------------


class MomentTagListMixin(BaseModel):
    """标签输入的共用校验：去空白、去重、去空、最多 8 个、单个 1–24 码点。"""

    @field_validator("tags", check_fields=False)
    @classmethod
    def _clean_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for raw in value:
            name = (raw or "").strip()
            if not name:
                continue  # 空标签直接丢弃，不当成合法标签
            if codepoint_length(name) > TAG_MAX_CODEPOINTS:
                raise ValueError(f"单个标签最多 {TAG_MAX_CODEPOINTS} 个字符")
            if name not in cleaned:  # 去重（保留首次出现的顺序）
                cleaned.append(name)
        if len(cleaned) > TAGS_MAX:
            raise ValueError(f"最多 {TAGS_MAX} 个标签")
        return cleaned


class MomentImageIn(BaseModel):
    """一张图的引用。`position` 必须从 0 开始连续且不重复。"""

    media_id: uuid.UUID
    position: int = Field(ge=0, le=IMAGES_MAX - 1)
    alt: str = Field(min_length=1, max_length=200)


class MomentAlbumLinkIn(BaseModel):
    """「同时收录到相册」的一条选择：目标相册 + 本条动态里的图片。

    语义（任务书 §4.3）：传 `album_links` 时是**完整选择**；`[]` 表示清空；
    不传表示保留原配置（但服务端会清掉已不属于该动态的图片配置）。
    `media_ids` 必须是「本条动态当前图片」的子集；非法相册 / 媒体由服务端返回 409。
    """

    model_config = ConfigDict(extra="forbid")

    album_id: uuid.UUID
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=IMAGES_MAX)


class MomentAlbumLinksMixin(BaseModel):
    """`album_links` 的共用校验：同一相册不能在一个请求里出现两次。"""

    @model_validator(mode="after")
    def _album_links_unique_albums(self) -> "MomentAlbumLinksMixin":
        links = getattr(self, "album_links", None)
        if links is None:
            return self
        album_ids = [link.album_id for link in links]
        if len(set(album_ids)) != len(album_ids):
            raise ValueError("album_links 中同一相册不能重复出现")
        return self


class MomentCreateIn(MomentTagListMixin, MomentAlbumLinksMixin):
    """新建草稿。草稿可以暂时没有图片、替代文本也可以发布前补齐（03 §5）。"""

    text: str = Field(default="", max_length=TEXT_MAX_CODEPOINTS)
    images: list[MomentImageIn] = Field(default_factory=list, max_length=IMAGES_MAX)
    tags: list[str] = Field(default_factory=list, max_length=TAGS_MAX)
    # 草稿阶段也可以先配置收录；动态发布前不贡献公开资格。
    album_links: list[MomentAlbumLinkIn] = Field(
        default_factory=list, max_length=ALBUM_LINKS_MAX
    )

    @model_validator(mode="after")
    def _positions_contiguous(self) -> "MomentCreateIn":
        assert_contiguous_positions([image.position for image in self.images])
        return self


class MomentUpdateIn(MomentTagListMixin, MomentAlbumLinksMixin):
    """更新。所有字段可选；传入 `images` 时**完整替换**有序关系（05 §7）。

    `album_links` 的「不传」与「传 []」语义不同（任务书 §4.3）：
    不传 = 保留原收录配置；[] = 清空该动态全部收录选择。
    """

    text: str | None = Field(default=None, max_length=TEXT_MAX_CODEPOINTS)
    images: list[MomentImageIn] | None = Field(default=None, max_length=IMAGES_MAX)
    tags: list[str] | None = Field(default=None, max_length=TAGS_MAX)
    album_links: list[MomentAlbumLinkIn] | None = Field(
        default=None, max_length=ALBUM_LINKS_MAX
    )

    @model_validator(mode="after")
    def _positions_contiguous(self) -> "MomentUpdateIn":
        if self.images is not None:
            assert_contiguous_positions([image.position for image in self.images])
        return self


def assert_contiguous_positions(positions: list[int]) -> None:
    """图片顺序必须从 0 开始、连续、唯一（03 §5「图片顺序从 0 开始，位置唯一」）。

    连续性是刻意的：断开的位置（0,2）在界面上没有意义，而「顺序」在数据库里
    只有唯一约束，不连续要靠服务端拒绝，避免出现「第 2 张图不见了」的静默错位。
    """
    if sorted(positions) != list(range(len(positions))):
        raise ValueError("图片顺序必须从 0 开始且连续、不重复")


# --- 公开读取 -------------------------------------------------------------


class MomentImageOut(BaseModel):
    media_id: uuid.UUID
    position: int
    alt: str
    width: int
    height: int
    variants: list[MediaVariantOut]


class MomentOut(BaseModel):
    id: uuid.UUID
    text: str
    tags: list[TagPublicOut]
    # 公开端点上永远是具体时间；可空是因为管理回执复用同一形状（草稿没有发布时间）。
    published_at: datetime | None
    images: list[MomentImageOut]


class MomentListOut(BaseModel):
    """列表统一结构（05 §6）：`{items, next_cursor}`。"""

    items: list[MomentOut]
    next_cursor: str | None


# --- 管理读取 / 写入回执 ---------------------------------------------------


class MomentImageAdminOut(BaseModel):
    """可直接回填到 `MomentUpdateIn.images` 的形状（只有三个写入字段）。"""

    media_id: uuid.UUID
    position: int
    alt: str


class MomentAlbumLinkOut(BaseModel):
    """管理回执里的当前收录选择：`{album_id, media_ids[]}`。

    相册按 `(position ASC, id ASC)`；`media_ids` 按动态图片 position 升序。
    草稿 / 撤回状态下也照实返回（配置存在 ≠ 公开资格）。
    """

    album_id: uuid.UUID
    media_ids: list[uuid.UUID]


class MomentAdminOut(MomentOut):
    status: Literal["draft", "published"]
    version: int
    created_at: datetime
    updated_at: datetime
    images_admin: list[MomentImageAdminOut]
    album_links: list[MomentAlbumLinkOut] = Field(default_factory=list)


class MomentAdminListOut(BaseModel):
    items: list[MomentAdminOut]
    next_cursor: str | None


# --- 组装 -----------------------------------------------------------------


def image_out(media: Media, *, position: int, alt: str) -> MomentImageOut:
    return MomentImageOut(
        media_id=media.id,
        position=position,
        alt=alt,
        width=media.width,
        height=media.height,
        variants=media_public_out(media).variants,
    )


def moment_out(
    moment: Moment,
    *,
    tags: list[Tag] | None = None,
    images: list[tuple[Media, int, str]] | None = None,
) -> MomentOut:
    return MomentOut(
        id=moment.id,
        text=moment.text or "",
        tags=[tag_public_out(tag) for tag in (tags or [])],
        published_at=moment.published_at,
        images=[image_out(media, position=position, alt=alt) for media, position, alt in (images or [])],
    )


def moment_admin_out(
    moment: Moment,
    *,
    tags: list[Tag] | None = None,
    images: list[tuple[Media, int, str]] | None = None,
    album_links: list[MomentAlbumLinkOut] | None = None,
) -> MomentAdminOut:
    base = moment_out(moment, tags=tags, images=images)
    return MomentAdminOut(
        **base.model_dump(),
        status=moment.status,
        version=moment.version,
        created_at=moment.created_at,
        updated_at=moment.updated_at,
        images_admin=[
            MomentImageAdminOut(media_id=media.id, position=position, alt=alt)
            for media, position, alt in (images or [])
        ],
        album_links=list(album_links or []),
    )


