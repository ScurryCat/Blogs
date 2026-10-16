"""访客会话：凭证、Cookie、归属校验（08 §7）。

与站主会话的**硬性分离**（SHARED-CONTRACTS §5、05 §11、T01 交付单 §9 第 6 条）：

  | | 站主会话（T01） | 访客会话（本模块） |
  | --- | --- | --- |
  | 表 | `sessions` | **`visitor_sessions`** |
  | Cookie | `__Host-pl_session` / `pl_session_dev` | `__Host-pl_visitor` / `pl_visitor_dev` |
  | 能力 | 管理后台的全部读写 | 只能读写**自己那一份**角色消息 |

两张表不共用任何行、Cookie 名不同、CSRF 密钥不同。混表会让「匿名访客」与
「已登录站主」的权限判断纠缠在一起 —— 那正是要避免的。

凭证处理：
  - 原始 token 用 `secrets.token_urlsafe(32)` 生成，**只**出现在 Set-Cookie 里；
  - 库里只存 `sha256(token)`，因此读走整张表也无法冒充访客；
  - 每次读取都在 SQL 的 `WHERE` 里带上摘要 + 到期时间，
    「先按 id 查出来再在 Python 里比较」这种写法在本模块不存在。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.csrf import csrf_token_for
from app.core.db import utcnow
from app.modules.messaging import models as m
from app.modules.messaging.config import MessagingSettings

PROD_VISITOR_COOKIE = "__Host-pl_visitor"
DEV_VISITOR_COOKIE = "pl_visitor_dev"

TOKEN_BYTES = 32
CSRF_SECRET_BYTES = 32


def visitor_cookie_name(*, is_production: bool) -> str:
    """生产用 `__Host-` 前缀（强制 Secure + Path=/ + 无 Domain），开发用单独的名字。

    生产名与开发名不同是有意的：混用会立刻表现为「本地能用、线上没会话」，
    而不是安静地发一个不安全的 Cookie 上线。
    """
    return PROD_VISITOR_COOKIE if is_production else DEV_VISITOR_COOKIE


def new_visitor_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def new_csrf_secret() -> str:
    return secrets.token_urlsafe(CSRF_SECRET_BYTES)


def token_digest(token: str) -> str:
    """凭证摘要。库中只保存它。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def visitor_csrf_token(row: m.VisitorSession) -> str:
    """由访客会话的 `csrf_secret` 派生对外 token（库中不存派生结果）。

    复用 T01 `app/core/csrf.py` 的同一个原语：它只依赖一个字符串，
    因此不需要为了访客另写一套 HMAC。
    """
    return csrf_token_for(row.csrf_secret)


