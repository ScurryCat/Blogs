"""`GET /auth/owner-status`：无副作用探针（P5 契约 §9.1）。

要求：
  - 读会话但**不创建预登录会话、不写库**（匿名调用后 admin session 行数不增加）；
  - 匿名返回 `{"authenticated": false, "user": null}`（200）；
  - 已登录返回最小身份信息；
  - 响应 `private, no-store`；
  - 与 `GET /auth/session` 的差别正是「不写库」：后者会给匿名访客建预登录会话。
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.core.cookies import DEV_COOKIE_NAME
from app.modules.auth import service as auth_service
from app.modules.auth.models import AdminSession
from app.modules.auth.router import router as auth_router
from tests.auth.helpers import (
    DEFAULT_PASSWORD,
    DEFAULT_USERNAME,
    login_ok,
    logout,
    make_admin,
    read_session,
)
from tests.core.t01_db import module_api_client

OWNER_STATUS = "/api/v1/auth/owner-status"


def _session_count(session) -> int:
    return session.execute(select(func.count()).select_from(AdminSession)).scalar_one()


def test_anonymous_owner_status_is_false_and_creates_no_session(
    t01_settings, t01_session
):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, ("auth", auth_router)) as client:
        before = _session_count(t01_session)
        for _ in range(3):
            response = client.get(OWNER_STATUS)
            assert response.status_code == 200, response.text
            payload = response.json()
            assert payload == {"authenticated": False, "user": None}
            assert response.headers["Cache-Control"] == "private, no-store"
        assert _session_count(t01_session) == before, (
            "owner-status 不得创建预登录会话（匿名访客调用不能产生 DB 行）"
        )
        assert client.cookies.get(DEV_COOKIE_NAME) is None, "探针不得回写会话 Cookie"


def test_owner_status_with_prelogin_session_is_false_and_writes_nothing(
    t01_settings, t01_session
):
    with module_api_client(t01_settings, t01_session, ("auth", auth_router)) as client:
        read_session(client)  # 显式建立预登录会话（其他管理页面的行为）
        before = _session_count(t01_session)
        response = client.get(OWNER_STATUS)
        assert response.status_code == 200, response.text
        assert response.json() == {"authenticated": False, "user": None}
        assert _session_count(t01_session) == before


def test_owner_status_reports_logged_in_owner(t01_settings, t01_session):
    user = make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, ("auth", auth_router)) as client:
        login_ok(client, username=DEFAULT_USERNAME, password=DEFAULT_PASSWORD)
        before = _session_count(t01_session)
        response = client.get(OWNER_STATUS)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["authenticated"] is True
        assert payload["user"] == {"id": str(user.id), "username": user.username}
        assert set(payload) == {"authenticated", "user"}, "探针只返回最小身份信息"
        assert _session_count(t01_session) == before, "读取状态不得轮换 / 新建会话"


def test_owner_status_does_not_touch_last_seen_at(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, ("auth", auth_router)) as client:
        login_ok(client)
        raw_token = client.cookies.get(DEV_COOKIE_NAME)
        row = auth_service.load_session(t01_session, raw_token, settings=t01_settings)
        assert row is not None
        last_seen_before = row.last_seen_at

        assert client.get(OWNER_STATUS).status_code == 200

        t01_session.expire_all()
        refreshed = auth_service.load_session(
            t01_session, raw_token, settings=t01_settings
        )
        assert refreshed is not None
        assert refreshed.last_seen_at == last_seen_before, (
            "owner-status 是只读探针：不 touch last_seen_at（管理读接口才做）"
        )


def test_owner_status_after_logout_is_false(t01_settings, t01_session):
    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, ("auth", auth_router)) as client:
        payload = login_ok(client)
        assert logout(client, payload["csrf_token"]).status_code == 204
        response = client.get(OWNER_STATUS)
        assert response.status_code == 200, response.text
        assert response.json() == {"authenticated": False, "user": None}
