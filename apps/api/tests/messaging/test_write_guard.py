"""访客写操作的来源与 CSRF 闸门（08 §7）。

这里逐条覆盖 `guards.py` 的每个分支 —— 包括那条**刻意偏离** T01
`verify_write_request` 的分支（`Origin` 缺失但 Fetch Metadata 证明同源），
因为它对应一个真实的集成形态（浏览器 → Next rewrite → API，见 T03 交付单 §8 第 1 条）。
"""

from __future__ import annotations

import asyncio

import pytest
from starlette.requests import Request

from app.core.errors import ApiError
from app.modules.messaging.guards import (
    verify_visitor_origin,
    verify_visitor_write,
)
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    SESSION_PATH,
    build_client,
    create_conversation,
    open_visitor,
)

OK_ORIGIN = "http://testserver"


def _json_request(payload: dict, headers: dict[str, str]) -> Request:
    """带 JSON body 的请求（用来验证 body 里的 csrf_token 也走同一条校验）。"""
    import json

    body = json.dumps(payload).encode("utf-8")
    raw = [(key.lower().encode("latin-1"), value.encode("latin-1")) for key, value in headers.items()]
    raw.append((b"host", b"testserver"))
    raw.append((b"content-type", b"application/json"))
    raw.append((b"content-length", str(len(body)).encode()))
    delivered = False

    async def receive() -> dict:
        nonlocal delivered
        if delivered:  # pragma: no cover - 只读一次 body
            return {"type": "http.disconnect"}
        delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/v1/messaging/session",
            "raw_path": b"/api/v1/messaging/session",
            "query_string": b"",
            "headers": raw,
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
        },
        receive,
    )


def _request(headers: dict[str, str], *, method: str = "POST") -> Request:
    """直接从 ASGI scope 构造一个真实的 `Request`（不经过 app，测试的是闸门本身）。"""
    raw = [(key.lower().encode("latin-1"), value.encode("latin-1")) for key, value in headers.items()]
    raw.append((b"host", b"testserver"))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": "/api/v1/messaging/session",
            "raw_path": b"/api/v1/messaging/session",
            "query_string": b"",
            "headers": raw,
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
        }
    )


# --- 来源校验 --------------------------------------------------------------


def test_origin_matching_host_passes(t08_settings):
    verify_visitor_origin(_request({"origin": OK_ORIGIN}), t08_settings)  # 不抛错即通过


def test_whitelisted_origin_passes(t08_settings):
    verify_visitor_origin(_request({"origin": "http://127.0.0.1:3100"}), t08_settings)


def test_cross_site_origin_is_rejected(t08_settings):
    with pytest.raises(ApiError) as error:
        verify_visitor_origin(_request({"origin": "https://evil.example.com"}), t08_settings)
    assert error.value.status_code == 403


def test_missing_origin_with_same_origin_fetch_metadata_passes(t08_settings):
    """真实形态：Next rewrite 转发后 `Origin` 为空，但浏览器标了 `Sec-Fetch-Site`。"""
    verify_visitor_origin(
        _request({"sec-fetch-site": "same-origin", "sec-fetch-mode": "cors"}), t08_settings
    )


def test_missing_origin_with_cross_site_fetch_metadata_is_rejected(t08_settings):
    with pytest.raises(ApiError) as error:
        verify_visitor_origin(
            _request({"sec-fetch-site": "cross-site", "sec-fetch-mode": "cors"}), t08_settings
        )
    assert error.value.status_code == 403


def test_missing_everything_is_rejected(t08_settings):
    """既没有 Origin 也没有 Fetch Metadata（脚本客户端）→ 拒绝，不放行。"""
    with pytest.raises(ApiError) as error:
        verify_visitor_origin(_request({}), t08_settings)
    assert error.value.status_code == 403


def test_fetch_metadata_none_and_unknown_modes_are_rejected(t08_settings):
    for headers in (
        {"sec-fetch-site": "none", "sec-fetch-mode": "navigate"},
        {"sec-fetch-site": "same-origin", "sec-fetch-mode": "no-cors"},
        {"sec-fetch-site": "same-origin"},
        {"sec-fetch-mode": "cors"},
    ):
        with pytest.raises(ApiError):
            verify_visitor_origin(_request(headers), t08_settings)


