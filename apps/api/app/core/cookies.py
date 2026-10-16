"""会话 Cookie 的名称与属性（05 §5.5 / §5.8）。

规则：
  - 生产使用 `__Host-pl_session`：必须 `Secure`、`Path=/`、且**不设置 Domain**，
    这是 `__Host-` 前缀的强制条件。
  - 本地 HTTP 使用**单独的开发 Cookie 名**且非 Secure（05 §5 末尾），
    以免开发配置被原样带上线；生产名与开发名不同，混用会立刻表现为「登录不生效」。
  - 永远 `HttpOnly` + `SameSite=Lax`；凭据不进 localStorage、不进日志。

这里只负责名字与属性；读写在 auth 模块完成。
"""

from __future__ import annotations

from fastapi import Response

from app.core.config import Settings

PROD_COOKIE_NAME = "__Host-pl_session"
DEV_COOKIE_NAME = "pl_session_dev"

# 浏览器端可读的 CSRF token 不放 Cookie（05 §5.8），而是随 JSON 响应返回。


def session_cookie_name(settings: Settings) -> str:
    return PROD_COOKIE_NAME if settings.is_production else DEV_COOKIE_NAME


def session_cookie_secure(settings: Settings) -> bool:
    return settings.is_production


def set_session_cookie(response: Response, settings: Settings, token: str, *, max_age: int) -> None:
    """写入会话 Cookie。`max_age` 用会话绝对有效期，不用空闲时间（空闲在服务端判断）。"""
    response.set_cookie(
        key=session_cookie_name(settings),
        value=token,
        max_age=max_age,
        httponly=True,
        secure=session_cookie_secure(settings),
        samesite="lax",
        path="/",
        # 不设置 domain：__Host- 前缀要求，且避免子域共享会话。
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=session_cookie_name(settings),
        httponly=True,
        secure=session_cookie_secure(settings),
        samesite="lax",
        path="/",
    )
