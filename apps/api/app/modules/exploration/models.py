"""问题记录（印象空间）模型（07 §6「印象空间」、07 §8 的 `exploration_records` 行）。

    exploration_records          id / 唯一 slug / 标题 / 背景 / 尝试 / 结果 / 结果链接 /
                                 工作状态 / 解决时间 / 发布状态 / 时间戳 / 软删除 / version
    exploration_record_posts     record_id / post_id / position
    exploration_record_projects  record_id / project_id / position

设计要点（每一条都对应验收里的一条）：

  - **工作状态与发布状态相互独立**（07 §6、任务卡执行清单）：`work_status` 只在
    待探索 / 调查中 / 已解决 / 暂搁置 之间；`status` 只在 draft / published 之间。
    新建默认 **草稿 + 待探索**，因此「刚记下的一个问题」不可能因为某个查询漏了条件
    而直接对外可见 —— 公开条件同时要求 `published` 与未软删除。
    两者**正交**：「已解决但仍是草稿」与「待探索但已发布」都是合法状态，各有用例。
    这里刻意不用一个布尔 `is_public`，也不用把「已解决」当成发布条件。
  - **已解决要有实际说明**（任务卡「已解决的记录要有实际说明与可选验证链接」）：
    `outcome` 是文本，不能只有空白；`resolved_at` 只在工作状态为「已解决」时有值
    （由 `ck_exploration_records_resolved_at_valid` 在数据库里守住），
    并且「结果非空」由 service 在事务里校验 —— 这两条把「点一下解决就完事」挡住。
    验证链接是**可选**的：有些问题真的没有可公开的链接，逼站主编一个更糟。
  - **撤回关联内容时不泄漏隐藏标题**（验收 3、任务卡执行清单）：
    文章 / 作品关系存在**独立的关系表**里，只存 `post_id` / `project_id` 与顺序，
    **不存标题快照**（存了快照就没法保证撤回后不泄漏）。
    公开读取时用 posts / projects 的公开条件解析关系，解析不到就整条丢弃，
    绝不回显隐藏标题，也不显示「（已隐藏）」这种暗示。
  - **明确是站主整理**（验收 4）：没有 `visitor_id` / `requester` / `submitted_by` 之列，
    也没有「接单 / 认领 / 承诺完成时间」字段。这是站主自己的探索日志，
    不是公开的请求板（07 §6 末段、04 §4C 末段）。

数据库能表达的约束落在数据库（05 §3 末段）：

  - `ck_exploration_records_work_status_valid`  四个工作状态
  - `ck_exploration_records_status_valid`       只有 draft / published
  - `ck_exploration_records_version_positive`   version >= 1
  - `ck_exploration_records_title_length`       char_length(title) <= 200
  - `ck_exploration_records_resolved_at_valid`  只有「已解决」允许有解决时间
  - `ck_exploration_record_posts_position_non_negative`
  - `ck_exploration_record_projects_position_non_negative`
  - 三张表各一条唯一键：同一记录内文章 / 作品唯一、顺序唯一
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

RECORD_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# 工作状态（07 §6：「状态为待探索 / 调查中 / 已解决 / 暂搁置」）。
WORK_PENDING = "pending"
WORK_INVESTIGATING = "investigating"
WORK_RESOLVED = "resolved"
WORK_ARCHIVED = "archived"

WORK_STATUSES = (WORK_PENDING, WORK_INVESTIGATING, WORK_RESOLVED, WORK_ARCHIVED)

WORK_STATUS_LABELS = {
    WORK_PENDING: "待探索",
    WORK_INVESTIGATING: "调查中",
    WORK_RESOLVED: "已解决",
    WORK_ARCHIVED: "暂搁置",
}

# 新建默认：**草稿 + 待探索**（与 journal 的「草稿 + 私密」同形）。
DEFAULT_STATUS = STATUS_DRAFT
DEFAULT_WORK_STATUS = WORK_PENDING

SLUG_MAX_LENGTH = 200
TITLE_MAX_CODEPOINTS = 200
BACKGROUND_MAX_CODEPOINTS = 8000
ATTEMPTS_MAX_CODEPOINTS = 8000
OUTCOME_MAX_CODEPOINTS = 8000
# 列表摘要的长度（卡片上用；正文仍只有一份，在详情里）。
EXCERPT_MAX_CODEPOINTS = 160
MAX_POSTS_PER_RECORD = 50
MAX_PROJECTS_PER_RECORD = 50

_WORK_STATUS_IN_SQL = "work_status in (" + ", ".join(
    f"'{value}'" for value in WORK_STATUSES
) + ")"


class ExplorationRecord(Base):
    __tablename__ = "exploration_records"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint(_WORK_STATUS_IN_SQL, name="work_status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(
            f"char_length(title) <= {TITLE_MAX_CODEPOINTS}", name="title_length"
        ),
        # 「解决时间」只在工作状态为「已解决」时才有值：两者不可能各自漂移。
        CheckConstraint(
            "(work_status = 'resolved') OR (resolved_at IS NULL)",
            name="resolved_at_valid",
        ),
        # 公开列表的部分索引：与 service.public_conditions 完全一致。
        Index(
            "ix_exploration_records_public_listing",
            "created_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
        Index("ix_exploration_records_work_status", "work_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(SLUG_MAX_LENGTH), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_CODEPOINTS), nullable=False)
    # 背景：这是什么问题、在什么场景下出现。
    background: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 尝试：查了什么、试了什么、排除了什么（07 §6「尝试」）。
    attempts: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 结果：最后怎么了。工作状态为「已解决」时不能只有空白（service 在事务里校验）。
    outcome: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 结果链接：站外的验证证据（日志、PR、复现仓库、题解）。可选。
    evidence_links: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    work_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DEFAULT_WORK_STATUS
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=DEFAULT_STATUS)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    def is_publicly_visible(self) -> bool:
        """当前是否满足全部公开条件。**只用于管理端预览提示**，公开查询一律走 SQL 条件。"""
        return self.status == STATUS_PUBLISHED and self.deleted_at is None

    def bump_version(self) -> None:
        """成功修改后递增版本（05 §2）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


