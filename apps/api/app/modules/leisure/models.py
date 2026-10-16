"""放课后（追番 / 游戏）模型（07 §3「放课后」、07 §8）。

    leisure_entries   id / 类型 / 名称 / 进度状态 / 可空评分 / 短评 / 剧透标记 /
                      可选封面 / 可选长文关系 / 发布状态 / 时间戳 / 软删除 / version
                      + 追番专属：季度、已看集数、**可空总集数**、最近观看日期、连载中
                      + 游戏专属：平台、开始 / 完成日期、**可空手填时长**、是否全成就

两套「状态」是刻意分开的两个列，别把它们合成一个：

  - `progress` 是**内容语义**的状态：追番 `想看 / 在看 / 看完 / 搁置 / 弃坑`，
    游戏 `想玩 / 在玩 / 通关 / 搁置 / 弃坑`（07 §3 的表格）；
  - `status` 是**发布状态**：`draft / published`，与文章 / 动态 / 日记同一套约定
    （05 §2）。放课后没有 private 概念，因此只有 draft / published 两个取值。

设计要点（每条对应验收里的一条）：

  - **追番与游戏共用一张表**，因为两者的共同字段（名称、状态、评分、短评、封面、
    长评引用）与筛选交互完全一致；差异字段用可空列 + 数据库 CHECK 保证
    「追番行不会混进游戏字段，反之亦然」。分成两张表会让筛选、排序、封面关系、
    管理表单各写两遍，而 07 §3 明确要求两个页签共享同一套交互。
  - **总集数可空**（验收 3）：未知时界面显示「看到第 6 集」，**不计算完成率**。
    `episodes_watched <= total_episodes` 只在总数已知时才是约束。
  - **评分可空**（验收 3）：不填 ≠ 0 分。CHECK 在 NULL 上求值为 unknown，天然满足。
  - **通关不等于全成就**（07 §3）：`completed_on`（通关日期）与 `all_achievements`
    （真实达成的里程碑）是两个独立字段，谁也不推导谁。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text as sql_text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

# --- 发布状态（与文章 / 动态 / 日记同一套约定）-----------------------------

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
LEISURE_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# --- 类型 -------------------------------------------------------------------

KIND_ANIME = "anime"
KIND_GAME = "game"
LEISURE_KINDS = (KIND_ANIME, KIND_GAME)

# --- 进度状态（05 §2 的枚举列；分类型各自的取值集合）-------------------------

ANIME_PROGRESS = ("wish", "watching", "finished", "on_hold", "dropped")
GAME_PROGRESS = ("wish", "playing", "cleared", "on_hold", "dropped")
ALL_PROGRESS = tuple(sorted(set(ANIME_PROGRESS) | set(GAME_PROGRESS)))

PROGRESS_LABELS = {
    KIND_ANIME: {
        "wish": "想看",
        "watching": "在看",
        "finished": "看完",
        "on_hold": "搁置",
        "dropped": "弃坑",
    },
    KIND_GAME: {
        "wish": "想玩",
        "playing": "在玩",
        "cleared": "通关",
        "on_hold": "搁置",
        "dropped": "弃坑",
    },
}

# --- 字段长度（按 Unicode 码点，05 §2）--------------------------------------

TITLE_MAX_CODEPOINTS = 200
PLATFORM_MAX_CODEPOINTS = 80
NOTES_MAX_CODEPOINTS = 1_000
PLAYTIME_MAX_MINUTES = 100_000
EPISODES_MAX = 10_000
SEASON_MAX_CODEPOINTS = 24
RATING_MIN = 1
RATING_MAX = 10

_ANIME_PROGRESS_IN_SQL = "progress in ('wish', 'watching', 'finished', 'on_hold', 'dropped')"
_GAME_PROGRESS_IN_SQL = "progress in ('wish', 'playing', 'cleared', 'on_hold', 'dropped')"


class LeisureEntry(Base):
    __tablename__ = "leisure_entries"
    __table_args__ = (
        CheckConstraint("kind in ('anime', 'game')", name="kind_valid"),
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            f"(kind = 'anime' and {_ANIME_PROGRESS_IN_SQL})"
            f" or (kind = 'game' and {_GAME_PROGRESS_IN_SQL})",
            name="progress_matches_kind",
        ),
        CheckConstraint(
            f"rating is null or (rating >= {RATING_MIN} and rating <= {RATING_MAX})",
            name="rating_range",
        ),
        CheckConstraint(
            "total_episodes is null or total_episodes >= 0", name="total_episodes_non_negative"
        ),
        CheckConstraint(
            "episodes_watched is null or episodes_watched >= 0",
            name="episodes_watched_non_negative",
        ),
        CheckConstraint(
            "playtime_minutes is null or playtime_minutes >= 0", name="playtime_non_negative"
        ),
        CheckConstraint(f"char_length(title) <= {TITLE_MAX_CODEPOINTS}", name="title_length"),
        CheckConstraint(f"char_length(notes) <= {NOTES_MAX_CODEPOINTS}", name="notes_length"),
        # 追番专属字段不得出现在游戏行上，反之亦然（数据库级，不靠表单自觉）。
        CheckConstraint(
            "kind = 'anime' or (season is null and total_episodes is null"
            " and episodes_watched is null and last_watched_on is null and airing is null)",
            name="game_has_no_anime_fields",
        ),
        CheckConstraint(
            "kind = 'game' or (platform = '' and playtime_minutes is null"
            " and started_on is null and completed_on is null and all_achievements is null)",
            name="anime_has_no_game_fields",
        ),
        # 进度只能在总数已知时被约束；总集数不明时「看到第 6 集」是合法状态（验收 3）。
        CheckConstraint(
            "episodes_watched is null or total_episodes is null"
            " or episodes_watched <= total_episodes",
            name="episodes_within_total",
        ),
        # 公开列表的部分索引：与 service.public_conditions 一致（published + 未删除）。
        Index(
            "ix_leisure_entries_public_listing",
            "kind",
            "updated_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_CODEPOINTS), nullable=False)
    progress: Mapped[str] = mapped_column(String(16), nullable=False, default="wish")
    # 可空评分：不填就是没评分，不是 0 分（07 §3、验收 3）。
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 剧透短评默认折叠（07 §3）：标记由站主自己确认。
    notes_have_spoilers: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("media.id", ondelete="SET NULL"), nullable=True
    )
    # 可选长评：正文仍然只有一份，存在 posts 里（07 §3）。
    review_post_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("posts.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- 追番专属（游戏行必须为 NULL / 空）---------------------------------
    season: Mapped[str | None] = mapped_column(String(SEASON_MAX_CODEPOINTS), nullable=True)
    total_episodes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episodes_watched: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_watched_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 是否连载中：**站主手动维护**，不同步任何第三方（07 §3 明确不做同步）。
    airing: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # --- 游戏专属（追番行必须为 '' / NULL）---------------------------------
    platform: Mapped[str] = mapped_column(
        String(PLATFORM_MAX_CODEPOINTS), nullable=False, default=""
    )
    playtime_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 真实达成的里程碑；**通关不等于全成就**（07 §3）。NULL 表示「没记录」。
    all_achievements: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    def is_publicly_visible(self) -> bool:
        """公开条件（07 §3）：已发布 + 未软删除。**只用于管理端预览提示**。"""
        return self.status == STATUS_PUBLISHED and self.deleted_at is None

    def bump_version(self) -> None:
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


__all__ = [
    "ALL_PROGRESS",
    "ANIME_PROGRESS",
    "GAME_PROGRESS",
    "KIND_ANIME",
    "KIND_GAME",
    "LEISURE_KINDS",
    "LEISURE_STATUSES",
    "PROGRESS_LABELS",
    "RATING_MAX",
    "RATING_MIN",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED",
    "LeisureEntry",
]
