"""工作草稿模型（P5 第一批 · 设计书 §3.1）。

  work_drafts       id / owner_id / content_type / target_id / target_version /
                    data(jsonb) / status / commit_key / committed_target_id /
                    created_at / updated_at
  work_draft_media  draft_id / media_id / position / alt

数据库能表达的约束落在数据库：
  - `ck_work_drafts_content_type_valid`   只有 moment / journal
  - `ck_work_drafts_status_valid`         只有 active / committed / discarded
  - `ck_work_drafts_target_version_positive`  target_version 为空或 >= 1
  - `ck_work_drafts_draft_version_positive`   draft_version >= 1
  - 有效草稿唯一性：同一站主 × 同一内容类型 × 同一正式内容只有一份 active 草稿
    （新内容 target_id 为空，允许同时存在多份 —— 用 partial unique index）。
  - 幂等键唯一性：同一站主的所有草稿里，同一个 `commit_key` 只能出现一次
    （partial unique index，`commit_key IS NULL` 的草稿不参与）。
    跨草稿重复用 key 直接 409，避免错误回放别的草稿的提交结果。
  - `work_draft_media` 复合主键 → 同一草稿同一媒体唯一；position 唯一且 0–8。
  - 草稿的媒体保留关系**不授予**匿名访问（`media.public_refs` 不登记本模块）。

`draft_version` 是 If-Match 的并发控制依据：每次 PATCH / 提交成功后 +1。
`updated_at` + `id` 的倒序索引供「继续编辑」列表分页；ASC 索引同样支持
`ORDER BY updated_at DESC, id DESC` 的反向扫描，因此不额外建 DESC 索引。
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
    UniqueConstraint,
    Uuid,
    text as sql_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

CONTENT_TYPE_MOMENT = "moment"
CONTENT_TYPE_JOURNAL = "journal"
CONTENT_TYPES = (CONTENT_TYPE_MOMENT, CONTENT_TYPE_JOURNAL)

STATUS_ACTIVE = "active"
STATUS_COMMITTED = "committed"
STATUS_DISCARDED = "discarded"
DRAFT_STATUSES = (STATUS_ACTIVE, STATUS_COMMITTED, STATUS_DISCARDED)

IMAGES_MAX = 9
ALT_MAX_CODEPOINTS = 200


class WorkDraft(Base):
    __tablename__ = "work_drafts"
    __table_args__ = (
        CheckConstraint("content_type in ('moment', 'journal')", name="content_type_valid"),
        CheckConstraint(
            "status in ('active', 'committed', 'discarded')", name="status_valid"
        ),
        CheckConstraint("draft_version >= 1", name="draft_version_positive"),
        CheckConstraint(
            "target_version is null or target_version >= 1", name="target_version_positive"
        ),
        # 同一站主 × 同一内容类型 × 同一正式内容：至多一份 active 草稿。
        Index(
            "uq_work_drafts_active_target",
            "owner_id",
            "content_type",
            "target_id",
            unique=True,
            postgresql_where=sql_text("status = 'active' AND target_id IS NOT NULL"),
        ),
        # 幂等键唯一性：同一站主 × 同一 commit_key 至多一份草稿（跨草稿重复使用直接 409）。
        Index(
            "uq_work_drafts_owner_commit_key",
            "owner_id",
            "commit_key",
            unique=True,
            postgresql_where=sql_text("commit_key IS NOT NULL"),
        ),
        # 创作台「继续编辑」列表与 API 分页都按这个顺序取数。
        Index(
            "ix_work_drafts_owner_updated",
            "owner_id",
            "content_type",
            "updated_at",
            "id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    target_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_ACTIVE)
    draft_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    commit_key: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    committed_target_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True
    )
    # 幂等回放时返回的正式内容版本：重试可能发生在正式内容又被改过之后，
    # 回放必须给「当次提交的结果」，而不是「现在的最新版本」。
    committed_target_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    def bump_version(self) -> None:
        """成功保存工作副本后递增草稿版本（If-Match 的并发控制依据）。调用方负责提交。"""
        self.draft_version = int(self.draft_version) + 1
        self.updated_at = utcnow()


work_draft_media = Table(
    "work_draft_media",
    Base.metadata,
    Column(
        "draft_id",
        Uuid(as_uuid=True),
        ForeignKey("work_drafts.id", ondelete="CASCADE"),
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
    UniqueConstraint("draft_id", "position", name="uq_work_draft_media_draft_id_position"),
    Index("ix_work_draft_media_media_id", "media_id"),
)
