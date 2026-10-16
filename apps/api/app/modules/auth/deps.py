"""认证依赖：谁在请求、能不能写（05 §5、SHARED-CONTRACTS §5）。

两层依赖，避免「忘记校验」：
  - `current_session`：读取 Cookie 里的会话（预登录或已登录），不抛错。
  - `require_admin`：**必须是已登录站主**；预登录会话在这里被拒（401）。
  - `require_admin_write`：在 require_admin 之上再加 Origin + CSRF 校验（403）。

所有管理端点都应使用 `require_admin_write`（写）或 `require_admin`（读），
不要自己判断 Cookie。
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.cookies import session_cookie_name
from app.core.csrf import csrf_token_for, verify_write_request
from app.core.deps import get_session, get_settings_dep
from app.core.errors import CODE_UNAUTHORIZED, ApiError
from app.modules.auth import service
from app.modules.auth.models import AdminSession, AdminUser


@dataclass(frozen=True)
class AdminContext:
    """通过校验的站主上下文。`csrf_token` 派生于会话 secret，供响应复用。"""

    session_row: AdminSession
    user: AdminUser

    @property
    def csrf_token(self) -> str:
        return csrf_token_for(self.session_row.csrf_secret)


def session_cookie_value(request: Request, settings: Settings) -> str | None:
    return request.cookies.get(session_cookie_name(settings))


def current_session(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> AdminSession | None:
    """读取当前会话（预登录也会返回）。不刷新 last_seen_at。"""
    return service.load_session(
        session, session_cookie_value(request, settings), settings=settings
    )


def _unauthorized(message: str = "需要站主登录") -> ApiError:
    return ApiError(CODE_UNAUTHORIZED, message, status_code=401)


def require_admin(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> AdminContext:
    """要求已登录站主。预登录会话（user_id 为空）在此被明确拒绝。"""
    row = service.load_session(session, session_cookie_value(request, settings), settings=settings)
    if row is None:
        raise _unauthorized()
    user = service.session_user(session, row)
    if user is None:
        # 账号被禁用 / 删除：会话立即失效（05 §5.6）。
        raise _unauthorized("账号不可用")
    service.touch_session(session, row)
    return AdminContext(session_row=row, user=user)


def optional_admin(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> AdminContext | None:
    """有站主会话就返回上下文，否则 None。用于「站主可看原图、匿名只看公开变体」的端点。

    与 `require_admin` 的区别只在于**不抛 401**；权限判断仍由调用方按上下文分支完成，
    预登录会话在这里同样拿不到 AdminContext。
    """
    row = service.load_session(session, session_cookie_value(request, settings), settings=settings)
    if row is None:
        return None
    user = service.session_user(session, row)
    if user is None:
        return None
    service.touch_session(session, row)
    return AdminContext(session_row=row, user=user)


async def require_admin_write(
    request: Request,
    context: AdminContext = Depends(require_admin),
    settings: Settings = Depends(get_settings_dep),
) -> AdminContext:
    """要求已登录站主 + 同源 Origin + 有效 CSRF。用于所有状态变更请求。"""
    await verify_write_request(
        request,
        settings,
        expected_token=csrf_token_for(context.session_row.csrf_secret),
    )
    return context
