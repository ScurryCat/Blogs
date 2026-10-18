"""认证 DTO（05 §7）。

管理会话响应只含身份与 CSRF token，不含凭证、密码哈希、会话 id 或过期细节。
`csrf_token` 随响应体返回（不进 Cookie、不进 localStorage，05 §5.8）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SessionUserOut(BaseModel):
    id: uuid.UUID
    username: str


class SessionStatusOut(BaseModel):
    """`GET /auth/session` 与登录成功的响应。预登录时 `authenticated=false`、`user=null`。"""

    authenticated: bool
    user: SessionUserOut | None
    csrf_token: str
    expires_at: datetime | None
    # 便于前端区分「已登录」与「刚建立预登录会话」，不用猜。
    prelogin: bool


class OwnerStatusOut(BaseModel):
    """`GET /auth/owner-status`：无副作用探针（不建会话、不写字）。

    只回答「当前请求者是不是已登录站主」以及最小身份信息；**不含** CSRF token /
    过期时间 —— 它只用于前台条件渲染站主入口，不是登录状态的权威来源。
    """

    authenticated: bool
    user: SessionUserOut | None


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)
    # CSRF token 允许放在 JSON body（也接受 X-CSRF-Token 请求头，见 core/csrf.py）。
    csrf_token: str | None = Field(default=None, max_length=256)


class LogoutIn(BaseModel):
    csrf_token: str | None = Field(default=None, max_length=256)
