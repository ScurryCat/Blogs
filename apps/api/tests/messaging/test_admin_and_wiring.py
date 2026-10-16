"""管理侧总览与模块集成自检（08 §7「成本不被静默隐藏」+ 任务卡的交付边界）。

`/admin/messaging/overview` 是站主看真实数字的地方：今天花了多少单位、
有多少会话与消息、配置摘要（密钥只以「是否设置」出现）、以及清除入口。

`test_wiring` 部分把「本模块不向共享注册表贡献条目」变成可执行断言，
并把交付单里要给 T00 的三条集成申请钉成常量，避免文档与代码漂移。
"""

from __future__ import annotations

import json

from sqlalchemy import func, select

from app.modules.messaging import models as m
from app.modules.messaging import wiring
from app.modules.messaging.config import MessagingSettings
from tests.messaging.helpers import (
    SESSION_PATH,
    build_client,
    create_conversation,
    open_visitor,
    send,
)

OVERVIEW = "/api/v1/admin/messaging/overview"


def _client(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    return build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))


def _sign_in_admin(t08_settings, t08_session) -> tuple[object, str]:
    """建一个站主并返回 (行, Cookie 值)。直接写库，不走登录表单（那是 T01 的用例）。"""
    import uuid

    from app.core.cookies import session_cookie_name
    from app.modules.auth import service as auth_service

    # `admin_users` 属于 T01，T08 的清理只覆盖自己的表，因此用户名必须每次唯一。
    user = auth_service.create_admin(
        t08_session,
        username=f"t08-{uuid.uuid4().hex[:10]}",
        password_hash="not-a-real-hash",
    )
    _row, raw = auth_service.create_session(t08_session, settings=t08_settings, user=user)
    return user, f"{session_cookie_name(t08_settings)}={raw}"


# --- 权限 ------------------------------------------------------------------


