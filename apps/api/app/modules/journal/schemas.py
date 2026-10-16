"""手记 DTO（05 §6 公开 / §7 管理）。

公开与管理的字段集在**类型层面**分开，与 `nav` / `moments` 一致：

  - 公开（`JournalEntrySummaryOut` / `JournalEntryDetailOut` / `JournalCalendarOut`）
    只含日期、标题、摘要、心情、地点、图片与可选长文引用；
    **不含** `status` / `visibility` / `version` / `deleted_at` / `created_at` / 正文全文
    （摘要接口不返回正文，避免「用列表接口把私密正文顺出来」这类误用）。
  - 管理（`JournalAdminOut`）含状态、可见性、version（配 ETag）与图片关系，
    因此管理表单「读回来 → 改 → 提交」不需要自己反推顺序。

日期一律是 `YYYY-MM-DD` 的 **日历日期**（`datetime.date`），不是时刻：
日记表达「这一天」，按明确展示时区（`models.DISPLAY_TIMEZONE`）取「今天」，
因此不存在 UTC 转换错一天的问题。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.text import codepoint_length
from app.modules.media.models import Media
from app.modules.media.schemas import MediaVariantOut, media_public_out
from app.modules.journal.models import (
    ALT_MAX_CODEPOINTS,
    ALT_MIN_CODEPOINTS,
    CONTENT_MAX_CODEPOINTS,
    DEFAULT_VISIBILITY,
    IMAGES_MAX,
    LOCATION_MAX_CODEPOINTS,
    MAX_IMAGES_PER_ENTRY,
    MOOD_MAX_CODEPOINTS,
    TITLE_MAX_CODEPOINTS,
    JournalEntry,
)

JournalStatus = Literal["draft", "published"]
JournalVisibility = Literal["private", "public"]


# --- 公开读取 ---------------------------------------------------------------


class JournalImageOut(BaseModel):
    """公开图片：只给读取需要的字段，不含 `storage_key` / 原始文件名。"""

    media_id: uuid.UUID
    position: int
    alt: str
    width: int
    height: int
    variants: list[MediaVariantOut]


class JournalPostRefOut(BaseModel):
    """可选的长文引用。`public` 由服务端按公开条件实时判定，管理端用来提示。"""

    id: uuid.UUID
    slug: str
    title: str
    status: str
    public: bool


class JournalEntrySummaryOut(BaseModel):
    """存档卡式列表项（07 §3：日期、星期由前端按同一日期字符串算，不重复传输）。"""

    id: uuid.UUID
    entry_date: date
    title: str
    excerpt: str
    mood: str
    location: str
    images: list[JournalImageOut]


class JournalEntryListOut(BaseModel):
    items: list[JournalEntrySummaryOut]
    next_cursor: str | None


class JournalEntryDetailOut(JournalEntrySummaryOut):
    """正文页：`content_md` 是唯一正文来源（05 §3：不把渲染 HTML 当存档）。"""

    content_md: str
    post: JournalPostRefOut | None


class JournalCalendarMonthOut(BaseModel):
    """一个月：只有**真的存在公开记录**的日期才有计数。

    空月份不出现在列表里，空日期不出现在 `days` 里 —— 不生成「欠写」提醒，
    也不会因为被隐藏的记录而出现一个没有内容的日期。
    """

    month: str  # YYYY-MM
    days: dict[str, int]


class JournalCalendarOut(BaseModel):
    """公开日历：与列表**同一份数据**，只聚合真正公开的记录。"""

    months: list[JournalCalendarMonthOut]
    total_entries: int
    timezone: str
    today: date


# --- 管理 -------------------------------------------------------------------


class JournalImageIn(BaseModel):
    media_id: uuid.UUID
    position: int = Field(ge=0, le=IMAGES_MAX - 1)
    alt: str = Field(min_length=ALT_MIN_CODEPOINTS, max_length=ALT_MAX_CODEPOINTS)


class JournalCreateIn(BaseModel):
    """新建。**没有** `status` / `visibility` 字段：新建永远是 draft + private。

    这是刻意的：07 §3 要求「建议新增日记时默认为草稿且仅自己可见」。
    要公开必须先写下来，再显式发布并切为 public —— 两步都要站主主动做。
    """

    model_config = ConfigDict(extra="forbid")

    entry_date: date
    title: str = Field(default="", max_length=TITLE_MAX_CODEPOINTS)
    content_md: str = Field(default="", max_length=CONTENT_MAX_CODEPOINTS)
    mood: str = Field(default="", max_length=MOOD_MAX_CODEPOINTS)
    location: str = Field(default="", max_length=LOCATION_MAX_CODEPOINTS)
    post_id: uuid.UUID | None = None
    images: list[JournalImageIn] = Field(
        default_factory=list, max_length=MAX_IMAGES_PER_ENTRY
    )
    csrf_token: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def _positions_contiguous(self) -> "JournalCreateIn":
        assert_contiguous_positions([image.position for image in self.images])
        return self


class JournalUpdateIn(BaseModel):
    """PATCH：只改出现过的字段；`images` 传入时**完整替换**有序关系。

    显式 `null` 与「没传」是两回事：要清空 `post_id` 请传 `null`（它是可空关系），
    其它字段传 `null` 一律 422。
    """

    model_config = ConfigDict(extra="forbid")

    entry_date: date | None = None
    title: str | None = Field(default=None, max_length=TITLE_MAX_CODEPOINTS)
    content_md: str | None = Field(default=None, max_length=CONTENT_MAX_CODEPOINTS)
    mood: str | None = Field(default=None, max_length=MOOD_MAX_CODEPOINTS)
    location: str | None = Field(default=None, max_length=LOCATION_MAX_CODEPOINTS)
    post_id: uuid.UUID | None = None
    images: list[JournalImageIn] | None = Field(
        default=None, max_length=MAX_IMAGES_PER_ENTRY
    )
    csrf_token: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def _positions_contiguous(self) -> "JournalUpdateIn":
        if self.images is not None:
            assert_contiguous_positions([image.position for image in self.images])
        return self

    @model_validator(mode="after")
    def _reject_implicit_nulls(self) -> "JournalUpdateIn":
        nulls = [
            name
            for name in ("entry_date", "title", "content_md", "mood", "location", "images")
            if name in self.model_fields_set and getattr(self, name) is None
        ]
        if nulls:
            raise ValueError(f"这些字段不能为 null（不改就别传）：{'、'.join(nulls)}")
        return self


class JournalVisibilityIn(BaseModel):
    """可见性 / 发布动作的请求体。

    切为 `private` 用它与 PATCH 同样的一条路径，**立即对新请求生效**
    （验收 1）：公开条件写在 SQL 里，不依赖任何缓存失效或重建。
    """

    model_config = ConfigDict(extra="forbid")

    csrf_token: str | None = Field(default=None, max_length=256)


class JournalAdminImageOut(BaseModel):
    """管理端图片：给出可直接回填的引用 + 当前是否还有公开引用。

    `still_public` 说明「这张图即使本篇日记转私密，也可能因为别的公开引用
    （公开相册 / 公开动态）继续公开」。管理端必须如实提示，不能声称
    「撤回了日记，图就没了」（05 §11）。
    """

    media_id: uuid.UUID
    position: int
    alt: str
    width: int
    height: int
    still_public: bool


class JournalAdminOut(BaseModel):
    id: uuid.UUID
    entry_date: date
    title: str
    content_md: str
    mood: str
    location: str
    status: JournalStatus
    visibility: JournalVisibility
    post: JournalPostRefOut | None
    images: list[JournalAdminImageOut]
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    version: int
    # 管理端即时结论，避免前端自己算一套公开条件。
    public: bool
    # 图片仍被**别的**公开内容引用时不撤回的提示（05 §11）。
    shared_media: list[uuid.UUID]


class JournalAdminListOut(BaseModel):
    items: list[JournalAdminOut]
    next_cursor: str | None


# --- 校验与构造器 -----------------------------------------------------------


def assert_contiguous_positions(positions: list[int]) -> None:
    """图片顺序必须从 0 开始、连续、唯一（与 moments 同一规则）。"""
    if sorted(positions) != list(range(len(positions))):
        raise ValueError("图片顺序必须从 0 开始且连续、不重复")


def entry_excerpt(content_md: str, *, limit: int = 120) -> str:
    """列表摘要：只取正文的**第一段纯文本**，不返回 Markdown 全文。

    按码点截断（05 §2），并且不把 `#` / `*` 之类的标记带进摘要。
    """
    for raw_line in (content_md or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(("#", ">", "-", "*", "!", "|", "`")):
            line = line.lstrip("#>-*!|` ").strip()
            if not line:
                continue
        if codepoint_length(line) <= limit:
            return line
        return "".join(list(line)[:limit]) + "…"
    return ""


def image_out(image_row, media: Media) -> JournalImageOut:
    public = media_public_out(media)
    return JournalImageOut(
        media_id=media.id,
        position=int(image_row.position),
        alt=image_row.alt or "",
        width=int(public.width),
        height=int(public.height),
        variants=list(public.variants),
    )


def entry_summary_out(entry: JournalEntry, *, images: list[JournalImageOut]) -> JournalEntrySummaryOut:
    return JournalEntrySummaryOut(
        id=entry.id,
        entry_date=entry.entry_date,
        title=entry.title or "",
        excerpt=entry_excerpt(entry.content_md or ""),
        mood=entry.mood or "",
        location=entry.location or "",
        images=images,
    )


def entry_detail_out(
    entry: JournalEntry,
    *,
    images: list[JournalImageOut],
    post: JournalPostRefOut | None,
) -> JournalEntryDetailOut:
    summary = entry_summary_out(entry, images=images)
    return JournalEntryDetailOut(
        **summary.model_dump(),
        content_md=entry.content_md or "",
        post=post,
    )


def admin_entry_out(
    entry: JournalEntry,
    *,
    images: list[JournalAdminImageOut],
    post: JournalPostRefOut | None,
    public: bool,
    shared_media: list[uuid.UUID],
) -> JournalAdminOut:
    return JournalAdminOut(
        id=entry.id,
        entry_date=entry.entry_date,
        title=entry.title or "",
        content_md=entry.content_md or "",
        mood=entry.mood or "",
        location=entry.location or "",
        status=entry.status,
        visibility=entry.visibility,
        post=post,
        images=images,
        published_at=entry.published_at,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        deleted_at=entry.deleted_at,
        version=int(entry.version),
        public=public,
        shared_media=shared_media,
    )


__all__ = [
    "DEFAULT_VISIBILITY",
    "JournalAdminListOut",
    "JournalAdminOut",
    "JournalCalendarOut",
    "JournalCreateIn",
    "JournalEntryDetailOut",
    "JournalEntryListOut",
    "JournalEntrySummaryOut",
    "JournalImageIn",
    "JournalImageOut",
    "JournalPostRefOut",
    "JournalUpdateIn",
    "JournalVisibilityIn",
    "admin_entry_out",
    "assert_contiguous_positions",
    "entry_detail_out",
    "entry_excerpt",
    "entry_summary_out",
    "image_out",
]
