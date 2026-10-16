"""T07 模块测试的隔离夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库：`pl_test` 是 T00 的共享夹具库；T07 不往共享库里加表、也不依赖
「T03 / T05 的并行改动是否刚好可用」。因此在同一个本机测试集群上建 **`pl_test_t07`**：
库名通过共享 helper 的 `register_temp_database("pl_test_t07")` 登记（白名单可扩展，
不必再改 T01 的文件），创建 / 删除也直接用共享的 `create_database` / `drop_database`。

建好库后跑 `alembic upgrade head`，再用 `Base.metadata.create_all` 补齐 T00 尚未生成的表
（集成前迁移里还没有 coop 表；一旦迁移落库，这里就用真实迁移建表）。
`create_all(checkfirst=True)` 不会修改已存在的表：如果迁移建出的表结构不对，
用例会因为缺列 / 缺约束而失败，不会被夹具悄悄「修好」。

**开发期只跑本目录**（`pytest apps/api/tests/coop`）：全量套件会连带跑其他包的
固定库名夹具，并发时互相 drop 对方的库（集成负责人负责串行跑全量）。
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import Base, create_session_factory
from app.core.deps import get_session, get_settings_dep
from tests.core.t01_db import create_database, drop_database, register_temp_database
from tests.support.module_app import build_module_app

# 共享 helper 的白名单登记：不必再编辑 T01 的文件，也不会和其他包抢同一份常量。
T07_DATABASE_NAME = register_temp_database("pl_test_t07")

# 依赖顺序：coop 的头像引用 media，写操作引用 auth（站主会话）。
T07_MODEL_MODULES = (
    "app.modules.auth.models",
    "app.modules.media.models",
    "app.modules.coop.models",
)

COOP_TABLES = ("friend_links", "friend_link_tags")

API_DIR = Path(__file__).resolve().parents[2]

os.environ.setdefault("APP_ENV", "test")


def _run_migrations(url: str) -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    config.cmd_opts = type("_Opts", (), {"x": [f"db_url={url}"]})()
    command.upgrade(config, "head")


def _ensure_tables(engine: Engine) -> list[str]:
    """跑完迁移后补齐缺失的 coop 表（集成尚未生成迁移时的临时手段）。"""
    from app import model_registry

    model_registry.import_all_models(T07_MODEL_MODULES)
    with engine.connect() as connection:
        existing = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
    missing = [
        name for name in Base.metadata.tables if name not in existing and name in COOP_TABLES
    ]
    if missing:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in missing])
    return sorted(missing)


T07_SCHEMA_REPORT: dict[str, object] = {"created_by_fallback": []}


@pytest.fixture(scope="session")
def t07_database_url(test_database_url: str) -> Iterator[str]:
    """T07 专用临时库：重建 → 迁移 → 建表 → 用例结束 drop。"""
    target = create_database(test_database_url, T07_DATABASE_NAME)

    _run_migrations(target)
    setup_engine = create_engine(target, pool_pre_ping=True, future=True)
    try:
        T07_SCHEMA_REPORT["created_by_fallback"] = _ensure_tables(setup_engine)
    finally:
        setup_engine.dispose()

    yield target

    drop_database(test_database_url, T07_DATABASE_NAME)


@pytest.fixture(scope="session")
def t07_schema_report() -> dict[str, object]:
    """哪些表是夹具补出来的（非空说明集成迁移还没覆盖 coop）。"""
    return T07_SCHEMA_REPORT


@pytest.fixture(scope="session")
def t07_engine(t07_database_url: str) -> Iterator[Engine]:
    engine = create_engine(t07_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def t07_session(t07_engine: Engine) -> Iterator[Session]:
    """每个用例一个事务，结束回滚：用例之间互不影响，也不留下数据。"""
    connection = t07_engine.connect()
    transaction = connection.begin()
    factory = create_session_factory(connection)  # type: ignore[arg-type]
    session = factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture()
def t07_settings(t07_database_url: str, tmp_path: Path) -> Settings:
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t07_database_url,
        secret_key="t07-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t07",
        media_root=str(media_root),
    )


@pytest.fixture(autouse=True)
def _reset_coop_wiring() -> Iterator[None]:
    """每个用例从「默认不贡献」开始：媒体公开引用检查的存在与否由用例自己决定。

    这样「未登记 = 匿名读头像 404」与「登记后才读得到」都能被真实断言，
    而不是依赖上一个用例留下的全局状态。
    """
    from app.modules.coop import wiring

    wiring.unregister()
    yield
    wiring.unregister()


@contextmanager
def module_api_client(
    settings: Settings,
    session: Session,
    *routers: tuple[str, APIRouter],
) -> Iterator[TestClient]:
    """只挂给定模块 router 的测试客户端，会话依赖被替换成事务夹具的 session。"""
    app = build_module_app(settings, *routers)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_settings_dep] = lambda: settings
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture()
def coop_client(t07_settings: Settings, t07_session: Session) -> Iterator[TestClient]:
    """友链模块 + 认证模块 + 媒体模块的测试客户端。

    媒体模块在册是因为「头像走共享媒体权限」这条要用真实的
    `GET /media/{id}/{variant}` 来证明，而不是只断言我们自己的布尔函数。
    """
    from app.modules.auth.router import router as auth_router
    from app.modules.coop.router import router as coop_router
    from app.modules.media.router import router as media_router

    with module_api_client(
        t07_settings,
        t07_session,
        ("auth", auth_router),
        ("coop", coop_router),
        ("media", media_router),
    ) as client:
        yield client


@pytest.fixture()
def public_client(t07_settings: Settings, t07_session: Session) -> Iterator[TestClient]:
    """只挂友链公开路由的客户端（证明公开端点不依赖任何会话）。"""
    from app.modules.coop.router import router as coop_router

    with module_api_client(t07_settings, t07_session, ("coop", coop_router)) as client:
        yield client
