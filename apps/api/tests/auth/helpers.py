"""认证相关测试辅助：建站主、走完预登录 → 登录 → 注销的真实 HTTP 流程。

刻意不使用任何「直接伪造会话」的捷径：测试里的 Cookie 与 CSRF token 都来自真实端点，
因此 CSRF / Origin / 轮换这些行为是被真的执行过的，而不是被测试绕过。
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.passwords import hash_password
from app.modules.auth.models import AdminUser
from app.modules.auth.service import create_admin

# TestClient 的默认 Host 是 testserver；同源 Origin 校验据此通过。
ORIGIN = "http://testserver"
DEFAULT_USERNAME = "owner"
DEFAULT_PASSWORD = "t01-owner-password-123"


def csrf_headers(token: str, *, origin: str = ORIGIN) -> dict[str, str]:
    return {"Origin": origin, "X-CSRF-Token": token}


def make_admin(
    session: Session,
    *,
    username: str = DEFAULT_USERNAME,
    password: str = DEFAULT_PASSWORD,
    disabled: bool = False,
) -> AdminUser:
    user = create_admin(session, username=username, password_hash=hash_password(password))
    if disabled:
        user.disabled = True
        session.commit()
    return user


def read_session(client: TestClient) -> dict:
    """GET /auth/session。没有会话时会建立预登录会话并写入 Cookie。"""
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200, response.text
    return response.json()


def login(
    client: TestClient,
    *,
    username: str = DEFAULT_USERNAME,
    password: str = DEFAULT_PASSWORD,
    csrf_token: str | None = None,
    origin: str = ORIGIN,
    transport: str = "body",
):
    """POST /auth/login。transport 决定 CSRF token 放在 body 还是请求头。"""
    body: dict[str, object] = {"username": username, "password": password}
    headers: dict[str, str] = {"Origin": origin}
    if csrf_token is not None:
        if transport == "header":
            headers["X-CSRF-Token"] = csrf_token
        else:
            body["csrf_token"] = csrf_token
    return client.post("/api/v1/auth/login", json=body, headers=headers)


def login_ok(client: TestClient, *, username: str = DEFAULT_USERNAME, password: str = DEFAULT_PASSWORD) -> dict:
    """完整流程：预登录 → 登录成功。返回登录后的会话状态。"""
    prelogin = read_session(client)
    response = login(client, username=username, password=password, csrf_token=prelogin["csrf_token"])
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["authenticated"] is True, payload
    return payload


def logout(client: TestClient, csrf_token: str, *, origin: str = ORIGIN):
    return client.post(
        "/api/v1/auth/logout", json={"csrf_token": csrf_token}, headers={"Origin": origin}
    )
