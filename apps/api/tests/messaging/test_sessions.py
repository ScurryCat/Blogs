"""访客会话的生命周期、Cookie 属性、清除与保留期（08 §7）。

这里的断言分两类，都很容易被写成「看起来对」：

  1. **Cookie 属性与凭证存放**：HttpOnly、SameSite=Lax、生产/开发不同名，
     库里只有摘要（读走整张表也不能冒充访客）。
  2. **清除与过期真的删正文**，而不是把行标一下或者只让接口 404。
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select, text

from app.core.db import utcnow
from app.modules.messaging import models as m
from app.modules.messaging import sessions
from app.modules.messaging.config import MessagingSettings
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    SESSION_PATH,
    build_client,
    create_conversation,
    open_visitor,
    post,
    send,
    texts,
)


def _client(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    return build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))


def test_session_cookie_is_httponly_lax_and_dev_named(t08_settings, t08_msg_settings, t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    response = client.post(SESSION_PATH, headers={"Origin": "http://testserver"}, json={})
    assert response.status_code == 200

    header = response.headers.get("set-cookie", "")
    lowered = header.lower()
    assert lowered.startswith(f"{sessions.DEV_VISITOR_COOKIE}=")
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "path=/" in lowered
    # 开发（非 HTTPS）不发 Secure；生产必须发（见下一个用例）
    assert "secure" not in lowered
    # 开发 Cookie 名与站主会话名必须不同
    assert sessions.DEV_VISITOR_COOKIE != "pl_session_dev"
    assert sessions.PROD_VISITOR_COOKIE != "__Host-pl_session"


def test_production_cookie_uses_the_host_prefix(t08_msg_settings, t08_engine, t08_database_url):
    from app.core.config import Settings

    # 只验证 `is_production` 分支的 Cookie 属性；这里不发任何真实请求到外部。
    prod_like = Settings(
        app_env="prod",
        database_url=t08_database_url,
        secret_key="t08-production-shaped-secret-key-0123456789abcdef",
        app_version="0.0.0-t08",
    )
    client = _client(prod_like, t08_msg_settings, t08_engine)
    response = client.post(
        SESSION_PATH, headers={"Origin": "http://testserver"}, json={}
    )
    header = response.headers.get("set-cookie", "")
    assert header.startswith(f"{sessions.PROD_VISITOR_COOKIE}=")
    lowered = header.lower()
    assert "secure" in lowered and "httponly" in lowered and "samesite=lax" in lowered
    assert "domain=" not in lowered  # __Host- 前缀要求


def test_database_stores_only_the_token_digest(t08_settings, t08_msg_settings, t08_engine,
                                               t08_session):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    raw_cookie = visitor.client.cookies.get(sessions.DEV_VISITOR_COOKIE)
    assert raw_cookie

    stored = t08_session.execute(select(m.VisitorSession.token_hash)).scalars().all()
    assert stored == [sessions.token_digest(raw_cookie)]
    assert raw_cookie not in stored
    # 整张表里找不到原始 token
    dump = t08_session.execute(
        text("select token_hash || csrf_secret from visitor_sessions")
    ).scalars().all()
    assert all(raw_cookie not in row for row in dump)


def test_bootstrap_is_idempotent_and_returns_a_fresh_view(t08_settings, t08_msg_settings,
                                                          t08_engine, t08_session):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    first = open_visitor(client)
    second = open_visitor(client)

    assert first.visitor_id == second.visitor_id
    assert first.csrf_token == second.csrf_token
    assert (
        t08_session.execute(select(func.count()).select_from(m.VisitorSession)).scalar_one() == 1
    )


def test_bootstrap_reports_characters_and_disclosure(t08_settings, t08_msg_settings, t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    payload = client.post(
        SESSION_PATH, headers={"Origin": "http://testserver"}, json={}
    ).json()

    assert [item["id"] for item in payload["characters"]] == ["futaba", "morgana"]
    assert all(item["conversation"] is None for item in payload["characters"])
    # 隐私说明必须区分本站与模型供应商（08 §7）
    assert "模型供应商" in payload["disclosure"]
    assert "24 小时" in payload["disclosure"]
    assert payload["ai"]["provider"] == "simulator"


def test_bootstrap_requires_a_verifiable_origin(t08_settings, t08_msg_settings, t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    blocked = client.post(SESSION_PATH, json={})
    assert blocked.status_code == 403

    cross_site = client.post(
        SESSION_PATH, json={}, headers={"Origin": "https://evil.example.com"}
    )
    assert cross_site.status_code == 403


def test_delete_session_clears_every_conversation_and_message(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    send(visitor, view, "一句要一起被删掉的话。", client_request_id="r1")

    response = visitor.client.request(
        "DELETE",
        SESSION_PATH,
        json={"csrf_token": visitor.csrf_token},
        headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 204

    for model in (m.Conversation, m.Message, m.AiRequest, m.VisitorSession):
        assert (
            t08_session.execute(select(func.count()).select_from(model)).scalar_one() == 0
        ), model.__name__
    # 全站预算计数**不**因为一个访客清除记录而回退（已产生的成本仍然如实保留）
    assert (
        t08_session.execute(select(func.count()).select_from(m.AiBudgetDay)).scalar_one() == 1
    )
    # Cookie 被清掉
    assert not visitor.client.cookies.get(sessions.DEV_VISITOR_COOKIE)


def test_after_deleting_the_session_a_new_bootstrap_works(
    t08_settings, t08_msg_settings, t08_engine
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    create_conversation(visitor, "futaba")
    visitor.client.request(
        "DELETE",
        SESSION_PATH,
        json={"csrf_token": visitor.csrf_token},
        headers={"Origin": "http://testserver"},
    )

    fresh = open_visitor(client)
    assert fresh.visitor_id != visitor.visitor_id
    view = create_conversation(fresh, "futaba")
    assert view["conversation"]["node_version"] == 0
    assert len(view["messages"]) == 2  # 全新的开场


def test_expired_session_cookie_is_rejected_and_a_new_one_is_issued(
    t08_settings, t08_msg_settings, t08_engine, t08_session, monkeypatch
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    # 把这一行直接改成已过期（模拟「过了 24 小时」）
    row = t08_session.get(m.VisitorSession, visitor.visitor_id)
    row.expires_at = utcnow() - timedelta(seconds=1)
    t08_session.commit()

    stale = client.get(f"{CONVERSATIONS_PATH}/{view['conversation']['id']}")
    assert stale.status_code == 401

    fresh = open_visitor(client)
    assert fresh.visitor_id != visitor.visitor_id


def test_purge_expired_removes_sessions_and_conversations(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    create_conversation(visitor, "futaba")

    row = t08_session.get(m.VisitorSession, visitor.visitor_id)
    row.expires_at = utcnow() - timedelta(seconds=1)
    t08_session.commit()

    removed = sessions.purge_expired(t08_session, now=utcnow())
    t08_session.commit()
    assert removed["visitor_sessions"] == 1
    assert (
        t08_session.execute(select(func.count()).select_from(m.Conversation)).scalar_one() == 0
    )
    assert t08_session.execute(select(func.count()).select_from(m.Message)).scalar_one() == 0


def test_touch_never_exceeds_the_absolute_cap(t08_settings, t08_msg_settings, t08_engine,
                                              t08_session):
    visitor_row, _raw = sessions.create_session(
        t08_session, settings=t08_msg_settings, ip_hash=None
    )
    t08_session.commit()
    cap = visitor_row.absolute_expires_at

    sessions.touch(
        t08_session,
        visitor_row,
        settings=MessagingSettings(visitor_session_idle_seconds=999_999),
        now=utcnow(),
    )
    assert visitor_row.expires_at == cap


def test_logout_via_session_delete_does_not_touch_admin_sessions(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    """访客清除自己的记录时，站主会话一行都不受影响（两张表彻底分开）。"""
    import uuid

    from app.modules.auth import service as auth_service
    from app.modules.auth.models import AdminSession, AdminUser

    # `admin_users` 属 T01，T08 的清理只覆盖自己的表 → 用户名每次唯一
    user = auth_service.create_admin(
        t08_session,
        username=f"t08-owner-{uuid.uuid4().hex[:8]}",
        password_hash="not-a-real-hash",
    )
    _admin_session, _token = auth_service.create_session(
        t08_session, settings=t08_settings, user=user
    )
    before = t08_session.execute(select(func.count()).select_from(AdminSession)).scalar_one()

    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    create_conversation(visitor, "futaba")
    visitor.client.request(
        "DELETE",
        SESSION_PATH,
        json={"csrf_token": visitor.csrf_token},
        headers={"Origin": "http://testserver"},
    )

    # 不变式是「前后一致」：`sessions` / `admin_users` 属 T01，本用例不假设库里只有一行
    # （全量跑时别的用例也会建站主会话）。
    after = t08_session.execute(select(func.count()).select_from(AdminSession)).scalar_one()
    assert before >= 1
    assert after == before
    assert (
        t08_session.execute(
            select(func.count()).select_from(AdminUser).where(AdminUser.id == user.id)
        ).scalar_one()
        == 1
    )


def test_conversation_read_refreshes_the_session(t08_settings, t08_msg_settings, t08_engine,
                                                 t08_session):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    row = t08_session.get(m.VisitorSession, visitor.visitor_id)
    before = row.last_seen_at

    client.get(f"{CONVERSATIONS_PATH}/{view['conversation']['id']}")
    t08_session.expire_all()
    row = t08_session.get(m.VisitorSession, visitor.visitor_id)
    assert row.last_seen_at >= before


def test_message_text_length_is_enforced_at_the_http_layer(t08_settings, t08_engine):
    settings = MessagingSettings(input_max_codepoints=20)
    client = _client(t08_settings, settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    too_long = post(
        client,
        f"{CONVERSATIONS_PATH}/{view['conversation']['id']}/messages",
        {"text": "字" * 21, "client_request_id": "r1"},
        csrf_token=visitor.csrf_token,
    )
    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "VALIDATION_FAILED"

    blank = post(
        client,
        f"{CONVERSATIONS_PATH}/{view['conversation']['id']}/messages",
        {"text": "   ", "client_request_id": "r2"},
        csrf_token=visitor.csrf_token,
    )
    assert blank.status_code == 422

    ok = send(visitor, view, "字" * 20, client_request_id="r3")
    assert ok.status_code == 200, ok.text
    assert "字" * 20 in texts(ok.json())