# 文章关系：**不存标题快照**（撤回文章后公开侧直接丢弃这条关系）。
exploration_record_posts = Table(
    "exploration_record_posts",
    Base.metadata,
    Column(
        "record_id",
        Uuid(as_uuid=True),
        ForeignKey("exploration_records.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "post_id",
        Uuid(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("position", Integer, nullable=False, default=0),
    CheckConstraint("position >= 0", name="position_non_negative"),
    UniqueConstraint(
        "record_id", "position", name="uq_exploration_record_posts_record_id_position"
    ),
    Index("ix_exploration_record_posts_post_id", "post_id"),
)

# 作品关系：与 T06 的 `projects` 关联，**不复制**作品的标题或技术栈。
exploration_record_projects = Table(
    "exploration_record_projects",
    Base.metadata,
    Column(
        "record_id",
        Uuid(as_uuid=True),
        ForeignKey("exploration_records.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "project_id",
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("position", Integer, nullable=False, default=0),
    CheckConstraint("position >= 0", name="position_non_negative"),
    UniqueConstraint(
        "record_id", "position", name="uq_exploration_record_projects_record_id_position"
    ),
    Index("ix_exploration_record_projects_project_id", "project_id"),
)


__all__ = [
    "ATTEMPTS_MAX_CODEPOINTS",
    "EXCERPT_MAX_CODEPOINTS",
    "BACKGROUND_MAX_CODEPOINTS",
    "DEFAULT_STATUS",
    "DEFAULT_WORK_STATUS",
    "MAX_POSTS_PER_RECORD",
    "MAX_PROJECTS_PER_RECORD",
    "OUTCOME_MAX_CODEPOINTS",
    "RECORD_STATUSES",
    "SLUG_MAX_LENGTH",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED",
    "TITLE_MAX_CODEPOINTS",
    "WORK_ARCHIVED",
    "WORK_INVESTIGATING",
    "WORK_PENDING",
    "WORK_RESOLVED",
    "WORK_STATUSES",
    "WORK_STATUS_LABELS",
    "ExplorationRecord",
    "exploration_record_posts",
    "exploration_record_projects",
]
