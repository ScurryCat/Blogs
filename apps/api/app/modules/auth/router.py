"""认证路由（05 §7）。

  GET  /auth/session   读取会话状态与 CSRF token；没有会话时建立 10 分钟预登录会话
  POST /auth/login     校验 CSRF + Origin + 限流 → 认证 → 轮换会话
  POST /auth/logout    注销（幂等：没有会话也会清掉 Cookie）

普通浏览（文章、媒体、标签）**不会**创建会话：只有管理页面调用的这个 GET 会。
所有响应都是 `private, no-store`（01 §6：认证响应不得进入共享缓存）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.cookies import clear_session_cookie, set_session_cookie
from app.core.csrf import verify_write_request
from app.core.deps import get_session, get_settings_dep
from app.core.errors import CODE_FORBIDDEN, CODE_UNAUTHORIZED, ApiError
from app.core.http import private_no_store
from app.core.passwords import dummy_hash, verify_password
from app.core.csrf import csrf_token_for
from app.modules.auth import ratelimit, service
from app.modules.auth.deps import session_cookie_value
from app.modules.auth.schemas import (
    LoginIn,
    LogoutIn,
    OwnerStatusOut,
    SessionStatusOut,
    SessionUserOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(private_no_store)])

AUDIT_LOGIN = "auth.login"
AUDIT_LOGIN_FAILED = "auth.login_failed"
AUDIT_LOGOUT = "auth.logout"


def _status_payload(row, user) -> SessionStatusOut:
    return SessionStatusOut(
        authenticated=user is not None,
        user=SessionUserOut(id=user.id, username=user.username) if user is not None else None,
        csrf_token=csrf_token_for(row.csrf_secret),
        expires_at=row.expires_at,
        prelogin=user is None,
    )


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


@router.get("/session", response_model=SessionStatusOut, summary="读取会话状态与 CSRF token")
def read_session(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> SessionStatusOut:
    row = service.load_session(
        session, session_cookie_value(request, settings), settings=settings
    )
    if row is None:
        # 管理页面需要时才建立预登录会话；它是 CSRF 的载体，不含任何站主权限。
        row, raw_token = service.create_session(session, settings=settings)
        set_session_cookie(
            response, settings, raw_token, max_age=settings.prelogin_ttl_seconds
        )
    return _status_payload(row, service.session_user(session, row))


@router.get(
    "/owner-status",
    response_model=OwnerStatusOut,
    summary="站主登录状态探针（无副作用）",
)
def read_owner_status(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> OwnerStatusOut:
    """读会话但**不创建预登录会话、不写字**（P5 契约 §9.1）。

    前台访客页面需要「确认站主已登录后才展示快捷入口」。直接复用 `GET /auth/session`
    会给每个匿名访客建 10 分钟预登录会话（DB 写放大），因此这里提供只读探针：
    没有会话 / 预登录 / 过期 / 账号禁用一律 `authenticated=false`，响应 200。

    刻意不调用 `require_admin`（它会 touch last_seen_at 写库），也不返回 CSRF token：
    隐藏入口不是授权，真正的管理请求仍必须通过 `require_admin*`。
    """
    row = service.load_session(
        session, session_cookie_value(request, settings), settings=settings
    )
    user = service.session_user(session, row) if row is not None else None
    return OwnerStatusOut(
        authenticated=user is not None,
        user=SessionUserOut(id=user.id, username=user.username) if user is not None else None,
    )


@router.post("/login", response_model=SessionStatusOut, summary="站主登录")
async def login(
    request: Request,
    response: Response,
    payload: LoginIn,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> SessionStatusOut:
    row = service.load_session(
        session, session_cookie_value(request, settings), settings=settings
    )
    # 没有会话就没有可用的 CSRF 期望值：统一按 CSRF 失败处理（403），
    # 不给「先 GET /auth/session 再登录」之外的捷径。
    await verify_write_request(
        request,
        settings,
        expected_token=csrf_token_for(row.csrf_secret) if row is not None else None,
    )

    ip_key = ratelimit.rate_limit_key(ratelimit.LOGIN_IP_SCOPE, ratelimit.client_ip(request, settings))
    ratelimit.prune_expired(session)
    ratelimit.assert_login_allowed(
        session,
        key_hash=ip_key,
        limit_per_minute=settings.login_rate_limit_per_minute,
    )

    user = service.find_user(session, payload.username)
    # 用户不存在时也走一次真实校验，避免用响应时间枚举用户名。
    password_ok = verify_password(
        payload.password, user.password_hash if user is not None else dummy_hash()
    )

    if user is None or not password_ok:
        ratelimit.record_login_failure(session, key_hash=ip_key)
        service.record_audit(
            session,
            action=AUDIT_LOGIN_FAILED,
            entity_type="admin_user",
            actor_id=user.id if user is not None else None,
            request_id=_request_id(request),
            extra={"reason": "invalid_credentials"},
            commit=True,
        )
        raise ApiError(CODE_UNAUTHORIZED, "用户名或密码不正确", status_code=401)

    if user.disabled:
        # 凭证正确但账号被禁用：给出可操作的原因（本站只有一位站主）。
        service.record_audit(
            session,
            action=AUDIT_LOGIN_FAILED,
            entity_type="admin_user",
            entity_id=user.id,
            actor_id=user.id,
            request_id=_request_id(request),
            extra={"reason": "disabled"},
            commit=True,
        )
        raise ApiError(CODE_FORBIDDEN, "账号已被禁用", status_code=403)

    ratelimit.clear_login_failures(session, key_hash=ip_key)
    if row is None:  # pragma: no cover - 上面已保证 row 非空
        raise ApiError(CODE_UNAUTHORIZED, "会话已失效，请重新打开登录页", status_code=401)
    new_row, raw_token = service.rotate_session(session, row, settings=settings, user=user)
    set_session_cookie(
        response, settings, raw_token, max_age=settings.session_absolute_ttl_seconds
    )
    service.record_audit(
        session,
        action=AUDIT_LOGIN,
        entity_type="admin_user",
        entity_id=user.id,
        actor_id=user.id,
        request_id=_request_id(request),
        commit=True,
    )
    return _status_payload(new_row, user)


@router.post("/logout", status_code=204, summary="注销")
async def logout(
    request: Request,
    response: Response,
    payload: LogoutIn | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> Response:
    row = service.load_session(
        session, session_cookie_value(request, settings), settings=settings
    )
    if row is not None:
        await verify_write_request(
            request, settings, expected_token=csrf_token_for(row.csrf_secret)
        )
        user_id = row.user_id
        service.revoke_session(session, row, commit=False)
        service.record_audit(
            session,
            action=AUDIT_LOGOUT,
            entity_type="admin_user",
            entity_id=user_id,
            actor_id=user_id,
            request_id=_request_id(request),
            commit=True,
        )
    # 没有有效会话时注销是幂等的：清 Cookie 即可，没有需要保护的状态变更。
    clear_session_cookie(response, settings)
    response.status_code = 204
    return response
