"""异世界导航 DTO（05 §6 公开 / §7 管理）。

公开与管理的字段集**在类型层面**分开：

  - 公开（`PalaceSummaryOut` / `PalaceDetailOut` / `ResolveOut` / `SearchItemOut`）只含
    slug、标题、说明、三项标准关键词、公开文章摘要；**不含** status / version /
    deleted_at / 别名 / 草稿关系（05 §3 / §7「公开响应不因站主登录就顺便返回草稿」）。
  - 管理（`PalaceAdminOut`）含 version（配 ETag）、状态、别名与**含草稿**的文章关系，
    用于预览；预览只用管理接口，公共 URL 不因身份而变。

关键词的传输校验按**码点**计数，长度 1–80，且去空白后不得为空（05 §2 / §6）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.nav.models import (
    ALIAS_VALUE_MAX_LENGTH,
    KEYWORD_MAX_LENGTH,
    MAX_ALIASES_PER_PALACE,
    MAX_POSTS_PER_PALACE,
    PALACE_FIELDS,
    SLUG_MAX_LENGTH,
    SUMMARY_MAX_LENGTH,
    TITLE_MAX_LENGTH,
)
from app.modules.posts.schemas import PostSummaryOut, post_summary_out
from app.modules.posts.models import Post
from app.modules.tags.models import Tag

# slug 是公开 URL 的一部分：只允许小写字母 / 数字 / 单连字符分段（保持稳定且唯一）。
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

ResolveStatus = Literal["found", "ambiguous", "not_found"]
SearchKind = Literal["post", "palace"]
PalaceField = Literal["name", "location", "cognition"]


class PalaceKeywordsOut(BaseModel):
    """三项标准关键词（04 §4B 的「目标名 / 现实地点 / 认知形态」）。"""

    name: str
    location: str
    cognition: str


class PalaceSummaryOut(BaseModel):
    """公开专题摘要。`post_count` 是**每次查询实时统计**的公开文章数，不是缓存的权限条件。"""

    id: uuid.UUID
    slug: str
    title: str
    summary: str
    keywords: PalaceKeywordsOut
    post_count: int
    published_at: datetime


class PalaceListOut(BaseModel):
    items: list[PalaceSummaryOut]
    next_cursor: str | None


class PalaceDetailOut(PalaceSummaryOut):
    """公开专题详情：介绍 + 有序公开文章（草稿 / 已撤回的文章不在其中）。"""

    posts: list[PostSummaryOut]


class ResolveIn(BaseModel):
    """认知定位的三字段。无副作用：只读取与匹配（05 §5）。"""

    name: str = Field(min_length=1, max_length=KEYWORD_MAX_LENGTH)
    location: str = Field(min_length=1, max_length=KEYWORD_MAX_LENGTH)
    cognition: str = Field(min_length=1, max_length=KEYWORD_MAX_LENGTH)

    @model_validator(mode="after")
    def _no_blank_keywords(self) -> "ResolveIn":
        blank = [field for field in PALACE_FIELDS if not getattr(self, field).strip()]
        if blank:
            raise ValueError(f"这些字段不能只有空白：{'、'.join(blank)}")
        return self


class ResolveOut(BaseModel):
    """`found` / `ambiguous` / `not_found` 三种业务结果，外加成功时的候选列表。

    `not_found` 是正常 200 业务结果；服务故障是 5xx，两者不混为一谈（04 §4B / 05 §6）。
    """

    status: ResolveStatus
    matches: list[PalaceSummaryOut]


class SearchItemOut(BaseModel):
    """搜索结果条目。`href` 由服务端生成，不使用任意第三方重定向地址。"""

    kind: SearchKind
    id: uuid.UUID
    slug: str
    title: str
    excerpt: str
    href: str


class SearchListOut(BaseModel):
    items: list[SearchItemOut]
    next_cursor: str | None


# --- 管理 DTO ---------------------------------------------------------------


class PalaceAliasIn(BaseModel):
    field: PalaceField
    value: str = Field(min_length=1, max_length=ALIAS_VALUE_MAX_LENGTH)

    @model_validator(mode="after")
    def _no_blank_alias(self) -> "PalaceAliasIn":
        if not self.value.strip():
            raise ValueError("别名不能只有空白")
        return self


class PalaceAliasOut(BaseModel):
    field: str
    value: str
    normalized_value: str


class PalaceKeywordsIn(BaseModel):
    name: str = Field(min_length=1, max_length=KEYWORD_MAX_LENGTH)
    location: str = Field(min_length=1, max_length=KEYWORD_MAX_LENGTH)
    cognition: str = Field(min_length=1, max_length=KEYWORD_MAX_LENGTH)

    @model_validator(mode="after")
    def _no_blank_keywords(self) -> "PalaceKeywordsIn":
        blank = [field for field in PALACE_FIELDS if not getattr(self, field).strip()]
        if blank:
            raise ValueError(f"这些字段不能只有空白：{'、'.join(blank)}")
        return self


class PalacePostAdminOut(BaseModel):
    """管理端的文章关系：含草稿 / 已撤回，并标明它当前是否公开（供预览判断）。"""

    post_id: uuid.UUID
    slug: str
    title: str
    status: str
    position: int
    deleted: bool
    public: bool


class PalaceRefOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    status: str


class PalaceConflictOut(BaseModel):
    """别名 / 标准值在其他专题上也出现：允许保存与发布，但管理端必须提示检查。

    04 §8：「别名发生重叠时允许返回多候选，但发布预览应提示站主检查」。
    """

    field: str
    value: str
    normalized_value: str
    palaces: list[PalaceRefOut]


class PalaceAdminOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    summary: str
    keywords: PalaceKeywordsOut
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    version: int
    aliases: list[PalaceAliasOut]
    posts: list[PalacePostAdminOut]
    conflicts: list[PalaceConflictOut]
    # 发布门槛的即时结论，避免管理端自己算一套。
    public_post_count: int


class PalaceAdminListOut(BaseModel):
    items: list[PalaceAdminOut]
    next_cursor: str | None


class PalaceCreateIn(BaseModel):
    # 写请求不允许未知字段：把 `slug` 之类的字段发到 PATCH 上会得到 422，而不是被静默忽略。
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=SLUG_MAX_LENGTH, pattern=SLUG_PATTERN)
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    summary: str = Field(default="", max_length=SUMMARY_MAX_LENGTH)
    keywords: PalaceKeywordsIn
    aliases: list[PalaceAliasIn] = Field(default_factory=list, max_length=MAX_ALIASES_PER_PALACE)
    post_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_POSTS_PER_PALACE)
    # CSRF token 允许放在 JSON body（也接受 X-CSRF-Token 请求头，见 core/csrf.py）。
    csrf_token: str | None = Field(default=None, max_length=256)

    @field_validator("title")
    @classmethod
    def _no_blank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("标题不能只有空白")
        return value


class PalaceUpdateIn(BaseModel):
    """PATCH：只更新**出现过的**字段；`aliases` / `post_ids` 传入时完整替换关系列表。

    `slug` 不在可改字段里：公开 URL 必须稳定（05 §2「slug 用于公开文章 / 专题 URL，
    保持稳定且唯一」）。未知字段一律 422，不静默忽略。
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=TITLE_MAX_LENGTH)
    summary: str | None = Field(default=None, max_length=SUMMARY_MAX_LENGTH)
    keywords: PalaceKeywordsIn | None = None
    aliases: list[PalaceAliasIn] | None = Field(default=None, max_length=MAX_ALIASES_PER_PALACE)
    post_ids: list[uuid.UUID] | None = Field(default=None, max_length=MAX_POSTS_PER_PALACE)
    csrf_token: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> "PalaceUpdateIn":
        # 显式的 null 与「没传这个字段」是两件事：前者是调用方写错了，不能当成「不改」。
        nulls = [
            name
            for name in ("title", "summary", "keywords", "aliases", "post_ids")
            if name in self.model_fields_set and getattr(self, name) is None
        ]
        if nulls:
            raise ValueError(f"这些字段不能为 null（不改就别传）：{'、'.join(nulls)}")
        if self.title is not None and not self.title.strip():
            raise ValueError("标题不能只有空白")
        return self


