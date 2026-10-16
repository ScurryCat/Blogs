"""站主认证与会话（05 §5）。

设计要点：
  - **服务端会话**，不是 JWT：库里只保存随机会话凭证的 sha256，凭证本身只出现在 Cookie。
  - 预登录会话（`user_id IS NULL`，10 分钟）只用来承载 CSRF token；它**不能**用于站主权限，
    这条由 `require_admin` 在读取侧强制。
  - 登录成功**轮换**会话 id 与 CSRF token（防会话固定）。
  - 会话绝对有效期 8 小时；空闲 30 分钟失效；注销或禁用账号立即不可用。
  - CSRF token 由 `csrf_secret` 派生（HMAC），库里不存 token 本身。
  - 审计只记录必要的管理事件，不保存密码、Cookie 或正文。
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.csrf import csrf_token_for  # noqa: F401  # 重新导出：会话 token 由 core 派生
from app.core.db import utcnow
from app.modules.auth.models import AdminSession, AdminUser, AuditEvent

logger = logging.getLogger(__name__)

SESSION_TOKEN_BYTES = 32
CSRF_SECRET_BYTES = 32

# 每个请求都写 last_seen_at 会让只读请求产生写放大；间隔小于这个秒数就不更新。
TOUCH_INTERVAL_SECONDS = 60


def hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _new_secret() -> str:
    return secrets.token_urlsafe(CSRF_SECRET_BYTES)


def create_session(
    session: Session,
    *,
    settings: Settings,
    user: AdminUser | None = None,
    now: datetime | None = None,
    commit: bool = True,
) -> tuple[AdminSession, str]:
    """建立一个会话（`user=None` 即预登录）。返回 (记录, 明文凭证)。"""
    moment = now or utcnow()
    ttl = settings.session_absolute_ttl_seconds if user is not None else settings.prelogin_ttl_seconds
    raw_token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    row = AdminSession(
        token_hash=hash_session_token(raw_token),
        user_id=user.id if user is not None else None,
        csrf_secret=_new_secret(),
        created_at=moment,
        last_seen_at=moment,
        expires_at=moment + timedelta(seconds=ttl),
    )
    session.add(row)
    if commit:
        session.commit()
    else:
        session.flush()
    return row, raw_token


def load_session(
    session: Session,
    raw_token: str | None,
    *,
    settings: Settings,
    now: datetime | None = None,
) -> AdminSession | None:
    """按凭证读会话。过期 / 已注销 / 空闲超时 / 账号禁用一律返回 None。"""
    if not raw_token:
        return None
    moment = now or utcnow()
    row = session.execute(
        select(AdminSession).where(
            AdminSession.token_hash == hash_session_token(raw_token),
            AdminSession.revoked_at.is_(None),
        )
    ).scalars().first()
    if row is None:
        return None
    if row.expires_at <= moment:
        return None
    if row.last_seen_at + timedelta(seconds=settings.session_idle_ttl_seconds) <= moment:
        return None
    if row.user_id is not None:
        user = session.get(AdminUser, row.user_id)
        if user is None or user.disabled:
            return None
    return row


def session_user(session: Session, row: AdminSession) -> AdminUser | None:
    if row.user_id is None:
        return None
    user = session.get(AdminUser, row.user_id)
    if user is None or user.disabled:
        return None
    return user


def touch_session(
    session: Session,
    row: AdminSession,
    *,
    now: datetime | None = None,
    commit: bool = True,
) -> None:
    """刷新 last_seen_at（节流写入）。失败不应影响业务响应，由调用方决定是否吞掉异常。"""
    moment = now or utcnow()
    if (moment - row.last_seen_at).total_seconds() < TOUCH_INTERVAL_SECONDS:
        return
    row.last_seen_at = moment
    if commit:
        session.commit()


def rotate_session(
    session: Session,
    row: AdminSession,
    *,
    settings: Settings,
    user: AdminUser,
    now: datetime | None = None,
) -> tuple[AdminSession, str]:
    """登录成功：注销旧会话并新建（新的凭证 + 新的 CSRF secret）。"""
    moment = now or utcnow()
    row.revoked_at = moment
    new_row, raw_token = create_session(
        session, settings=settings, user=user, now=moment, commit=False
    )
    session.commit()
    return new_row, raw_token


def revoke_session(session: Session, row: AdminSession, *, commit: bool = True) -> None:
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        if commit:
            session.commit()


def create_admin(
    session: Session,
    *,
    username: str,
    password_hash: str,
    commit: bool = True,
) -> AdminUser:
    user = AdminUser(username=username.strip(), password_hash=password_hash)
    session.add(user)
    if commit:
        session.commit()
    else:
        session.flush()
    return user


def find_user(session: Session, username: str) -> AdminUser | None:
    """用户名不区分大小写匹配；返回记录以便对禁用账号给出准确判断。"""
    normalized = username.strip().lower()
    if not normalized:
        return None
    return session.execute(
        select(AdminUser).where(func.lower(AdminUser.username) == normalized)
    ).scalars().first()


def record_audit(
    session: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    request_id: str | None = None,
    extra: dict | None = None,
    commit: bool = False,
) -> AuditEvent:
    """记录一条审计事件。

    `commit=True` 用于「操作失败也要留痕」的路径（例如登录失败）。
    `extra` 只放最小变更元数据；调用方不得放密码、Cookie 或正文。
    """
    event = AuditEvent(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        request_id=request_id,
        at=utcnow(),
        extra=extra or {},
    )
    session.add(event)
    if commit:
        session.commit()
    return event
