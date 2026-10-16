"""放课后 DTO（05 §6 公开 / §7 管理）。

公开与管理字段集分开：

  - 公开（`LeisureEntryOut`）只有展示需要的字段：类型、名称、进度、可空评分、
    短评、剧透标记、封面、分类型进度、可选长评引用（只含公开文章）。
    **不含**发布状态、version、deleted_at、created_at。
  - 管理（`LeisureAdminOut`）在公开字段之外加发布状态、version（配 ETag）与时间戳，
    并给出**原始**长评引用（含草稿文章），因此管理表单可以「读回来 → 改 → 提交」。

展示语义由 `rules.py` 统一决定，DTO 只负责搬运：

  - 总数未知时 `completion_ratio` 是 `null`、`episodes_label` 是「看到第 6 集」（验收 3）；
  - `rating` 为 `null` 表示**未评分**，不是 0 分（验收 3）；
  - 通关（`completed_on`）与全成就（`all_achievements`）分开返回，没有推导关系。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.leisure import rules
from app.modules.leisure.models import (
    EPISODES_MAX,
    KIND_ANIME,
    KIND_GAME,
    NOTES_MAX_CODEPOINTS,
    PLATFORM_MAX_CODEPOINTS,
    PLAYTIME_MAX_MINUTES,
    RATING_MAX,
    RATING_MIN,
    SEASON_MAX_CODEPOINTS,
    TITLE_MAX_CODEPOINTS,
    LeisureEntry,
)

LeisureKind = Literal["anime", "game"]
LeisureStatus = Literal["draft", "published"]


# --- 公开读取 ---------------------------------------------------------------


class ReviewRefOut(BaseModel):
    """可选长评引用（只给公开文章的对外字段）。"""

    id: uuid.UUID
    slug: str
    title: str


class AnimeProgressOut(BaseModel):
    """追番进度。`total_episodes` / `completion_ratio` 为 null 表示总数未知。"""

    season: str | None
    episodes_watched: int | None
    total_episodes: int | None
    last_watched_on: date | None
    airing: bool | None
    # 人类可读的进度标签；总数未知时是「看到第 6 集」，**不带百分比**。
    episodes_label: str
    # 总数未知 → null（不计算假的完成率，验收 3）。
    completion_ratio: float | None


class GameProgressOut(BaseModel):
    platform: str
    started_on: date | None
    completed_on: date | None
    playtime_minutes: int | None
    playtime_label: str
    # 通关与全成就是两件事：分开给出，谁也不推导谁（07 §3）。
    all_achievements: bool | None


class LeisureEntryOut(BaseModel):
    id: uuid.UUID
    kind: LeisureKind
    title: str
    progress: str
    progress_label: str
    # null = 未评分（不是 0 分）。
    rating: int | None
    notes: str
    notes_have_spoilers: bool
    cover: dict[str, Any] | None
    anime: AnimeProgressOut | None
    game: GameProgressOut | None
    review: ReviewRefOut | None
    updated_at: datetime


class LeisureListOut(BaseModel):
    items: list[LeisureEntryOut]
    next_cursor: str | None


# --- 管理 -------------------------------------------------------------------


class LeisureCreateIn(BaseModel):
    """新建。**总是草稿**：`status` 不在写入字段里，发布是独立动作。"""

    model_config = ConfigDict(extra="forbid")

    kind: LeisureKind
    title: str = Field(min_length=1, max_length=TITLE_MAX_CODEPOINTS)
    progress: str | None = None
    rating: int | None = Field(default=None, ge=RATING_MIN, le=RATING_MAX)
    notes: str = Field(default="", max_length=NOTES_MAX_CODEPOINTS)
    notes_have_spoilers: bool = False
    cover_media_id: uuid.UUID | None = None
    review_post_id: uuid.UUID | None = None
    # 追番专属
    season: str | None = Field(default=None, max_length=SEASON_MAX_CODEPOINTS)
    total_episodes: int | None = Field(default=None, ge=0, le=EPISODES_MAX)
    episodes_watched: int | None = Field(default=None, ge=0, le=EPISODES_MAX)
    last_watched_on: date | None = None
    airing: bool | None = None
    # 游戏专属
    platform: str = Field(default="", max_length=PLATFORM_MAX_CODEPOINTS)
    playtime_minutes: int | None = Field(default=None, ge=0, le=PLAYTIME_MAX_MINUTES)
    started_on: date | None = None
    completed_on: date | None = None
    all_achievements: bool | None = None
    csrf_token: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def _kind_fields_and_progress(self) -> "LeisureCreateIn":
        values = self.model_dump(exclude={"csrf_token"})
        offending = rules.cross_kind_fields(self.kind, values)
        if offending:
            labels = rules.cross_kind_labels(self.kind, offending)
            raise ValueError(
                f"{'追番' if self.kind == KIND_ANIME else '游戏'}记录不接受这些字段："
                f"{'、'.join(labels)}"
            )
        if self.progress is not None and self.progress not in rules.allowed_progress(self.kind):
            raise ValueError(f"进度取值不合法：{self.progress}")
        if rules.episodes_conflict(self.episodes_watched, self.total_episodes):
            raise ValueError("已看集数不能超过总集数（总集数不确定时请先留空）")
        return self


class LeisureUpdateIn(BaseModel):
    """PATCH：只改出现过的字段。

    可空字段（`rating` / `season` / `total_episodes` / `episodes_watched` /
    `last_watched_on` / `airing` / `playtime_minutes` / `started_on` /
    `completed_on` / `all_achievements` / `cover_media_id` / `review_post_id`）
    传 `null` 就是**清空**（例如「把评分改回未评分」）。
    `title` / `notes` / `platform` / `notes_have_spoilers` 传 `null` 一律 422。
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=TITLE_MAX_CODEPOINTS)
    progress: str | None = None
    rating: int | None = Field(default=None, ge=RATING_MIN, le=RATING_MAX)
    notes: str | None = Field(default=None, max_length=NOTES_MAX_CODEPOINTS)
    notes_have_spoilers: bool | None = None
    cover_media_id: uuid.UUID | None = None
    review_post_id: uuid.UUID | None = None
    season: str | None = Field(default=None, max_length=SEASON_MAX_CODEPOINTS)
    total_episodes: int | None = Field(default=None, ge=0, le=EPISODES_MAX)
    episodes_watched: int | None = Field(default=None, ge=0, le=EPISODES_MAX)
    last_watched_on: date | None = None
    airing: bool | None = None
    platform: str | None = Field(default=None, max_length=PLATFORM_MAX_CODEPOINTS)
    playtime_minutes: int | None = Field(default=None, ge=0, le=PLAYTIME_MAX_MINUTES)
    started_on: date | None = None
    completed_on: date | None = None
    all_achievements: bool | None = None
    csrf_token: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def _no_explicit_nulls_for_required_text(self) -> "LeisureUpdateIn":
        nulls = [
            name
            for name in ("title", "notes", "platform", "notes_have_spoilers")
            if name in self.model_fields_set and getattr(self, name) is None
        ]
        if nulls:
            raise ValueError(f"这些字段不能为 null：{'、'.join(nulls)}")
        if self.title is not None and not self.title.strip():
            raise ValueError("名称不能只有空白")
        return self

    def changed_fields(self) -> dict[str, object]:
        """真正出现在请求里的字段（不含 CSRF token）。"""
        return {
            name: getattr(self, name)
            for name in self.model_fields_set
            if name != "csrf_token"
        }


