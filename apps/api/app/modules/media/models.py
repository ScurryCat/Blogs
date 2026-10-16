"""媒体模型（05 §3「媒体」）。

  media: id / owner_id / storage_key / mime_type / bytes / width / height /
         sha256 / variants / status / created_at / deleted_at

约定：
  - `storage_key` 由服务端生成（`<uuid 前两位>/<uuid>/<name>`），**不使用用户文件名拼路径**。
  - `variants` 只放形状可变的小数据（固定变体名 + 宽高 + 对象键）；权限条件、外键、
    发布状态一律不藏在 JSON 里。
  - `status` 为 processing / ready / failed，用数据库 CHECK 约束住取值。
  - `bytes` 是存储对象的字节数；`sha256` 是存储对象的摘要（用于识别孤儿与重复导入）。

T01 的同步处理路径只在文件完整落位后才插入 `ready` 记录（05 §4：文件系统与数据库
不是同一事务，不把「数据库回滚」说成能回滚文件）；`processing` / `failed` 供后续
异步处理与失败登记使用，并且是孤儿报告识别对象的依据。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_FAILED = "failed"

MEDIA_STATUSES = (STATUS_PROCESSING, STATUS_READY, STATUS_FAILED)


class Media(Base):
    __tablename__ = "media"
    __table_args__ = (
        CheckConstraint(
            "status in ('processing', 'ready', 'failed')",
            name="status_valid",
        ),
        CheckConstraint("bytes >= 0", name="bytes_non_negative"),
        CheckConstraint("width > 0 and height > 0", name="positive_dimensions"),
        CheckConstraint("length(sha256) = 64", name="sha256_length"),
        Index("ix_media_sha256", "sha256"),
        Index("ix_media_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    variants: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_READY)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- 便捷属性（只读，不参与查询） ---------------------------------------
    @property
    def is_ready(self) -> bool:
        return self.status == STATUS_READY and self.deleted_at is None

    def object_keys(self) -> list[str]:
        """本记录拥有的全部对象键（原图 + 变体），孤儿识别用。"""
        keys = [self.storage_key]
        for variant in (self.variants or {}).values():
            key = variant.get("key") if isinstance(variant, dict) else None
            if key:
                keys.append(key)
        return keys
