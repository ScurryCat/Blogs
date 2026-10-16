"""认证、会话、审计与限流模型（05 §3「管理与会话」）。

字段与约束严格照 05 §3；数据库能表达的约束（唯一键、CHECK、外键）就落在数据库，
不只靠表单校验：

  admin_users        id / 唯一 username / password_hash / disabled / created_at
  sessions           id / 唯一 token_hash / 可空 user_id / csrf_secret /
                     created_at / last_seen_at / expires_at / revoked_at
  audit_events       id / actor_id / action / entity_type / entity_id /
                     request_id / at / 最小变更元数据
  auth_rate_limits   散列 key / 窗口 / 计数 / 过期时间（只做短期安全限制）

安全约定：
  - 预登录会话的 `user_id` 为 NULL，不能用于站主权限（由 service 强制）。
  - 库里只保存随机会话凭证的 hash，不保存凭证本身。
  - 审计不保存密码、Cookie、搜索正文或完整上传文件。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 64


class AdminUser(Base):
    __tablename__ = "admin_users"
    __table_args__ = (
        CheckConstraint("length(username) >= 3", name="username_min_length"),
        CheckConstraint("length(username) <= 64", name="username_max_length"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(USERNAME_MAX_LENGTH), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class AdminSession(Base):
    """站主会话。表名按 05 §3 用 `sessions`；类名加前缀避免与 SQLAlchemy Session 混淆。"""

    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_expires_at", "expires_at"),
        CheckConstraint("expires_at > created_at", name="expires_after_creation"),
        CheckConstraint("last_seen_at >= created_at", name="last_seen_after_creation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # 预登录会话为 NULL —— 这是「预登录不能管理」的结构性保证。
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="CASCADE"),
        nullable=True,
    )
    csrf_secret: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_at", "at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    # 属性名不能叫 `metadata`（与 DeclarativeBase.metadata 冲突），列名保持 metadata。
    extra: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)


class AuthRateLimit(Base):
    """登录限流桶。`key_hash` 是散列后的标识（IP / 用户名），不保存原始输入。"""

    __tablename__ = "auth_rate_limits"
    __table_args__ = (
        UniqueConstraint("key_hash", "window_start", name="key_window"),
        Index("ix_auth_rate_limits_expires_at", "expires_at"),
        CheckConstraint("count >= 0", name="count_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