class LeisureActionIn(BaseModel):
    """发布 / 撤回的请求体（版本条件走 `If-Match`，与 nav / moments 一致）。"""

    model_config = ConfigDict(extra="forbid")

    csrf_token: str | None = Field(default=None, max_length=256)


class LeisureAdminOut(BaseModel):
    id: uuid.UUID
    kind: LeisureKind
    title: str
    progress: str
    progress_label: str
    rating: int | None
    notes: str
    notes_have_spoilers: bool
    cover: dict[str, Any] | None
    anime: AnimeProgressOut | None
    game: GameProgressOut | None
    review: ReviewRefOut | None
    review_post_id: uuid.UUID | None
    status: LeisureStatus
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    version: int
    public: bool


class LeisureAdminListOut(BaseModel):
    items: list[LeisureAdminOut]
    next_cursor: str | None


# --- 构造器 -----------------------------------------------------------------


def anime_out(entry: LeisureEntry) -> AnimeProgressOut | None:
    if entry.kind != KIND_ANIME:
        return None
    return AnimeProgressOut(
        season=entry.season,
        episodes_watched=entry.episodes_watched,
        total_episodes=entry.total_episodes,
        last_watched_on=entry.last_watched_on,
        airing=entry.airing,
        episodes_label=rules.episodes_label(entry.episodes_watched, entry.total_episodes),
        completion_ratio=rules.completion_ratio(entry.episodes_watched, entry.total_episodes),
    )


def game_out(entry: LeisureEntry) -> GameProgressOut | None:
    if entry.kind != KIND_GAME:
        return None
    return GameProgressOut(
        platform=entry.platform or "",
        started_on=entry.started_on,
        completed_on=entry.completed_on,
        playtime_minutes=entry.playtime_minutes,
        playtime_label=rules.playtime_label(entry.playtime_minutes),
        all_achievements=entry.all_achievements,
    )


def entry_out(
    entry: LeisureEntry, *, cover: dict[str, Any] | None, review: ReviewRefOut | None
) -> LeisureEntryOut:
    return LeisureEntryOut(
        id=entry.id,
        kind=entry.kind,
        title=entry.title,
        progress=entry.progress,
        progress_label=rules.progress_label(entry.kind, entry.progress),
        rating=entry.rating,
        notes=entry.notes or "",
        notes_have_spoilers=bool(entry.notes_have_spoilers),
        cover=cover,
        anime=anime_out(entry),
        game=game_out(entry),
        review=review,
        updated_at=entry.updated_at,
    )


def admin_entry_out(
    entry: LeisureEntry, *, cover: dict[str, Any] | None, review: ReviewRefOut | None
) -> LeisureAdminOut:
    base = entry_out(entry, cover=cover, review=review)
    return LeisureAdminOut(
        # `updated_at` 已经由 `entry_out` 带上，这里不再重复传（重复会 TypeError）。
        **base.model_dump(),
        review_post_id=entry.review_post_id,
        status=entry.status,
        published_at=entry.published_at,
        created_at=entry.created_at,
        deleted_at=entry.deleted_at,
        version=int(entry.version),
        public=entry.is_publicly_visible(),
    )


__all__ = [
    "AnimeProgressOut",
    "GameProgressOut",
    "LeisureAdminListOut",
    "LeisureAdminOut",
    "LeisureActionIn",
    "LeisureCreateIn",
    "LeisureEntryOut",
    "LeisureListOut",
    "LeisureUpdateIn",
    "ReviewRefOut",
    "admin_entry_out",
    "anime_out",
    "entry_out",
    "game_out",
]
