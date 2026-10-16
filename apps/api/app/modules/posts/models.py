"""文章模型（05 §3「文章与标签」）。

  posts: id / 唯一 slug / title / excerpt / content_md / category / cover_media_id /
         display_date / status / published_at / created_at / updated_at / deleted_at / version

约定：
  - `display_date` 保留旧文章「只有日期」的展示语义；`published_at` 是真正的发布时间。
    导入时按**迁移约定时区**换算，不悄悄改成导入当天（05 §3）。
  - `content_md` 是正文的权威来源（旧 Markdown 原文保留），不把渲染 HTML 当存档。
  - `status` 只有 draft / published + 可空 `deleted_at`；`version` 每次成功修改递增。
  - 公开列表用**部分索引**（published_at DESC, id DESC）+ 公开条件，
    而不是给所有文本列堆 GIN 索引（05 §4）。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
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

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

POST_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

SLUG_MAX_LENGTH = 200
TITLE_MAX_LENGTH = 200
CATEGORY_MAX_LENGTH = 64
EXCERPT_MAX_LENGTH = 500


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        # 公开列表的部分索引：只覆盖「已发布且未删除」，与查询条件一致。
        Index(
            "ix_posts_public_listing",
            "published_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
        Index("ix_posts_category_published_at", "category", "published_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(SLUG_MAX_LENGTH), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    excerpt: Mapped[str] = mapped_column(String(EXCERPT_MAX_LENGTH), nullable=False, default="")
    content_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(CATEGORY_MAX_LENGTH), nullable=False, default="")
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("media.id", ondelete="SET NULL"),
        nullable=True,
    )
    display_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    def bump_version(self) -> None:
        """成功修改后递增版本（05 §2）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()
