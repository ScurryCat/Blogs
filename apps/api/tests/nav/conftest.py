"""T04 模块测试的隔离夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库：`pl_test` 是 T00 的共享夹具库；T04 不往共享库里加表、也不依赖
「T03 的并行改动是否刚好可用」。因此在同一个本机测试集群上建 **`pl_test_t04`**：
库名通过共享 helper 的 `register_temp_database("pl_test_t04")` 登记（白名单可扩展，
不必再改 T01 的文件），创建 / 删除也直接用共享的 `create_database` / `drop_database`。

建好库后跑 `alembic upgrade head`，再用 `Base.metadata.create_all` 补齐 T00 尚未生成的表
（集成前迁移里还没有 nav 表；一旦迁移落库，这里就用真实迁移建表）。
`create_all(checkfirst=True)` 不会修改已存在的表：如果迁移建出的表结构不对，
用例会因为缺列 / 缺约束而失败，不会被夹具悄悄「修好」。

**开发期只跑本目录**（`pytest apps/api/tests/nav`）：全量套件会连带跑其他包的
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
T04_DATABASE_NAME = register_temp_database("pl_test_t04")

# 依赖顺序：nav 引用 posts / media（封面）与 auth（站主会话）。
T04_MODEL_MODULES = (
    "app.modules.auth.models",
    "app.modules.media.models",
    "app.modules.tags.models",
    "app.modules.posts.models",
    "app.modules.nav.models",
)

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
    """跑完迁移后补齐缺失的表（集成尚未生成 nav / T01 表时的临时手段）。"""
    from app import model_registry

    model_registry.import_all_models(T04_MODEL_MODULES)
    with engine.connect() as connection:
        existing = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
    missing = [name for name in Base.metadata.tables if name not in existing]
    if missing:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in missing])
    return sorted(missing)


@pytest.fixture(scope="session")
def t04_database_url(test_database_url: str) -> Iterator[str]:
    """T04 专用临时库：重建 → 迁移 → 建表 → 用例结束 drop。"""
    # create_database 自带 DROP + CREATE、白名单守卫与「权限不足则 skip」。
    target = create_database(test_database_url, T04_DATABASE_NAME)

    _run_migrations(target)
    setup_engine = create_engine(target, pool_pre_ping=True, future=True)
    try:
        T04_SCHEMA_REPORT["created_by_fallback"] = _ensure_tables(setup_engine)
    finally:
        setup_engine.dispose()

    yield target

    drop_database(test_database_url, T04_DATABASE_NAME)


T04_SCHEMA_REPORT: dict[str, object] = {"created_by_fallback": []}


@pytest.fixture(scope="session")
def t04_schema_report() -> dict[str, object]:
    """哪些表是夹具补出来的（非空说明集成迁移还没覆盖 nav）。"""
    return T04_SCHEMA_REPORT


@pytest.fixture(scope="session")
def t04_engine(t04_database_url: str) -> Iterator[Engine]:
    engine = create_engine(t04_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def t04_session(t04_engine: Engine) -> Iterator[Session]:
    """每个用例一个事务，结束回滚：用例之间互不影响，也不留下数据。"""
    connection = t04_engine.connect()
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
def t04_settings(t04_database_url: str, tmp_path: Path) -> Settings:
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t04_database_url,
        secret_key="t04-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t04",
        media_root=str(media_root),
    )


@pytest.fixture(autouse=True)
def _reset_nav_rate_limits() -> Iterator[None]:
    """限流是进程内计数：用例之间必须干净，否则后面的用例会被前面的请求限流。"""
    from app.modules.nav import ratelimit

    ratelimit.reset()
    yield
    ratelimit.reset()


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
def nav_client(t04_settings: Settings, t04_session: Session) -> Iterator[TestClient]:
    """导航模块 + 认证模块的测试客户端（管理端需要真实登录流程）。"""
    from app.modules.auth.router import router as auth_router
    from app.modules.nav.router import router as nav_router

    with module_api_client(t04_settings, t04_session, ("auth", auth_router), ("nav", nav_router)) as client:
        yield client


@pytest.fixture()
def public_client(t04_settings: Settings, t04_session: Session) -> Iterator[TestClient]:
    """只挂导航公开路由的客户端（用来证明公开端点不依赖任何会话）。"""
    from app.modules.nav.router import router as nav_router

    with module_api_client(t04_settings, t04_session, ("nav", nav_router)) as client:
        yield client