def test_write_gate_requires_a_matching_csrf_token(t08_settings):
    from app.core.csrf import CSRF_HEADER

    async def scenario() -> None:
        with pytest.raises(ApiError):
            await verify_visitor_write(
                _request({"origin": OK_ORIGIN}), t08_settings, expected_token="expected"
            )
        await verify_visitor_write(
            _request({"origin": OK_ORIGIN, CSRF_HEADER: "expected"}),
            t08_settings,
            expected_token="expected",
        )
        # body 里的 csrf_token 同样被接受（共享客户端没有 headers 选项，
        # 与 T03 的 withCsrf 是同一个形态）
        await verify_visitor_write(
            _json_request(
                {"csrf_token": "expected"}, {"origin": OK_ORIGIN}
            ),
            t08_settings,
            expected_token="expected",
        )
        with pytest.raises(ApiError):
            await verify_visitor_write(
                _json_request({"csrf_token": "nope"}, {"origin": OK_ORIGIN}),
                t08_settings,
                expected_token="expected",
            )

    asyncio.run(scenario())


# --- HTTP 层 ---------------------------------------------------------------


def test_missing_csrf_token_is_403_on_every_write(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    conversation_id = view["conversation"]["id"]

    writes = [
        ("POST", CONVERSATIONS_PATH, {"character_id": "futaba"}),
        (
            "POST",
            f"{CONVERSATIONS_PATH}/{conversation_id}/choice",
            {
                "choice_id": "talk-acm",
                "node_id": view["conversation"]["node_id"],
                "node_version": 0,
                "client_message_id": "c1",
            },
        ),
        (
            "POST",
            f"{CONVERSATIONS_PATH}/{conversation_id}/messages",
            {"text": "你好", "client_request_id": "r1"},
        ),
        ("POST", f"{CONVERSATIONS_PATH}/{conversation_id}/resume", {"node_version": 0}),
        ("POST", f"{CONVERSATIONS_PATH}/{conversation_id}/restart", {"node_version": 0}),
        ("DELETE", f"{CONVERSATIONS_PATH}/{conversation_id}", None),
        ("DELETE", SESSION_PATH, None),
    ]
    for method, path, body in writes:
        response = client.request(
            method, path, json=body, headers={"Origin": OK_ORIGIN}
        )
        assert response.status_code == 403, f"{method} {path} → {response.status_code}"
        assert response.json()["error"]["code"] == "FORBIDDEN"


def test_wrong_csrf_token_is_403(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor = open_visitor(client)
    response = client.post(
        CONVERSATIONS_PATH,
        json={"character_id": "futaba", "csrf_token": "wrong-token"},
        headers={"Origin": OK_ORIGIN},
    )
    assert response.status_code == 403


def test_origin_header_alone_is_enough_for_writes(t08_settings, t08_msg_settings, t08_engine):
    """带 `Origin` 的写请求通过（这是同源浏览器的正常形态）。"""
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor = open_visitor(client)
    response = client.post(
        CONVERSATIONS_PATH,
        json={"character_id": "futaba", "csrf_token": visitor.csrf_token},
        headers={"Origin": OK_ORIGIN},
    )
    assert response.status_code == 200


def test_fetch_metadata_alone_is_enough_for_writes(t08_settings, t08_msg_settings, t08_engine):
    """没有 `Origin`、但有同源 Fetch Metadata 的写请求也通过（Next rewrite 形态）。"""
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    bootstrap = client.post(
        SESSION_PATH,
        json={},
        headers={"sec-fetch-site": "same-origin", "sec-fetch-mode": "cors"},
    )
    assert bootstrap.status_code == 200, bootstrap.text
    token = bootstrap.json()["csrf_token"]

    response = client.post(
        CONVERSATIONS_PATH,
        json={"character_id": "futaba", "csrf_token": token},
        headers={"sec-fetch-site": "same-origin", "sec-fetch-mode": "cors"},
    )
    assert response.status_code == 200, response.text


def test_reads_do_not_require_origin_or_csrf(t08_settings, t08_msg_settings, t08_engine):
    """GET 不是状态变更，不需要来源与 CSRF（但它也不会建会话）。"""
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    assert client.get("/api/v1/messaging/status").status_code == 200
    assert client.get("/api/v1/messaging/characters").status_code == 200


def test_write_headers_are_not_accepted_from_the_query_string(
    t08_settings, t08_msg_settings, t08_engine
):
    """CSRF token 不接受查询串（避免进访问日志与 Referer）。"""
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor = open_visitor(client)
    response = client.post(
        f"{CONVERSATIONS_PATH}?csrf_token={visitor.csrf_token}",
        json={"character_id": "futaba"},
        headers={"Origin": OK_ORIGIN},
    )
    assert response.status_code == 403
