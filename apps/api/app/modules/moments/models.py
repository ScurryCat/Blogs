"""图文动态模型（05 §3「INS」）。

  moments      id / author_id / text / status / published_at / created_at /
               updated_at / deleted_at / version
  moment_media moment_id / media_id / position / alt；同一动态的媒体 ID 与 position 分别唯一
  moment_tags  moment_id / tag_id，组合唯一

数据库能表达的约束就落在数据库（05 §3 末段：**不能只靠管理表单**）：

  - `ck_moments_status_valid`       只有 draft / published 两个取值
  - `ck_moments_version_positive`   version >= 1
  - `ck_moments_text_length`        文字 <= 2000 个 Unicode 码点（`char_length` 即码点数）
  - `ck_moment_media_position_range` position 在 0–8 之间（1–9 张图）
  - `ck_moment_media_alt_length`    alt 1–200 个码点
  - `pk_moment_media`               复合主键 → 同一动态的 media_id 唯一
  - `uq_moment_media_moment_id_position`  同一动态的 position 唯一

「最多 8 个标签」「发布时必须有 1–9 张 ready 图片」是跨行约束，按 05 §3 由服务端
在事务里验证（见 `service.py`），而不是硬塞进 CHECK。

发布列表使用**部分索引** `(published_at DESC, id DESC) WHERE status='published'
AND deleted_at IS NULL`，与公开查询条件一致（05 §4：按公开条件选部分索引，
不凭「可能搜索很多」给所有文本建 GIN 索引）。
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
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

MOMENT_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# 内容与发布规则（03 §5）。
TEXT_MAX_CODEPOINTS = 2000
IMAGES_MIN = 1
IMAGES_MAX = 9
ALT_MIN_CODEPOINTS = 1
ALT_MAX_CODEPOINTS = 200
TAGS_MAX = 8
TAG_MAX_CODEPOINTS = 24


class Moment(Base):
    __tablename__ = "moments"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(f"char_length(text) <= {TEXT_MAX_CODEPOINTS}", name="text_length"),
        # 公开列表的部分索引：只覆盖「已发布且未删除」，与 service.public_conditions 一致。
        Index(
            "ix_moments_public_listing",
            "published_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
        Index("ix_moments_author_created_at", "author_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
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


# 关联表：复合主键表达「同一动态的 media_id 唯一」，唯一约束表达「position 唯一」。
moment_media = Table(
    "moment_media",
    Base.metadata,
    Column(
        "moment_id",
        Uuid(as_uuid=True),
        ForeignKey("moments.id", ondelete="CASCADE"),
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
    UniqueConstraint("moment_id", "position", name="uq_moment_media_moment_id_position"),
    # 媒体删除前要检查引用，反向查询（按 media_id 找动态）必须有索引。
    Index("ix_moment_media_media_id", "media_id"),
)

# 关联表：复合主键即「同一动态同一标签只能出现一次」的数据库级保证。
moment_tags = Table(
    "moment_tags",
    Base.metadata,
    Column(
        "moment_id",
        Uuid(as_uuid=True),
        ForeignKey("moments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        Uuid(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    # 按标签筛选公开动态（`GET /moments?tag=`）与公开标签来源都要从 tag_id 进。
    Index("ix_moment_tags_tag_id", "tag_id"),
)