class PalaceActionIn(BaseModel):
    """发布 / 撤回 / 删除的请求体：只需要 CSRF token（版本条件走 `If-Match`）。"""

    model_config = ConfigDict(extra="forbid")

    csrf_token: str | None = Field(default=None, max_length=256)


# --- 构造器 -----------------------------------------------------------------


def keywords_out(name: str, location: str, cognition: str) -> PalaceKeywordsOut:
    return PalaceKeywordsOut(name=name, location=location, cognition=cognition)


def palace_summary_out(palace, *, post_count: int) -> PalaceSummaryOut:
    return PalaceSummaryOut(
        id=palace.id,
        slug=palace.slug,
        title=palace.title,
        summary=palace.summary or "",
        keywords=keywords_out(palace.name, palace.location, palace.cognition),
        post_count=int(post_count),
        published_at=palace.published_at,
    )


def palace_detail_out(
    palace,
    *,
    post_count: int,
    posts: list[Post],
    tags_by_post: dict[uuid.UUID, list[Tag]] | None = None,
    covers_by_post: dict | None = None,
) -> PalaceDetailOut:
    tags_map = tags_by_post or {}
    covers = covers_by_post or {}
    summary = palace_summary_out(palace, post_count=post_count)
    return PalaceDetailOut(
        **summary.model_dump(),
        posts=[
            post_summary_out(
                post,
                tags=tags_map.get(post.id, []),
                cover=covers.get(post.cover_media_id) if post.cover_media_id else None,
            )
            for post in posts
        ],
    )
