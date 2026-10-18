"""工作草稿 DTO（P5 第一批 · 契约 §3.3）。

三种形态严格分开：

  - 写入（`WorkDraftCreateIn` / `WorkDraftUpdateIn` / `WorkDraftCommitIn`）：
    字段级约束落在 Pydantic 上，越界由 FastAPI 统一映射成 422 + 字段级错误。
  - 读取（`WorkDraftOut` / `WorkDraftListOut` / `WorkDraftCreateOut`）：响应体
    带 `draft_version`（配 `ETag`）、`data` 原样回传、`images[]` 每项带
    `media: MediaAdminOut`（服务端填充，前端不必再逐张查媒体）。
  - 提交回执（`CommitResultOut`）：契约 §3.3 定死的字段。

`data` 按内容类型区分（契约 §3.3）：

  - moment：`{text, tags[], album_links[{album_id, media_ids[]}]}`
  - journal：`{entry_date, title, content_md, mood, location, post_id}`

草稿期校验是**宽松**的：只是为了防坏数据（长度上限与正式一致、日期合法、
未知键 422），发布门槛仍由正式内容规则在 commit 事务里负责。因此数据模型
里所有字段都是可选的 —— PATCH 的「未提供的键保留旧值」由 service 做浅合并，
显式传 `null` 只对可空关系 `post_id` 合法。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.core.errors import CODE_VALIDATION_FAILED, ApiError
from app.core.text import codepoint_length
from app.modules.journal.models import (
    CONTENT_MAX_CODEPOINTS,
    LOCATION_MAX_CODEPOINTS,
    MOOD_MAX_CODEPOINTS,
    TITLE_MAX_CODEPOINTS as JOURNAL_TITLE_MAX_CODEPOINTS,
)
from app.modules.media.schemas import MediaAdminOut, media_admin_out
from app.modules.moments.models import (
    TAGS_MAX,
    TAG_MAX_CODEPOINTS,
    TEXT_MAX_CODEPOINTS,
)
from app.modules.work_drafts.models import (
    ALT_MAX_CODEPOINTS,
    CONTENT_TYPE_JOURNAL,
    CONTENT_TYPE_MOMENT,
    IMAGES_MAX,
)

WorkDraftStatus = Literal["active", "committed", "discarded"]
WorkDraftAction = Literal["save", "publish", "update"]

# 列表摘要一行最多 120 个字符（契约 §3.3）。
SUMMARY_MAX_CODEPOINTS = 120
# 一次提交里的 album_links 数组上限：相册数量没有业务上限，给一个防御性上限即可。
ALBUM_LINKS_MAX = 200


# --- 写入：data -------------------------------------------------------------


class MomentAlbumLinkDraftIn(BaseModel):
    """草稿里的一条「收录到相册」选择（只做形状校验，相册是否存在留到 commit）。"""

    model_config = ConfigDict(extra="forbid")

    album_id: uuid.UUID
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=IMAGES_MAX)


class MomentDraftDataIn(BaseModel):
    """moment 草稿数据。所有键可选；长度上限与正式内容一致。"""

    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, max_length=TEXT_MAX_CODEPOINTS)
    tags: list[str] | None = Field(default=None, max_length=TAGS_MAX)
    album_links: list[MomentAlbumLinkDraftIn] | None = Field(
        default=None, max_length=ALBUM_LINKS_MAX
    )

    @model_validator(mode="after")
    def _reject_nulls(self) -> "MomentDraftDataIn":
        # 草稿数据里没有可空字段：显式 null 会让前端「清空」与「没传」混淆。
        nulls = [
            name
            for name in ("text", "tags", "album_links")
            if name in self.model_fields_set and getattr(self, name) is None
        ]
        if nulls:
            raise ValueError(f"{' / '.join(nulls)} 不能为 null")
        return self

    @model_validator(mode="after")
    def _clean_tags(self) -> "MomentDraftDataIn":
        """标签去首尾空白、丢空、去重、单个 1–24 码点（与正式写入同一套规则）。"""
        if self.tags is None:
            return self
        cleaned: list[str] = []
        for raw in self.tags:
            name = (raw or "").strip()
            if not name:
                continue
            if codepoint_length(name) > TAG_MAX_CODEPOINTS:
                raise ValueError(f"单个标签最多 {TAG_MAX_CODEPOINTS} 个字符")
            if name not in cleaned:
                cleaned.append(name)
        if len(cleaned) > TAGS_MAX:
            raise ValueError(f"最多 {TAGS_MAX} 个标签")
        self.tags = cleaned
        return self

    @model_validator(mode="after")
    def _unique_album_links(self) -> "MomentDraftDataIn":
        if self.album_links is None:
            return self
        album_ids = [link.album_id for link in self.album_links]
        if len(set(album_ids)) != len(album_ids):
            raise ValueError("album_links 中同一相册不能重复出现")
        return self


class JournalDraftDataIn(BaseModel):
    """journal 草稿数据。所有键可选；`post_id` 是唯一可显式置 null 的字段。"""

    model_config = ConfigDict(extra="forbid")

    entry_date: date | None = None
    title: str | None = Field(default=None, max_length=JOURNAL_TITLE_MAX_CODEPOINTS)
    content_md: str | None = Field(default=None, max_length=CONTENT_MAX_CODEPOINTS)
    mood: str | None = Field(default=None, max_length=MOOD_MAX_CODEPOINTS)
    location: str | None = Field(default=None, max_length=LOCATION_MAX_CODEPOINTS)
    post_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _reject_implicit_nulls(self) -> "JournalDraftDataIn":
        nulls = [
            name
            for name in ("entry_date", "title", "content_md", "mood", "location")
            if name in self.model_fields_set and getattr(self, name) is None
        ]
        if nulls:
            raise ValueError(f"{' / '.join(nulls)} 不能为 null")
        return self


DRAFT_DATA_MODELS: dict[str, type[BaseModel]] = {
    CONTENT_TYPE_MOMENT: MomentDraftDataIn,
    CONTENT_TYPE_JOURNAL: JournalDraftDataIn,
}


def validate_draft_data(content_type: str, data: dict[str, Any] | None) -> dict[str, Any]:
    """按内容类型校验草稿 data，返回 JSON 化的**只含显式提供键**的 dict。

    未知键 / 长度越界 / 类型错误统一转成 422 + 字段路径（`data.<字段>`）。
    """
    if data is None:
        return {}
    model = DRAFT_DATA_MODELS.get(content_type)
    if model is None:  # pragma: no cover - content_type 已由 schema Literal 拦住
        raise ApiError(CODE_VALIDATION_FAILED, "内容类型不合法", status_code=422)
    try:
        parsed = model.model_validate(data)
    except ValidationError as exc:
        fields: dict[str, list[str]] = {}
        for item in exc.errors():
            location = ".".join(str(part) for part in item.get("loc", ()))
            key = f"data.{location}" if location else "data"
            fields.setdefault(key, []).append(item.get("msg", "无效取值"))
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "草稿数据校验失败",
            status_code=422,
            fields=fields,
        ) from None
    # mode="json" 把 date / UUID 变成 JSON 可存的形式（JSONB 列不认 UUID 对象）。
    return parsed.model_dump(mode="json", exclude_unset=True)


# --- 写入：图片 -------------------------------------------------------------


class WorkDraftImageIn(BaseModel):
    """草稿里的一张图。

    `position` 可省略：省略时按数组顺序编号；给出时必须从 0 开始连续。
    前端把选图器的 `PickedImage` 原样提交时可能带 `media` 字段，这里容忍并忽略
    （服务端始终按 media_id 重新取媒体，不信任客户端回传的媒体快照）。
    """

    model_config = ConfigDict(extra="ignore")

    media_id: uuid.UUID
    alt: str = Field(default="", max_length=ALT_MAX_CODEPOINTS)
    position: int | None = Field(default=None, ge=0, le=IMAGES_MAX - 1)


def normalize_image_inputs(
    images: list[WorkDraftImageIn] | None,
) -> list[tuple[uuid.UUID, int, str]]:
    """把图片输入归一成 `[(media_id, position, alt)]`（顺序即 position）。

    返回的列表已按 position 升序；`alt` 去首尾空白（草稿允许空串，发布时才要求非空）。
    """
    if images is None:
        return []
    # 接受 Pydantic 模型或它的 model_dump() 结果（service 可能被脚本 / 测试直接调用）。
    images = [
        image if isinstance(image, WorkDraftImageIn) else WorkDraftImageIn.model_validate(image)
        for image in images
    ]
    if len(images) > IMAGES_MAX:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            f"最多 {IMAGES_MAX} 张图片",
            status_code=422,
            fields={"images": [f"最多 {IMAGES_MAX} 张"]},
        )
    positions = [image.position for image in images]
    if any(position is not None for position in positions):
        explicit = [int(position) for position in positions if position is not None]
        if len(explicit) != len(positions) or sorted(explicit) != list(range(len(positions))):
            raise ApiError(
                CODE_VALIDATION_FAILED,
                "图片顺序必须从 0 开始且连续、不重复",
                status_code=422,
                fields={"images": ["position 必须从 0 开始连续且不重复"]},
            )
    result: list[tuple[uuid.UUID, int, str]] = []
    seen: set[uuid.UUID] = set()
    for index, image in enumerate(images):
        if image.media_id in seen:
            raise ApiError(
                CODE_VALIDATION_FAILED,
                "同一张图片不能重复出现",
                status_code=422,
                fields={"images": ["media_id 重复"]},
            )
        seen.add(image.media_id)
        position = index if image.position is None else int(image.position)
        result.append((image.media_id, position, (image.alt or "").strip()))
    result.sort(key=lambda item: item[1])
    return result


# --- 写入：请求体 -----------------------------------------------------------


class WorkDraftCreateIn(BaseModel):
    """POST /admin/work-drafts。`target_version` / `target_id` / `status` 由服务端写。"""

    model_config = ConfigDict(extra="forbid")

    content_type: Literal["moment", "journal"]
    target_id: uuid.UUID | None = None
    data: dict[str, Any] | None = None
    images: list[WorkDraftImageIn] | None = Field(default=None, max_length=IMAGES_MAX)
    # 兼容把 CSRF token 放 body 的既有做法（新前端走 X-CSRF-Token 头）。
    csrf_token: str | None = Field(default=None, max_length=256)


class WorkDraftUpdateIn(BaseModel):
    """PATCH /admin/work-drafts/{id}。`data` 浅合并；`images` 省略=不动、给出=整组替换。"""

    model_config = ConfigDict(extra="forbid")

    data: dict[str, Any] | None = None
    images: list[WorkDraftImageIn] | None = Field(default=None, max_length=IMAGES_MAX)
    csrf_token: str | None = Field(default=None, max_length=256)


class WorkDraftCommitIn(BaseModel):
    """POST /admin/work-drafts/{id}/commit（契约 §3.3）。"""

    model_config = ConfigDict(extra="forbid")

    action: Literal["save", "publish", "update"]
    expected_target_version: int | None = Field(default=None, ge=1)
    commit_key: uuid.UUID
    csrf_token: str | None = Field(default=None, max_length=256)


# --- 读取 / 回执 ------------------------------------------------------------


class WorkDraftImageOut(BaseModel):
    media_id: uuid.UUID
    position: int
    alt: str
    media: MediaAdminOut


class WorkDraftOut(BaseModel):
    id: uuid.UUID
    content_type: Literal["moment", "journal"]
    target_id: uuid.UUID | None
    target_version: int | None
    draft_version: int
    status: WorkDraftStatus
    summary: str
    data: dict[str, Any]
    images: list[WorkDraftImageOut]
    created_at: datetime
    updated_at: datetime


class WorkDraftListOut(BaseModel):
    items: list[WorkDraftOut]
    next_cursor: str | None


class WorkDraftCreateOut(BaseModel):
    """创建或恢复：200 = 复用既有有效草稿，201 = 新建。"""

    draft: WorkDraftOut
    reused: bool


class CommitResultOut(BaseModel):
    draft_id: uuid.UUID
    content_type: Literal["moment", "journal"]
    target_id: uuid.UUID
    target_version: int
    status: Literal["draft", "published"]
    visibility: Literal["private", "public"] | None
    action: WorkDraftAction
    idempotent_replay: bool


# --- 组装 -------------------------------------------------------------------


def _truncate(value: str, limit: int = SUMMARY_MAX_CODEPOINTS) -> str:
    text = " ".join(value.split())
    if codepoint_length(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def draft_summary(
    content_type: str, data: dict[str, Any], *, image_count: int
) -> str:
    """列表用的一行摘要（服务端派生，≤120 字符）。

    刻意不返回正文全文：「继续编辑」列表只需要能认出是哪份草稿。
    """
    if content_type == CONTENT_TYPE_JOURNAL:
        title = str(data.get("title") or "").strip()
        if title:
            return _truncate(title)
        body = str(data.get("content_md") or "").strip()
        if body:
            return _truncate(body)
        return f"{image_count} 张图片的手记" if image_count else "空白手记"
    body = str(data.get("text") or "").strip()
    if body:
        return _truncate(body)
    tags = data.get("tags") or []
    if tags:
        return _truncate("标签：" + " ".join(str(tag) for tag in tags))
    return f"{image_count} 张图片的动态" if image_count else "空白动态"


def work_draft_out(
    draft,
    *,
    refs: list[tuple[uuid.UUID, int, str]],
    media_by_id: dict[uuid.UUID, Any],
) -> WorkDraftOut:
    data = dict(draft.data or {})
    images = [
        WorkDraftImageOut(
            media_id=media_id,
            position=int(position),
            alt=str(alt or ""),
            media=media_admin_out(media_by_id[media_id]),
        )
        for media_id, position, alt in refs
        if media_id in media_by_id
    ]
    return WorkDraftOut(
        id=draft.id,
        content_type=draft.content_type,
        target_id=draft.target_id,
        target_version=draft.target_version,
        draft_version=draft.draft_version,
        status=draft.status,
        summary=draft_summary(draft.content_type, data, image_count=len(images)),
        data=data,
        images=images,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


__all__ = [
    "ALBUM_LINKS_MAX",
    "CommitResultOut",
    "JournalDraftDataIn",
    "MomentDraftDataIn",
    "SUMMARY_MAX_CODEPOINTS",
    "WorkDraftAction",
    "WorkDraftCommitIn",
    "WorkDraftCreateIn",
    "WorkDraftCreateOut",
    "WorkDraftImageIn",
    "WorkDraftImageOut",
    "WorkDraftListOut",
    "WorkDraftOut",
    "WorkDraftStatus",
    "WorkDraftUpdateIn",
    "draft_summary",
    "normalize_image_inputs",
    "validate_draft_data",
    "work_draft_out",
]
