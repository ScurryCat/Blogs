"""COOP 友链 DTO（05 §6 公开 / §7 管理）。

两个 DTO 严格分开：

  - `FriendLinkSummaryOut` / `FriendLinkDetailOut`：公开形态。只有站名、http(s) 地址、
    简介、标签（展示名）、可选阿尔卡那装饰、可空头像与「有没有相识故事」。
    详情比列表**只多一个 `story`**，没有别的内部字段。
  - `FriendLinkAdminOut`：站主管理形态。多出草稿状态、软删除时间、版本、
    `avatar_media_id` 与全部标签（含规范值）。
    也**没有**点击量、排名、在线状态、最新动态之类字段 —— 这些数据本站根本不存。

头像复用 T01 的 `MediaPublicOut`（id / 宽高 / 变体 URL），因此公开响应里不会有
存储键、原始文件名或原图地址（05 §8：原图仅管理用途）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.coop.models import (
    ARCANA_MAX_LENGTH,
    MAX_TAGS_PER_LINK,
    NAME_MAX_LENGTH,
    POSITION_MAX,
    POSITION_MIN,
    STORY_MAX_LENGTH,
    SUMMARY_MAX_LENGTH,
    TAG_NAME_MAX_LENGTH,
)
from app.modules.coop.urls import URL_MAX_LENGTH
from app.modules.media.schemas import MediaPublicOut


class FriendTagOut(BaseModel):
    """标签的公开形态：只有展示名与规范值（筛选用）。"""

    name: str
    normalized: str


class FriendLinkSummaryOut(BaseModel):
    id: uuid.UUID
    name: str
    url: str
    summary: str
    arcana: str | None
    tags: list[str]
    avatar: MediaPublicOut | None
    # 列表不返回故事正文，只说明「有没有」；详情展开时才取正文（少传正文，也不影响空态判断）。
    has_story: bool


class FriendLinkDetailOut(FriendLinkSummaryOut):
    story: str | None


class FriendLinkListOut(BaseModel):
    items: list[FriendLinkSummaryOut]
    next_cursor: str | None


class FriendTagListOut(BaseModel):
    """公开标签清单（只来自已发布友链），供筛选器使用；不带任何计数或排名。"""

    items: list[FriendTagOut]


class FriendLinkAdminOut(BaseModel):
    id: uuid.UUID
    name: str
    url: str
    summary: str
    story: str | None
    arcana: str | None
    avatar_media_id: uuid.UUID | None
    avatar: MediaPublicOut | None
    tags: list[FriendTagOut]
    position: int
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    version: int


class FriendLinkAdminListOut(BaseModel):
    items: list[FriendLinkAdminOut]
    next_cursor: str | None


def _validate_tag_payload(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    for value in values:
        text = (value or "").strip()
        if not text:
            raise ValueError("标签不能只有空白")
        if len(text) > TAG_NAME_MAX_LENGTH:
            raise ValueError(f"单个标签最长 {TAG_NAME_MAX_LENGTH} 个字符")
        cleaned.append(text)
    return cleaned


class FriendLinkCreateIn(BaseModel):
    # 未知字段一律 422：把 `status` / `version` 发到 POST 上不会被静默忽略。
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    url: str = Field(min_length=1, max_length=URL_MAX_LENGTH)
    summary: str = Field(default="", max_length=SUMMARY_MAX_LENGTH)
    story: str | None = Field(default=None, max_length=STORY_MAX_LENGTH)
    arcana: str | None = Field(default=None, max_length=ARCANA_MAX_LENGTH)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS_PER_LINK)
    avatar_media_id: uuid.UUID | None = None
    position: int = Field(default=POSITION_MIN, ge=POSITION_MIN, le=POSITION_MAX)
    # CSRF token 允许放在 JSON body（也接受 X-CSRF-Token 请求头，见 core/csrf.py）。
    csrf_token: str | None = Field(default=None, max_length=256)

    @field_validator("name")
    @classmethod
    def _no_blank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("站名不能只有空白")
        return value

    @field_validator("tags")
    @classmethod
    def _tags_not_blank(cls, values: list[str]) -> list[str]:
        return _validate_tag_payload(values)


class FriendLinkUpdateIn(BaseModel):
    """PATCH：只更新**出现过的**字段（`model_fields_set`）；`tags` 传入时完整替换。

    `status` / `slug` / 版本都不在可改字段里：发布与撤回是独立动作，版本只能靠 If-Match 推进。
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX_LENGTH)
    url: str | None = Field(default=None, min_length=1, max_length=URL_MAX_LENGTH)
    summary: str | None = Field(default=None, max_length=SUMMARY_MAX_LENGTH)
    story: str | None = Field(default=None, max_length=STORY_MAX_LENGTH)
    arcana: str | None = Field(default=None, max_length=ARCANA_MAX_LENGTH)
    tags: list[str] | None = Field(default=None, max_length=MAX_TAGS_PER_LINK)
    avatar_media_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=POSITION_MIN, le=POSITION_MAX)
    csrf_token: str | None = Field(default=None, max_length=256)

    @field_validator("name")
    @classmethod
    def _no_blank_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("站名不能只有空白")
        return value

    @field_validator("tags")
    @classmethod
    def _tags_not_blank(cls, values: list[str] | None) -> list[str] | None:
        return None if values is None else _validate_tag_payload(values)


class FriendLinkActionIn(BaseModel):
    """发布 / 撤回 / 删除的无实体请求体：只承载 CSRF token。"""

    model_config = ConfigDict(extra="forbid")

    csrf_token: str | None = Field(default=None, max_length=256)


__all__ = [
    "FriendLinkActionIn",
    "FriendLinkAdminListOut",
    "FriendLinkAdminOut",
    "FriendLinkCreateIn",
    "FriendLinkDetailOut",
    "FriendLinkListOut",
    "FriendLinkSummaryOut",
    "FriendLinkUpdateIn",
    "FriendTagListOut",
    "FriendTagOut",
]
