"""契约漂移检查。

01 §7：API 用 OpenAPI 输出契约，前端生成类型，**CI 检查漂移**。
这里把「漂移检查」落成会失败的测试：已提交的 `contracts/openapi.json`
必须与当前后端生成的结果一致；不一致说明有人改了路由却忘了重新导出。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parents[1]
CONTRACT_PATH = REPO_ROOT / "contracts" / "openapi.json"

sys.path.insert(0, str(API_DIR / "scripts"))

from export_openapi import serialized_schema  # noqa: E402


def test_committed_openapi_matches_generated_schema() -> None:
    assert CONTRACT_PATH.exists(), (
        "缺少 contracts/openapi.json；请运行 "
        "uv run --project apps/api python apps/api/scripts/export_openapi.py"
    )
    committed = CONTRACT_PATH.read_text(encoding="utf-8")
    assert committed == serialized_schema(), (
        "contracts/openapi.json 与后端实际路由不一致；"
        "重新运行 apps/api/scripts/export_openapi.py 并提交结果"
    )


def test_contract_covers_health_and_api_prefix() -> None:
    schema = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    assert "/api/v1/health/live" in schema["paths"]


def test_readiness_is_either_absent_or_real() -> None:
    """禁止的是「存在但只会返回 ok」的假就绪，不是 readiness 本身。

    T00 阶段没有 readiness（真实检查留给 T01）；T01 接线后它会存在，且必须能报告
    未就绪 —— 因此要求它的响应集合里出现 503。永远返回 200/ok 的实现会在这里失败。
    """
    schema = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    ready = schema["paths"].get("/api/v1/health/ready")
    if ready is None:
        return  # 尚未接线：合规
    responses = ready["get"]["responses"]
    assert "503" in responses, (
        "readiness 必须能报告未就绪（503），否则就是永远返回 ok 的假就绪"
    )
    assert "200" in responses, "就绪时仍应返回 200"


@pytest.mark.parametrize("path", ["/api/v1/health/live"])
def test_health_endpoint_shape_is_minimal(path: str) -> None:
    schema = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    response_schema = schema["paths"][path]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert response_schema, "健康端点必须有响应 schema"
