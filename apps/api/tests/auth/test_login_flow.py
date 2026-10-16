"""站主认证 / 会话 / CSRF / 限流的行为测试。

对应「必须有的测试」第 2 行：
  跨站登录、跨站发布请求、旧会话、注销后复用 → 被拒绝；预登录凭证不能赋予管理权限。

以及 05 §10.4 要求的认证集成测试：预登录、会话轮换、CSRF、过期、注销、禁用账号、登录限流。
全部走真实 HTTP（TestClient）+ 真实 PostgreSQL。
"""

from __future__ import annotations

from datetime import timedelta

from app.core.cookies import DEV_COOKIE_NAME
from app.core.db import utcnow
from app.modules.auth import service as auth_service
from app.modules.auth.router import AUDIT_LOGIN_FAILED
from app.modules.media.router import router as media_router
from app.modules.posts.router import router as posts_router
from app.modules.tags.router import router as tags_router
from tests.auth.helpers import (
    DEFAULT_PASSWORD,
    DEFAULT_USERNAME,
    ORIGIN,
    csrf_headers,
    login,
    login_ok,
    logout,
    make_admin,
    read_session,
)
from tests.core.t01_db import assert_error, module_api_client
from tests.media.helpers import png_bytes, upload

ROUTERS = (
    ("auth", __import__("app.modules.auth.router", fromlist=["router"]).router),
    ("media", media_router),
    ("posts", posts_router),
    ("tags", tags_router),
)

ADMIN_MEDIA = "/api/v1/admin/media"


def test_session_endpoint_creates_prelogin_session_with_csrf(t01_settings, t01_session):
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        payload = read_session(client)
        assert payload["authenticated"] is False
        assert payload["user"] is None
        assert payload["prelogin"] is True
        assert len(payload["csrf_token"]) == 64
        # 预登录会话必须落到 Cookie，且是开发环境的名字（非 __Host-）。
        assert client.cookies.get(DEV_COOKIE_NAME)
        assert "no-store" in client.get("/api/v1/auth/session").headers["cache-control"]


