"""手记（日记）模型（07 §3「手记」、07 §8、05 §11）。

    journal_entries       id / 日期 / 标题 / 正文 / 心情 / 地点文字 / 发布状态 /
                          可见性 / 可选长文关系 / 时间戳 / 软删除 / version
    journal_entry_media   entry_id / media_id / position / alt

设计要点（每一条都对应验收里的一条）：

  - **发布状态与可见性是两件事**（07 §3）：
    `status` 只在 `draft` / `published` 之间，`visibility` 只在 `private` / `public`
    之间。新建默认 **draft + private**，因此「刚写下的一篇」不可能因为某个查询
    漏了条件而直接对外可见 —— 公开条件同时要求 `published` 与 `public`。
  - **日期是日历日期，不是时刻**（验收 2）：`entry_date` 是 PostgreSQL `date`，
    API 传输 `YYYY-MM-DD`。日记表达的是「这一天」，不是某个 UTC 瞬间，
    因此不存在「按 UTC 格式化后错一天」的转换。需要「今天」时用
    `DISPLAY_TIMEZONE`（明确展示时区）换算，而不是服务器本地时区。
  - **私密记录不进日历计数**（验收 1/2）：日历只聚合 `published + public`，
    空日期就是空日期，不显示「有 N 篇隐藏记录」之类的暗示。
  - **媒体的公开引用单独判断**（05 §11）：一张图即使被私密日记引用，只要还有
    别的公开引用（例如公开相册、公开动态）就仍然公开；反之，把日记切为私密
    不会连带撤回别的公开引用。管理端必须如实提示这一点，而不是声称「撤回了
    日记，图就没了」。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    text as sql_text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

# --- 状态与可见性 -----------------------------------------------------------

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
JOURNAL_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

VISIBILITY_PRIVATE = "private"
VISIBILITY_PUBLIC = "public"
JOURNAL_VISIBILITIES = (VISIBILITY_PRIVATE, VISIBILITY_PUBLIC)

# 新建的默认值：**草稿 + 仅自己可见**（07 §3）。
DEFAULT_STATUS = STATUS_DRAFT
DEFAULT_VISIBILITY = VISIBILITY_PRIVATE

# --- 明确展示时区（验收 2）--------------------------------------------------

# 展示时区是可配置的模块常量，**不是**服务器本地时区：服务器上跑在哪个 TZ
# 都不应该改变「今天是哪一天」。集成方若要把它变成环境变量，加一个带默认值的
# `Settings` 字段即可（见交付单「集成申请」）。
DISPLAY_TIMEZONE_NAME = "Asia/Shanghai"
DISPLAY_TIMEZONE = ZoneInfo(DISPLAY_TIMEZONE_NAME)


def display_today(now: datetime | None = None) -> date:
    """按**明确展示时区**给出「今天」，不依赖服务器本地时区。

    所有「未来日期不上公开日历 / 不公开」的判断都从这里取基准，
    因此不会出现「UTC 比展示时区晚一天，于是今天的日记被当成未来」这种错。
    """
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        # 只接受带时区的时刻：裸时间会被当成 UTC 之外的某种本地时间，
        # 那正是「错一天」的来源。
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(DISPLAY_TIMEZONE).date()


# --- 字段长度（按 Unicode 码点，05 §2）--------------------------------------

TITLE_MAX_CODEPOINTS = 200
CONTENT_MAX_CODEPOINTS = 20_000
MOOD_MAX_CODEPOINTS = 24
LOCATION_MAX_CODEPOINTS = 80
ALT_MIN_CODEPOINTS = 1
ALT_MAX_CODEPOINTS = 200
IMAGES_MAX = 9
# 一次请求里允许提交的图片条数上限（与 IMAGES_MAX 同值，超出一律 422）。
MAX_IMAGES_PER_ENTRY = IMAGES_MAX


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("visibility in ('private', 'public')", name="visibility_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            f"char_length(title) <= {TITLE_MAX_CODEPOINTS}", name="title_length"
        ),
        CheckConstraint(
            f"char_length(content_md) <= {CONTENT_MAX_CODEPOINTS}", name="content_length"
        ),
        # 公开日历 / 公开列表的部分索引：条件与 service.public_conditions 完全一致
        # （published + public + 未删除），不给草稿或私密行留位置。
        Index(
            "ix_journal_entries_public_calendar",
            "entry_date",
            "id",
            unique=False,
            postgresql_where=sql_text(
                "status = 'published' AND visibility = 'public' AND deleted_at IS NULL"
            ),
        ),
        # 管理端按日期倒序浏览（含草稿与私密）。
        Index("ix_journal_entries_date", "entry_date", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 日记的「这一天」。date 而不是 timestamptz：不存在跨时区错一天的问题。
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_CODEPOINTS), nullable=False, default="")
    content_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mood: Mapped[str] = mapped_column(String(MOOD_MAX_CODEPOINTS), nullable=False, default="")
    location: Mapped[str] = mapped_column(String(LOCATION_MAX_CODEPOINTS), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_STATUS)
    visibility: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DEFAULT_VISIBILITY
    )
    # 可选长文关系：详细题解 / 长文仍然只有一份正文（07 §3）。
    post_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("posts.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # 刻意**不用** `relationship()`：`journal_entry_media` 是一张带 `position` / `alt`
    # 载荷的显式关联表，服务层始终直接查询它（要同时按 position 排序并批量取媒体）。
    # 声明 relationship 反而要额外映射一个关联对象类，多一层可能与真实列漂移的映射。

    def is_publicly_visible(self, today: date | None = None) -> bool:
        """当前是否满足全部公开条件。**只用于管理端预览提示**，公开查询一律走 SQL 条件。"""
        reference = today or display_today()
        return (
            self.status == STATUS_PUBLISHED
            and self.visibility == VISIBILITY_PUBLIC
            and self.deleted_at is None
            and self.entry_date <= reference
        )

    def bump_version(self) -> None:
        """成功修改后递增版本（05 §2）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


# 关联表：复合主键表达「同一篇日记的 media_id 唯一」，唯一约束表达「position 唯一」。
journal_entry_media = Table(
    "journal_entry_media",
    Base.metadata,
    Column(
        "entry_id",
        Uuid(as_uuid=True),
        ForeignKey("journal_entries.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "media_id",
        Uuid(as_uuid=True),
        ForeignKey("media.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Column("position", Integer, nullable=False),
    Column("alt", String(ALT_MAX_CODEPOINTS), nullable=False, default=""),
    CheckConstraint(f"position >= 0 and position <= {IMAGES_MAX - 1}", name="position_range"),
    CheckConstraint(
        f"char_length(alt) >= {ALT_MIN_CODEPOINTS} and char_length(alt) <= {ALT_MAX_CODEPOINTS}",
        name="alt_length",
    ),
    UniqueConstraint("entry_id", "position", name="uq_journal_entry_media_entry_id_position"),
    # 反向查询（按 media_id 找日记）必须有索引：媒体公开引用检查与「这张图还被谁引用」
    # 的提示都从 media_id 进。
    Index("ix_journal_entry_media_media_id", "media_id"),
)

# 说明：本模块**没有** `is_public` 布尔列。用两个枚举列而不是一个布尔，
# 是因为 07 §3 明确要求发布与可见性分开；把两者合成一个布尔会让
# 「草稿但 public」这种状态无法表达，也就无法实现「发布后才生效」。
