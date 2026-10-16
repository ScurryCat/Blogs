"""共用能力的行为测试（05 §2 / §5 / §7 / §8）。

覆盖 T01 任务卡第 7 条要求「实现乐观锁 / 错误结构 / 事务 / 有界图片处理的共用能力」：
  - 不透明游标：往返、指纹绑定、格式错误 → 400。
  - If-Match 乐观锁：缺头 428、版本不符 412、`*` 与非法值 400。
  - CSRF：头 / JSON body / 表单三种取法、常量时间比较、Origin 同源与白名单。
  - Cookie：开发名非 Secure、生产 `__Host-` + Secure + HttpOnly + SameSite=Lax、无 Domain。
  - 有界并发：并发数不超过上限。
  - 错误信封：新加的 429 / 415 映射与 ApiError.headers 透传。

这些都是模块测试会依赖的基础件，所以先单独测它们，避免「模块测试红了但不知道是谁的问题」。
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient

from app.core import cookies
from app.core.concurrency import limiter_for, reset_limiters, run_bounded
from app.core.config import Settings
from app.core.csrf import (
    CSRF_FIELD,
    CSRF_HEADER,
    csrf_token_for,
    origin_allowed,
    tokens_match,
)
from app.core.errors import (
    CODE_RATE_LIMITED,
    CODE_UNSUPPORTED_MEDIA_TYPE,
    ApiError,
    install_error_handlers,
)
from app.core.pagination import (
    DEFAULT_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.preconditions import format_etag, parse_if_match, require_version

FIXED_TIME = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


# --- 游标分页 ---------------------------------------------------------------


def test_cursor_round_trip():
    entity_id = uuid.uuid4()
    fingerprint = filter_fingerprint({"category": "LOG", "tag": None})
    cursor = encode_cursor(sort_value=FIXED_TIME, entity_id=entity_id, fingerprint=fingerprint)
    decoded_time, decoded_id = decode_cursor(cursor, fingerprint=fingerprint)
    assert decoded_time == FIXED_TIME
    assert decoded_id == entity_id


def test_cursor_is_opaque_and_filter_bound():
    entity_id = uuid.uuid4()
    fingerprint = filter_fingerprint({"category": "LOG"})
    cursor = encode_cursor(sort_value=FIXED_TIME, entity_id=entity_id, fingerprint=fingerprint)
    assert str(entity_id) not in cursor
    assert "2026" not in cursor  # 不是明文时间戳，客户端不应解析它

    other = filter_fingerprint({"category": "TECH"})
    with pytest.raises(ApiError) as excinfo:
        decode_cursor(cursor, fingerprint=other)
    assert excinfo.value.status_code == 400
    assert excinfo.value.code == "VALIDATION_FAILED"


@pytest.mark.parametrize("bad", ["", "not-base64!!", "eyJ2IjoyfQ", "e30"])
def test_malformed_cursor_is_400(bad):
    with pytest.raises(ApiError) as excinfo:
        decode_cursor(bad, fingerprint=filter_fingerprint({}))
    assert excinfo.value.status_code == 400


def test_filter_fingerprint_ignores_none_vs_empty():
    assert filter_fingerprint({"category": None}) == filter_fingerprint({"category": ""})
    assert filter_fingerprint({"category": "LOG"}) != filter_fingerprint({"category": "log "})


def test_default_limit_constant_matches_contract():
    assert DEFAULT_LIMIT == 12


# --- 乐观锁 -----------------------------------------------------------------


def test_if_match_requires_header():
    with pytest.raises(ApiError) as excinfo:
        parse_if_match(None)
    assert excinfo.value.status_code == 428
    assert excinfo.value.code == "PRECONDITION_REQUIRED"


def test_if_match_version_conflict():
    with pytest.raises(ApiError) as excinfo:
        require_version(3, '"2"')
    assert excinfo.value.status_code == 412
    assert excinfo.value.code == "VERSION_CONFLICT"


def test_if_match_accepts_quoted_and_weak_and_passes():
    assert parse_if_match('"7"') == 7
    assert parse_if_match("7") == 7
    assert parse_if_match('W/"7"') == 7
    assert require_version(7, '"7"') is None


@pytest.mark.parametrize("bad", ["*", '"abc"', '"0"', '"-1"'])
def test_if_match_rejects_wildcard_and_garbage(bad):
    with pytest.raises(ApiError) as excinfo:
        parse_if_match(bad)
    assert excinfo.value.status_code == 400


def test_etag_format():
    assert format_etag(3) == '"3"'


# --- CSRF / Origin ----------------------------------------------------------


def _settings(**overrides) -> Settings:
    base = dict(
        app_env="test",
        database_url="postgresql+psycopg://pl@127.0.0.1:55432/pl_test",
        secret_key="t01-core-test-secret-key-0123456789abcdef",
        cors_origins=overrides.pop("cors_origins", ""),
    )
    base.update(overrides)
    return Settings(**base)


def test_csrf_token_is_derived_not_stored_value():
    secret = "session-secret-value"
    token = csrf_token_for(secret)
    assert token != secret
    assert token == csrf_token_for(secret)
    assert len(token) == 64
    assert tokens_match(token, token) and not tokens_match(token, secret)
    assert not tokens_match(None, token) and not tokens_match(token, None)


def test_origin_allowed_same_origin_and_allowlist():
    app = FastAPI()

    @app.get("/probe")
    def probe(request: Request) -> dict[str, object]:
        settings = _settings(cors_origins="https://blog.example.com")
        return {
            "same_origin": origin_allowed("http://testserver", request, settings),
            "allowlisted": origin_allowed("https://blog.example.com", request, settings),
            "evil": origin_allowed("https://evil.example.net", request, settings),
            "garbage": origin_allowed("not-a-url", request, settings),
        }

    with TestClient(app) as client:
        payload = client.get("/probe").json()
    assert payload == {
        "same_origin": True,
        "allowlisted": True,
        "evil": False,
        "garbage": False,
    }


def _csrf_probe_app() -> FastAPI:
    from app.core.csrf import csrf_token_from_request

    app = FastAPI()
    install_error_handlers(app)
    expected = "expected-token"

    @app.post("/json")
    async def json_body(request: Request) -> dict[str, object]:
        token = await csrf_token_from_request(request)
        return {"token": token, "match": tokens_match(token, expected)}

    @app.post("/form")
    async def form_body(request: Request) -> dict[str, object]:
        token = await csrf_token_from_request(request)
        return {"token": token, "match": tokens_match(token, expected)}

    @app.post("/none")
    async def none_body(request: Request) -> dict[str, object]:
        token = await csrf_token_from_request(request)
        return {"token": token, "match": tokens_match(token, expected)}

    @app.get("/errors/rate-limited")
    async def rate_limited() -> None:
        raise ApiError(
            CODE_RATE_LIMITED,
            "太频繁",
            status_code=429,
            headers={"Retry-After": "42"},
        )

    @app.get("/errors/unsupported")
    async def unsupported() -> None:
        raise ApiError(CODE_UNSUPPORTED_MEDIA_TYPE, "类型不支持", status_code=415)

    return app


def test_csrf_token_from_header_json_and_form():
    with TestClient(_csrf_probe_app()) as client:
        header = client.post("/json", json={}, headers={CSRF_HEADER: "expected-token"})
        assert header.json() == {"token": "expected-token", "match": True}

        body = client.post("/json", json={CSRF_FIELD: "expected-token"})
        assert body.json() == {"token": "expected-token", "match": True}

        form = client.post("/form", data={CSRF_FIELD: "expected-token"})
        assert form.json() == {"token": "expected-token", "match": True}

        missing = client.post("/none", json={"other": 1})
        assert missing.json() == {"token": None, "match": False}


def test_error_envelope_carries_retry_after_and_415_code():
    with TestClient(_csrf_probe_app()) as client:
        limited = client.get("/errors/rate-limited")
        assert limited.status_code == 429
        assert limited.headers["Retry-After"] == "42"
        assert limited.json()["error"]["code"] == CODE_RATE_LIMITED

        unsupported = client.get("/errors/unsupported")
        assert unsupported.status_code == 415
        assert unsupported.json()["error"]["code"] == CODE_UNSUPPORTED_MEDIA_TYPE


# --- Cookie -----------------------------------------------------------------


def test_session_cookie_flags_dev_vs_prod():
    dev = _settings()
    prod = _settings(app_env="prod")

    assert cookies.session_cookie_name(dev) == cookies.DEV_COOKIE_NAME
    assert cookies.session_cookie_secure(dev) is False
    assert cookies.session_cookie_name(prod) == cookies.PROD_COOKIE_NAME
    assert cookies.session_cookie_secure(prod) is True

    response = Response()
    cookies.set_session_cookie(response, prod, "token-value", max_age=3600)
    header = response.headers["set-cookie"]
    assert header.startswith(f"{cookies.PROD_COOKIE_NAME}=token-value")
    assert "HttpOnly" in header and "Secure" in header and "SameSite=lax" in header
    assert "Path=/" in header
    assert "Domain=" not in header  # __Host- 前缀要求不设置 Domain

    cleared = Response()
    cookies.clear_session_cookie(cleared, dev)
    assert cleared.headers["set-cookie"].startswith(f"{cookies.DEV_COOKIE_NAME}=")


# --- 有界并发 ---------------------------------------------------------------


def test_bounded_processing_never_exceeds_limit():
    reset_limiters()
    concurrent = 0
    max_seen = 0
    lock = threading.Lock()

    def slow_work() -> int:
        nonlocal concurrent, max_seen
        with lock:
            concurrent += 1
            max_seen = max(max_seen, concurrent)
        time.sleep(0.03)
        with lock:
            concurrent -= 1
        return 1

    async def run_all() -> list[int]:
        return await asyncio.gather(
            *(run_bounded(slow_work, max_concurrency=2) for _ in range(6))
        )

    results = asyncio.run(run_all())
    assert results == [1] * 6
    assert max_seen <= 2, f"并发上限被突破：{max_seen}"
    assert limiter_for(2) is limiter_for(2)


def test_limiter_rejects_invalid_limit():
    with pytest.raises(ValueError):
        limiter_for(0)


# --- 时间语义 ---------------------------------------------------------------


def test_utcnow_is_aware_and_monotonic_ish():
    from app.core.db import as_utc, utcnow

    now = utcnow()
    assert now.tzinfo is not None
    assert now + timedelta(seconds=1) > now
    naive = datetime(2026, 10, 16, 12, 0)
    assert as_utc(naive).tzinfo == timezone.utc
