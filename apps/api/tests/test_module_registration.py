"""路由与模型注册。

契约（SHARED-CONTRACTS §2）：`router.py` 与 `model_registry.py` 由 T00 拥有，
集中挂载与导入，**拒绝目录扫描自动执行插件**；重复登记必须报错，不能静默覆盖。
"""

from __future__ import annotations

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, MetaData, Table
from sqlalchemy.orm import registry as registry_factory

from app import model_registry
from app.core.config import Settings
from app.main import create_app
from app.router import (
    API_V1_PREFIX,
    DuplicateModuleError,
    build_api_router,
    register_module_router,
    registered_module_routers,
    reset_module_routers,
)
from tests.support.module_app import build_module_app, module_client


@pytest.fixture(autouse=True)
def _clean_registry():
    """每个用例前后清空登记表，避免用例之间互相看到对方的模块。"""
    reset_module_routers()
    yield
    reset_module_routers()


def _named_router(prefix: str, path: str) -> APIRouter:
    router = APIRouter(prefix=prefix)

    @router.get(path)
    def _endpoint() -> dict[str, str]:
        return {"ok": prefix}

    return router


def test_duplicate_module_name_is_rejected() -> None:
    register_module_router("posts", _named_router("/posts", "/list"))
    with pytest.raises(DuplicateModuleError):
        register_module_router("posts", _named_router("/other", "/list"))


def test_conflicting_prefix_is_rejected() -> None:
    register_module_router("posts", _named_router("/posts", "/list"))
    with pytest.raises(DuplicateModuleError):
        register_module_router("moments", _named_router("/posts", "/feed"))


def test_registered_module_is_mounted_under_api_v1(test_settings: Settings) -> None:
    register_module_router("posts", _named_router("/posts", "/list"))
    assert "posts" in registered_module_routers()

    client = TestClient(create_app(settings=test_settings), raise_server_exceptions=False)
    assert client.get(f"{API_V1_PREFIX}/posts/list").status_code == 200, \
        "业务路由必须挂在 /api/v1 下"


def test_router_order_is_stable_across_builds() -> None:
    register_module_router("zeta", _named_router("/zeta", "/x"))
    register_module_router("alpha", _named_router("/alpha", "/x"))

    def mounted_paths() -> list[str]:
        # 用 OpenAPI 的路径顺序做投影：它不含对象地址，且正是外部消费者看到的路由清单。
        probe = FastAPI()
        probe.include_router(build_api_router())
        return list(probe.openapi()["paths"])

    assert mounted_paths() == mounted_paths(), "同一进程内路由顺序必须可复现"
    # 健康端点固定在最前（核心自带），其余模块按名称排序，避免登记顺序影响对外输出。
    paths = mounted_paths()
    assert paths[0] == "/api/v1/health/live"
    assert paths[1:] == sorted(paths[1:]), "模块路由按名称排序"


# T01 冻结的 8 张 + T04 导航 3 张 + T03 动态 3 张 + T07 友链 2 张 + T05 日常 3 张 + T08 消息 6 张 + T06 殿堂 4 张。新增内容域时必须同时更新
# MODEL_MODULES 与这里 —— 这是刻意的：让「有人悄悄加表却没登记」在测试里立刻暴露。
EXPECTED_TABLES = (
    "admin_users",
    "ai_budget_days",
    "ai_requests",
    "ai_visitor_days",
    "album_media",
    "albums",
    "audit_events",
    "auth_rate_limits",
    "conversations",
    "exploration_record_posts",
    "exploration_record_projects",
    "exploration_records",
    "friend_link_tags",
    "friend_links",
    "journal_entries",
    "journal_entry_media",
    "leisure_entries",
    "media",
    "messages",
    "moment_media",
    "moment_tags",
    "moments",
    "palace_aliases",
    "palace_posts",
    "palaces",
    "post_tags",
    "posts",
    "project_media",
    "project_skills",
    "projects",
    "sessions",
    "skills",
    "tags",
    "visitor_sessions",
)


def test_model_registry_matches_the_wired_module_list() -> None:
    loaded = model_registry.import_all_models()
    assert loaded == list(model_registry.MODEL_MODULES)
    assert isinstance(model_registry.MODEL_MODULES, tuple), "清单必须是显式元组，不能是扫描结果"
    assert model_registry.registered_tables() == EXPECTED_TABLES, (
        "已注册的表与冻结清单不一致；新增内容域请同时更新 MODEL_MODULES 与本断言"
    )


def test_missing_model_module_fails_loudly() -> None:
    with pytest.raises(ModuleNotFoundError):
        model_registry.import_all_models(["app.modules.does_not_exist.models"])


def test_shared_table_between_two_models_is_detected() -> None:
    """两个模型指向同一张表必须在启动时报错，否则迁移会给出漂移结果。"""
    isolated = registry_factory()
    metadata = MetaData()
    shared = Table("shared_table", metadata, Column("id", Integer, primary_key=True))

    @isolated.mapped
    class First:
        __table__ = shared

    @isolated.mapped
    class Second:
        __table__ = shared

    with pytest.raises(model_registry.DuplicateModelError):
        model_registry.assert_no_table_conflicts(isolated)


def test_production_app_starts_without_any_optional_module(test_settings: Settings) -> None:
    """骨架阶段没有任何业务模块，应用仍必须能建起来并响应健康检查。"""
    client = TestClient(create_app(settings=test_settings, module_routers={}),
                        raise_server_exceptions=False)
    response = client.get(f"{API_V1_PREFIX}/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_module_app_does_not_leak_other_modules(test_settings: Settings) -> None:
    client = module_client(test_settings, ("posts", _named_router("/posts", "/list")))
    assert client.get(f"{API_V1_PREFIX}/posts/list").status_code == 200
    assert client.get(f"{API_V1_PREFIX}/moments/feed").status_code == 404, \
        "未登记的模块不应出现在测试 app 里"