def test_prelogin_session_has_no_admin_rights(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        # 预登录会话 + 正确 CSRF 也不能上传：user_id 为 NULL 在 require_admin 被拒。
        response = upload(client, png_bytes(), csrf_token=prelogin["csrf_token"])
        assert_error(response, status=401, code="UNAUTHORIZED")
        # 也不能读管理端点
        assert client.get("/api/v1/posts").status_code == 200  # 公开读取仍可用


def test_login_success_rotates_session_and_csrf(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        old_cookie = client.cookies.get(DEV_COOKIE_NAME)
        payload = login_ok(client)
        assert payload["authenticated"] is True
        assert payload["user"]["username"] == DEFAULT_USERNAME
        assert payload["prelogin"] is False
        assert payload["csrf_token"] != prelogin["csrf_token"], "登录必须轮换 CSRF token"
        assert client.cookies.get(DEV_COOKIE_NAME) != old_cookie, "登录必须轮换会话标识"

        # 旧的预登录会话已注销：拿它上传必须 401（不是「继续有效」）。
        client.cookies.set(DEV_COOKIE_NAME, old_cookie)
        rotated = upload(client, png_bytes(), csrf_token=prelogin["csrf_token"])
        assert_error(rotated, status=401, code="UNAUTHORIZED")


def test_admin_upload_succeeds_after_login(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        payload = login_ok(client)
        response = upload(client, png_bytes(800, 600), csrf_token=payload["csrf_token"])
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "ready"
        assert body["mime_type"] == "image/png"
        assert body["width"] == 800 and body["height"] == 600
        names = {variant["name"] for variant in body["variants"]}
        assert names == {"original", "w320.webp", "w640.webp"}
        # 管理响应里不能出现 storage_key / 绝对路径
        assert "storage_key" not in body
        assert "/Users" not in response.text


def test_cross_site_login_and_upload_are_rejected(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        # 跨站登录：Origin 不受信任 → 403（CSRF/Origin 校验先于凭据校验）
        cross_login = login(
            client, csrf_token=prelogin["csrf_token"], origin="https://evil.example.net"
        )
        assert_error(cross_login, status=403, code="FORBIDDEN")

        # 缺少 Origin 的状态变更请求同样拒绝（只靠 SameSite 不算防护）
        no_origin = client.post(
            "/api/v1/auth/login",
            json={"username": DEFAULT_USERNAME, "password": DEFAULT_PASSWORD},
        )
        assert_error(no_origin, status=403, code="FORBIDDEN")

        # 正常登录后，跨站上传与跨站注销都要拒绝
        payload = login_ok(client)
        cross_upload = upload(
            client,
            png_bytes(),
            csrf_token=payload["csrf_token"],
            origin="https://evil.example.net",
        )
        assert_error(cross_upload, status=403, code="FORBIDDEN")
        assert_error(
            logout(client, payload["csrf_token"], origin="https://evil.example.net"),
            status=403,
            code="FORBIDDEN",
        )


def test_missing_or_wrong_csrf_token_is_rejected(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        read_session(client)
        missing = client.post(
            "/api/v1/auth/login",
            json={"username": DEFAULT_USERNAME, "password": DEFAULT_PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert_error(missing, status=403, code="FORBIDDEN")

        wrong = login(client, csrf_token="0" * 64)
        assert_error(wrong, status=403, code="FORBIDDEN")


def test_wrong_password_is_401_and_recorded_in_audit(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        response = login(client, password="definitely-wrong-password", csrf_token=prelogin["csrf_token"])
        assert_error(response, status=401, code="UNAUTHORIZED")

        from sqlalchemy import select

        from app.modules.auth.models import AuditEvent

        events = list(
            t01_session.execute(
                select(AuditEvent).where(AuditEvent.action == AUDIT_LOGIN_FAILED)
            ).scalars()
        )
        assert events, "登录失败必须留下审计事件"
        # 审计里不能出现密码或 token。
        for event in events:
            serialized = str(event.extra)
            assert "definitely-wrong-password" not in serialized


def test_disabled_account_cannot_login(t01_settings, t01_session):
    make_admin(t01_session, username="disabled-owner", disabled=True)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        response = login(
            client, username="disabled-owner", csrf_token=prelogin["csrf_token"]
        )
        assert_error(response, status=403, code="FORBIDDEN")


def test_disabled_account_invalidates_existing_session(t01_settings, t01_session):
    admin = make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        payload = login_ok(client)
        assert upload(client, png_bytes(), csrf_token=payload["csrf_token"]).status_code == 201
        admin.disabled = True
        t01_session.commit()
        response = upload(client, png_bytes(), csrf_token=payload["csrf_token"])
        assert_error(response, status=401, code="UNAUTHORIZED")


def test_logout_revokes_session_and_clears_cookie(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        payload = login_ok(client)
        session_cookie = client.cookies.get(DEV_COOKIE_NAME)

        response = logout(client, payload["csrf_token"])
        assert response.status_code == 204, response.text
        assert response.content == b""
        assert not client.cookies.get(DEV_COOKIE_NAME), "注销必须清掉 Cookie"

        # 注销后复用旧 Cookie：一律 401
        client.cookies.set(DEV_COOKIE_NAME, session_cookie)
        reuse = upload(client, png_bytes(), csrf_token=payload["csrf_token"])
        assert_error(reuse, status=401, code="UNAUTHORIZED")
        # 注销后 GET /auth/session 只会重新建立预登录会话，不恢复站主身份。
        assert read_session(client)["authenticated"] is False


def test_logout_without_session_is_idempotent(t01_settings, t01_session):
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        response = client.post(
            "/api/v1/auth/logout", json={}, headers=csrf_headers("whatever")
        )
        assert response.status_code == 204, response.text


def test_login_rate_limit_returns_429_with_retry_after(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        csrf = prelogin["csrf_token"]
        limit = t01_settings.login_rate_limit_per_minute
        for _ in range(limit):
            response = login(client, password="wrong-password-here", csrf_token=csrf)
            assert response.status_code == 401, response.text

        blocked = login(client, password=DEFAULT_PASSWORD, csrf_token=csrf)
        assert_error(blocked, status=429, code="RATE_LIMITED")
        assert int(blocked.headers["Retry-After"]) >= 1


def test_successful_login_resets_failure_bucket(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        prelogin = read_session(client)
        csrf = prelogin["csrf_token"]
        for _ in range(t01_settings.login_rate_limit_per_minute - 1):
            login(client, password="wrong-password-here", csrf_token=csrf)
        success = login(client, csrf_token=csrf)
        assert success.status_code == 200, success.text
        # 登录成功轮换了 CSRF token，因此下一次失败尝试必须用新 token。
        new_csrf = success.json()["csrf_token"]
        assert new_csrf != csrf
        # 成功登录清空桶：随后重新开始计数，不会被自己的成功登录拖住。
        assert login(client, password="wrong-password-here", csrf_token=new_csrf).status_code == 401


def test_session_expiry_idle_and_revocation(t01_session, t01_settings):
    """会话生命周期（服务层，注入 now）：空闲 30 分钟、最长 8 小时、注销、禁用。"""
    admin = make_admin(t01_session, username="expiry-owner")
    start = utcnow()
    row, token = auth_service.create_session(
        t01_session, settings=t01_settings, user=admin, now=start
    )

    assert auth_service.load_session(t01_session, token, settings=t01_settings, now=start + timedelta(minutes=5))
    assert auth_service.load_session(
        t01_session, token, settings=t01_settings, now=start + timedelta(minutes=30)
    ) is None, "空闲超过 30 分钟必须失效"

    # 刷新 last_seen_at 后仍然有效（并且节流：间隔小于 60 秒不写库）。
    auth_service.touch_session(t01_session, row, now=start + timedelta(minutes=20))
    assert row.last_seen_at == start + timedelta(minutes=20)
    auth_service.touch_session(t01_session, row, now=start + timedelta(minutes=20, seconds=30))
    assert row.last_seen_at == start + timedelta(minutes=20), "60 秒内的重复请求不应写库"

    assert auth_service.load_session(
        t01_session, token, settings=t01_settings, now=start + timedelta(minutes=49)
    ), "空闲未超时、绝对未到期 → 仍有效"
    assert auth_service.load_session(
        t01_session, token, settings=t01_settings, now=start + timedelta(hours=8)
    ) is None, "绝对有效期 8 小时必须失效"

    # 注销
    auth_service.revoke_session(t01_session, row)
    assert auth_service.load_session(t01_session, token, settings=t01_settings) is None


def test_prelogin_session_expires_after_ten_minutes(t01_session, t01_settings):
    start = utcnow()
    row, token = auth_service.create_session(t01_session, settings=t01_settings, now=start)
    assert row.user_id is None, "预登录会话不允许绑定用户"
    assert auth_service.load_session(
        t01_session, token, settings=t01_settings, now=start + timedelta(minutes=9)
    )
    assert auth_service.load_session(
        t01_session, token, settings=t01_settings, now=start + timedelta(minutes=10)
    ) is None


def test_session_token_is_stored_hashed(t01_session, t01_settings):
    admin = make_admin(t01_session, username="hash-owner")
    row, token = auth_service.create_session(t01_session, settings=t01_settings, user=admin)
    assert row.token_hash != token
    assert row.token_hash == auth_service.hash_session_token(token)
    assert len(row.token_hash) == 64
    # CSRF token 也不是库里的 secret 原文
    assert row.csrf_secret not in {None, ""}
    assert auth_service.csrf_token_for(row.csrf_secret) != row.csrf_secret
