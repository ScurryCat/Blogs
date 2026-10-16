"""共享错误结构。

契约（05 §9）：错误体只有两个顶层键 —— `error`（含 code / message / fields）与 `request_id`。
这些用例断言的是**结构本身**，不是某个业务错误文案。
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.config import Settings
from app.core.errors import (
    CODE_INTERNAL,
    CODE_NOT_FOUND,
    CODE_UNPROCESSABLE,
    CODE_VERSION_CONFLICT,
    REQUEST_ID_HEADER,
    ApiError,
)
from tests.support.module_app import build_module_app, module_client


def _router() -> APIRouter:
    router = APIRouter(prefix="/errors", tags=["test"])

    @router.get("/not-found")
    def not_found() -> None:
        raise ApiError(CODE_NOT_FOUND, "内容不存在或对公众不可见", status_code=404)

    @router.get("/version-conflict")
    def version_conflict() -> None:
        # 带 fields 的 412：Code 与语义都来自 05 §9。
        raise ApiError(
            CODE_VERSION_CONFLICT,
            "内容已在别处更新，请先读取最新版本。",
            status_code=412,
            fields={"version": ["过期"]},
        )

    @router.get("/validated")
    def validated(limit: int = Query(ge=1, le=30)) -> dict[str, int]:
        return {"limit": limit}

    @router.get("/boom")
    def boom() -> None:
        raise RuntimeError("内部实现细节，绝不能出现在响应里")

    return router


def _client(test_settings: Settings):
    return module_client(test_settings, ("errors", _router()))


def _assert_error_envelope(payload: dict, *, code: str) -> None:
    assert set(payload) == {"error", "request_id"}, "错误体只允许 error 与 request_id 两个顶层键"
    assert set(payload["error"]) == {"code", "message", "fields"}
    assert payload["error"]["code"] == code
    assert isinstance(payload["error"]["message"], str) and payload["error"]["message"]
    assert isinstance(payload["error"]["fields"], dict)
    assert isinstance(payload["request_id"], str) and payload["request_id"]


def test_api_error_uses_contract_envelope(test_settings: Settings) -> None:
    response = _client(test_settings).get("/api/v1/errors/not-found")
    assert response.status_code == 404, "业务错误必须用真实状态码，不能包成 200"
    _assert_error_envelope(response.json(), code=CODE_NOT_FOUND)


def test_version_conflict_keeps_field_details(test_settings: Settings) -> None:
    response = _client(test_settings).get("/api/v1/errors/version-conflict")
    assert response.status_code == 412
    payload = response.json()
    _assert_error_envelope(payload, code=CODE_VERSION_CONFLICT)
    assert payload["error"]["fields"] == {"version": ["过期"]}


def test_validation_error_maps_to_same_envelope(test_settings: Settings) -> None:
    response = _client(test_settings).get("/api/v1/errors/validated", params={"limit": 999})
    assert response.status_code == 422
    payload = response.json()
    _assert_error_envelope(payload, code=CODE_UNPROCESSABLE)
    # 字段路径带位置前缀（body 会省略），因此名为 limit 的查询参数键是 query.limit。
    fields = payload["error"]["fields"]
    assert any(key == "limit" or key.endswith(".limit") for key in fields), \
        f"字段级错误要能定位到具体字段，当前为 {sorted(fields)}"
    assert fields["query.limit"], "字段错误需要带说明文本"


def test_unmatched_route_also_uses_envelope(test_settings: Settings) -> None:
    response = _client(test_settings).get("/api/v1/definitely-not-mounted")
    assert response.status_code == 404
    _assert_error_envelope(response.json(), code=CODE_NOT_FOUND)


def test_unhandled_exception_hides_internals(test_settings: Settings) -> None:
    response = _client(test_settings).get("/api/v1/errors/boom")
    assert response.status_code == 500
    payload = response.json()
    _assert_error_envelope(payload, code=CODE_INTERNAL)
    assert "RuntimeError" not in response.text
    assert "内部实现细节" not in response.text


def test_request_id_is_echoed_and_matches_body(test_settings: Settings) -> None:
    client = _client(test_settings)
    inbound = "req-abc-123"

    echo = client.get("/api/v1/errors/not-found", headers={REQUEST_ID_HEADER: inbound})
    assert echo.headers[REQUEST_ID_HEADER] == inbound
    assert echo.json()["request_id"] == inbound

    generated = client.get("/api/v1/errors/not-found")
    body_id = generated.json()["request_id"]
    assert body_id and body_id != inbound
    assert generated.headers[REQUEST_ID_HEADER] == body_id, "响应头与响应体必须给同一个 request_id"


def test_health_live_reports_process_state_only(test_settings: Settings) -> None:
    response = _client(test_settings).get("/api/v1/health/live")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    # 最小状态：不泄漏连接串、目录、数据库名或堆栈（06 §8）。
    leaked = {"password", "secret", "database", "dbname", "dsn", "path", "traceback", "host"}
    assert not (set(payload) & leaked)
    assert "postgres" not in response.text.lower()


def test_readiness_endpoint_is_deliberately_absent(test_settings: Settings) -> None:
    """T00 不提供 readiness：真实 DB/schema/媒体检查留给 T01 / T10。"""
    response = _client(test_settings).get("/api/v1/health/ready")
    assert response.status_code == 404, "不得用永远返回 ok 的实现冒充 readiness"


def test_module_app_only_mounts_given_modules(test_settings: Settings) -> None:
    app = build_module_app(test_settings, ("errors", _router()))
    client = module_client(test_settings, ("errors", _router()))
    # 行为断言优先于路由表内省：只看已挂载的模块能响应、未挂载的返回契约化 404。
    assert client.get("/api/v1/errors/not-found").status_code == 404
    assert client.get("/api/v1/health/live").status_code == 200, "健康端点属于所有应用"
    assert client.get("/api/v1/moments/feed").status_code == 404
    assert app is not None