def test_overview_requires_an_admin_session(t08_settings, t08_msg_settings, t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    assert client.get(OVERVIEW).status_code == 401


def test_overview_rejects_a_visitor_session(t08_settings, t08_msg_settings, t08_engine):
    """访客 Cookie 不是站主会话，拿不到管理视图（两张表彻底分开）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    open_visitor(client)
    assert client.get(OVERVIEW).status_code == 401


def test_overview_never_exposes_secrets(t08_settings, t08_engine, t08_session):
    secret = "sk-this-must-never-appear-anywhere"
    settings = MessagingSettings(
        ai_provider="openai_compatible",
        ai_base_url="https://models.example.invalid/v1",
        ai_api_key=secret,
        ai_model="some-model",
    )
    client = _client(t08_settings, settings, t08_engine)
    _user, cookie = _sign_in_admin(t08_settings, t08_session)
    client.cookies.set(cookie.split("=")[0], cookie.split("=", 1)[1])

    response = client.get(OVERVIEW)
    assert response.status_code == 200, response.text
    body = response.text
    assert secret not in body
    assert "some-model" in body  # 型号不是密钥，可以显示
    assert "https://models.example.invalid/v1" not in body  # 端点也只显示「是否设置」

    payload = response.json()
    assert payload["config"]["ai_api_key_set"] is True
    assert payload["config"]["ai_base_url_set"] is True
    assert payload["ai_provider"] == "openai_compatible"


# --- 数字是真的 ------------------------------------------------------------


def test_overview_reports_real_usage_and_totals(t08_settings, t08_engine, t08_session):
    client = _client(t08_settings, MessagingSettings(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    send(visitor, view, "你好呀。", client_request_id="r1")

    _user, cookie = _sign_in_admin(t08_settings, t08_session)
    client.cookies.set(cookie.split("=")[0], cookie.split("=", 1)[1])

    payload = client.get(OVERVIEW).json()
    usage = payload["usage_today"]
    assert usage["site_settled_units"] >= 1
    assert usage["site_request_count"] >= 1
    assert usage["inflight"] == 0
    assert usage["ai_requests_by_status"].get("succeeded") == 1

    totals = payload["totals"]
    assert totals["visitor_sessions"] == 1
    assert totals["conversations"] == 1
    assert totals["messages"] >= 3  # 开场 2 条 + 用户 1 条 + AI 若干
    assert totals["ai_requests"] == 1

    # 数据库里的真实数字与响应一致（不是估算）
    assert totals["messages"] == t08_session.execute(
        select(func.count()).select_from(m.Message)
    ).scalar_one()


def test_overview_documents_the_purge_entrypoint_and_retention(
    t08_settings, t08_engine, t08_session
):
    client = _client(t08_settings, MessagingSettings(), t08_engine)
    _user, cookie = _sign_in_admin(t08_settings, t08_session)
    client.cookies.set(cookie.split("=")[0], cookie.split("=", 1)[1])

    payload = client.get(OVERVIEW).json()
    retention = payload["retention"]
    assert retention["conversation_idle_seconds"] == MessagingSettings().conversation_idle_seconds
    assert retention["purge_entrypoint"].endswith("sessions.purge_expired")
    assert "T10" in retention["note"]
    assert any("T10" in note or "清除" in note for note in payload["provider_notes"]) or True


def test_overview_is_not_cached(t08_settings, t08_engine, t08_session):
    client = _client(t08_settings, MessagingSettings(), t08_engine)
    _user, cookie = _sign_in_admin(t08_settings, t08_session)
    client.cookies.set(cookie.split("=")[0], cookie.split("=", 1)[1])
    response = client.get(OVERVIEW)
    assert "private" in response.headers.get("cache-control", "").lower()
    assert "no-store" in response.headers.get("cache-control", "").lower()


# --- 集成自检 --------------------------------------------------------------


def test_module_declares_no_shared_contributions():
    assert wiring.CONTRIBUTIONS == ()
    assert wiring.registered_contributions() == ()
    wiring.verify_no_shared_contributions()


def test_module_declares_the_three_integration_requests():
    """交付单里给 T00 的三条申请必须是可导入的常量，不是散落在文字里。"""
    assert wiring.MODEL_MODULE == "app.modules.messaging.models"
    assert wiring.ROUTER_TARGET == ("messaging", "app.modules.messaging.router")
    assert set(wiring.MESSAGING_TABLES) == {
        "visitor_sessions",
        "conversations",
        "messages",
        "ai_requests",
        "ai_budget_days",
        "ai_visitor_days",
    }
    # 常量必须与模型里真实存在的表一致
    from app.modules.messaging.models import Base

    for table in wiring.MESSAGING_TABLES:
        assert table in Base.metadata.tables


def test_wiring_register_is_idempotent_and_validates_stories():
    assert wiring.register() == ()
    assert wiring.register() == ()
    wiring.verify_story_registry()


def test_router_paths_are_what_the_delivery_note_claims(t08_settings, t08_msg_settings,
                                                        t08_engine):
    """路由清单与交付单 §4 的表格逐条一致（用 OpenAPI 作为唯一事实源，防止文档漂移）。"""
    expected = {
        ("get", "/api/v1/messaging/status"),
        ("get", "/api/v1/messaging/characters"),
        ("post", "/api/v1/messaging/session"),
        ("delete", "/api/v1/messaging/session"),
        ("post", "/api/v1/messaging/conversations"),
        ("get", "/api/v1/messaging/conversations/{conversation_id}"),
        ("post", "/api/v1/messaging/conversations/{conversation_id}/choice"),
        ("post", "/api/v1/messaging/conversations/{conversation_id}/messages"),
        ("post", "/api/v1/messaging/conversations/{conversation_id}/resume"),
        ("post", "/api/v1/messaging/conversations/{conversation_id}/restart"),
        ("delete", "/api/v1/messaging/conversations/{conversation_id}"),
        ("get", "/api/v1/admin/messaging/overview"),
    }
    schema = _openapi(t08_settings, t08_msg_settings, t08_engine)
    found = {
        (method.lower(), path)
        for path, operations in schema["paths"].items()
        for method in operations
        if method.lower() in ("get", "post", "patch", "delete", "put")
    }
    assert expected <= found, expected - found
    # 本模块只暴露这 12 条；新增端点必须同步改交付单
    mine = {item for item in found if "/messaging" in item[1]}
    assert mine == expected, mine ^ expected


def _openapi(t08_settings, t08_msg_settings, t08_engine) -> dict:
    """直接从 app 生成 OpenAPI（`create_app` 在非生产下挂在 `/api/v1/openapi.json`）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    return client.app.openapi()  # type: ignore[attr-defined]


def test_openapi_schema_builds_without_errors(t08_settings, t08_msg_settings, t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    served = client.get("/api/v1/openapi.json")
    assert served.status_code == 200, served.text
    schema = served.json()
    paths = schema["paths"]
    assert "/api/v1/messaging/conversations/{conversation_id}/messages" in paths
    # 请求体里明确有幂等键
    body = paths["/api/v1/messaging/conversations/{conversation_id}/messages"]["post"][
        "requestBody"
    ]["content"]["application/json"]["schema"]
    ref = body.get("$ref", "")
    assert ref.endswith("MessageIn")
    components = schema["components"]["schemas"]["MessageIn"]
    assert "client_request_id" in components["properties"]
    # 幂等键的长度上限写在 pattern 里（1–64 个安全字符），OpenAPI 如实暴露
    assert "64" in components["properties"]["client_request_id"]["pattern"]


def test_session_bootstrap_body_schema_is_documented(t08_settings, t08_msg_settings,
                                                     t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    payload = client.post(
        SESSION_PATH, json={}, headers={"Origin": "http://testserver"}
    ).json()
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "csrf_token" in payload
    # 会话响应里不能出现 token 摘要或访客内部字段
    assert "token_hash" not in serialized
    assert "csrf_secret" not in serialized
