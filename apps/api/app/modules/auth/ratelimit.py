"""登录限流（05 §9、06 §1）。

约定：
  - 首版把登录失败限制放在 PostgreSQL 短期安全表（`auth_rate_limits`），不用 Redis。
  - 每 IP 每分钟 5 次（`LOGIN_RATE_LIMIT_PER_MINUTE`，可配置）。
  - 标识以 **散列** 形式保存：库里不出现原始 IP 或用户名。
  - 触发限流返回 429 且带 `Retry-After`（05 §9）。
  - 安全限流元数据最多保留 24 小时，过期行机会式清理。
  - 只在**失败**时计数；成功登录清空该 key 的桶，避免正常用户被自己的成功登录拖住。

固定窗口实现：窗口起点按分钟对齐，计数用 `INSERT ... ON CONFLICT DO UPDATE` 原子递增，
并发请求不会互相覆盖计数。
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import CODE_RATE_LIMITED, ApiError
from app.modules.auth.models import AuthRateLimit

WINDOW_SECONDS = 60
RETENTION_HOURS = 24
LOGIN_IP_SCOPE = "login-ip"


def client_ip(request: Request, settings: Settings) -> str:
    """请求来源标识。

    只有显式配置 `TRUST_PROXY_HEADERS=true`（网关确实覆写了该头）时才看
    `X-Forwarded-For`，否则用 TCP 对端地址 —— 06 §2：不把公网可直连的任意
    `X-Forwarded-*` 当真实身份。
    """
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    client = request.client
    return client.host if client and client.host else "unknown"


def rate_limit_key(scope: str, identifier: str) -> str:
    """散列后的限流键。原始 IP / 用户名不落库。"""
    return hashlib.sha256(f"{scope}:{identifier}".encode("utf-8")).hexdigest()


def _window_start(moment: datetime) -> datetime:
    return moment.replace(second=0, microsecond=0)


def _retry_after_seconds(window_start: datetime, moment: datetime) -> int:
    remaining = (window_start + timedelta(seconds=WINDOW_SECONDS)) - moment
    return max(1, math.ceil(remaining.total_seconds()))


def prune_expired(session: Session, *, now: datetime | None = None) -> int:
    """删除超过保留期的桶，返回删除行数。"""
    moment = now or utcnow()
    result = session.execute(delete(AuthRateLimit).where(AuthRateLimit.expires_at < moment))
    return int(result.rowcount or 0)


def _current_count(session: Session, key_hash: str, window_start: datetime) -> int:
    count = session.execute(
        select(AuthRateLimit.count).where(
            AuthRateLimit.key_hash == key_hash,
            AuthRateLimit.window_start == window_start,
        )
    ).scalar()
    return int(count or 0)


def assert_login_allowed(
    session: Session,
    *,
    key_hash: str,
    limit_per_minute: int,
    now: datetime | None = None,
) -> None:
    """超过阈值抛 429 + Retry-After。计数只由 `record_login_failure` 增加。"""
    moment = now or utcnow()
    window = _window_start(moment)
    count = _current_count(session, key_hash, window)
    if count >= limit_per_minute:
        retry_after = _retry_after_seconds(window, moment)
        raise ApiError(
            CODE_RATE_LIMITED,
            "登录尝试过于频繁，请稍后再试",
            status_code=429,
            fields={"username": ["尝试过于频繁"]},
            headers={"Retry-After": str(retry_after)},
        )


def record_login_failure(
    session: Session,
    *,
    key_hash: str,
    now: datetime | None = None,
    commit: bool = True,
) -> int:
    """原子递增当前窗口的失败计数，返回新的计数。"""
    moment = now or utcnow()
    window = _window_start(moment)
    expires_at = moment + timedelta(hours=RETENTION_HOURS)
    statement = (
        pg_insert(AuthRateLimit)
        .values(
            key_hash=key_hash,
            window_start=window,
            count=1,
            expires_at=expires_at,
        )
        .on_conflict_do_update(
            index_elements=[AuthRateLimit.key_hash, AuthRateLimit.window_start],
            set_={"count": AuthRateLimit.__table__.c.count + 1},
        )
        .returning(AuthRateLimit.count)
    )
    count = session.execute(statement).scalar_one()
    if commit:
        session.commit()
    return int(count)


def clear_login_failures(session: Session, *, key_hash: str, commit: bool = True) -> int:
    """登录成功后清空该来源的桶。"""
    result = session.execute(delete(AuthRateLimit).where(AuthRateLimit.key_hash == key_hash))
    if commit:
        session.commit()
    return int(result.rowcount or 0)


def utc_timestamp() -> datetime:
    return utcnow().astimezone(timezone.utc)