def ip_digest(ip: str | None, *, salt: str) -> str | None:
    """IP 的 HMAC 摘要。库里与日志里都不出现原始 IP。"""
    if not ip:
        return None
    return hmac.new(salt.encode("utf-8"), ip.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


# --- 生命周期 --------------------------------------------------------------


def create_session(
    session: Session,
    *,
    settings: MessagingSettings,
    ip_hash: str | None,
    now: datetime | None = None,
) -> tuple[m.VisitorSession, str]:
    """新建一个访客会话，返回 (行, 原始 token)。原始 token 不写库。"""
    moment = now or utcnow()
    raw = new_visitor_token()
    row = m.VisitorSession(
        token_hash=token_digest(raw),
        csrf_secret=new_csrf_secret(),
        ip_hash=ip_hash,
        created_at=moment,
        last_seen_at=moment,
        expires_at=moment + timedelta(seconds=settings.visitor_session_idle_seconds),
        absolute_expires_at=moment
        + timedelta(seconds=settings.visitor_session_absolute_seconds),
    )
    session.add(row)
    session.flush()
    return row, raw


def resolve_visitor(
    session: Session,
    token: str | None,
    *,
    now: datetime | None = None,
) -> m.VisitorSession | None:
    """按原始 token 取**未过期**的访客会话。缺失 / 过期 / 伪造一律返回 None。"""
    candidate = (token or "").strip()
    if not candidate or len(candidate) > 512:
        return None
    moment = now or utcnow()
    return session.execute(
        select(m.VisitorSession).where(
            m.VisitorSession.token_hash == token_digest(candidate),
            m.VisitorSession.expires_at > moment,
            m.VisitorSession.absolute_expires_at > moment,
        )
    ).scalars().first()


def touch(
    session: Session,
    row: m.VisitorSession,
    *,
    settings: MessagingSettings,
    now: datetime | None = None,
) -> None:
    """滑动续期。绝对上限不会被突破（否则「一直访问」就等于永不过期）。"""
    moment = now or utcnow()
    row.last_seen_at = moment
    row.expires_at = min(
        moment + timedelta(seconds=settings.visitor_session_idle_seconds),
        row.absolute_expires_at,
    )


def set_cookie(
    response: Response,
    row_token: str,
    *,
    is_production: bool,
    settings: MessagingSettings,
) -> None:
    """写访客 Cookie。永远 HttpOnly + SameSite=Lax；生产必须 Secure。

    属性与职责和数据一样重要：HttpOnly 让脚本读不到凭证（因此不存在
    「把会话 ID 放 localStorage」的 XSS 放大路径）。
    """
    response.set_cookie(
        key=visitor_cookie_name(is_production=is_production),
        value=row_token,
        max_age=settings.visitor_session_idle_seconds,
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/",
        # 不设置 domain：__Host- 前缀的强制条件，也避免子域共享访客身份。
    )


def clear_cookie(response: Response, *, is_production: bool) -> None:
    response.delete_cookie(
        key=visitor_cookie_name(is_production=is_production),
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/",
    )


def delete_session(session: Session, row: m.VisitorSession) -> None:
    """立即清除该访客的全部会话与消息（08 §7「访客可以立即清除聊天」）。

    用显式 DELETE 而不是依赖 ORM 级联：`conversations` → `messages` 是
    数据库上的 `ON DELETE CASCADE`，但 `ai_budget_days` 是**全站**计数，
    不应该因为一个访客清除记录就被改动（当天已产生的成本仍然要如实保留）。
    """
    session.delete(row)
    session.flush()


def purge_expired(session: Session, *, now: datetime | None = None) -> dict[str, int]:
    """清理到期数据，返回删除行数。

    这是**可被调用**的清理入口，不是一个自跑的定时任务：真正的调度窗口、
    备份排除与恢复后的行为由 T10 核实（任务卡：「清除与备份规则交给 T10」）。
    调用它是幂等的。
    """
    moment = now or utcnow()
    visitor_ids = list(
        session.execute(
            select(m.VisitorSession.id).where(
                (m.VisitorSession.expires_at <= moment)
                | (m.VisitorSession.absolute_expires_at <= moment)
            )
        ).scalars()
    )
    conversations = session.execute(
        delete(m.Conversation).where(m.Conversation.expires_at <= moment)
    ).rowcount
    sessions = 0
    if visitor_ids:
        sessions = session.execute(
            delete(m.VisitorSession).where(m.VisitorSession.id.in_(visitor_ids))
        ).rowcount
    return {"visitor_sessions": int(sessions or 0), "conversations": int(conversations or 0)}


def purge_stale_from_session(session: Session, row: m.VisitorSession, *, now: datetime) -> None:
    """清掉这个访客过期的那部分会话（会话级保留期与访客会话保留期可以不同）。"""
    session.execute(
        delete(m.Conversation).where(
            m.Conversation.visitor_session_id == row.id,
            m.Conversation.expires_at <= now,
        )
    )


__all__ = [
    "DEV_VISITOR_COOKIE",
    "PROD_VISITOR_COOKIE",
    "clear_cookie",
    "create_session",
    "delete_session",
    "ip_digest",
    "new_csrf_secret",
    "new_visitor_token",
    "purge_expired",
    "purge_stale_from_session",
    "resolve_visitor",
    "set_cookie",
    "token_digest",
    "touch",
    "visitor_cookie_name",
    "visitor_csrf_token",
]
