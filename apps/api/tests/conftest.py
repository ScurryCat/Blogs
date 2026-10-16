"""测试夹具：隔离 PostgreSQL、测试依赖覆盖、模块测试 app 工厂。

安全边界（T00 执行清单 / 交接计划）：
  - 测试只连 **库名带 test 标记** 的库；`assert_test_database_url` 拒绝生产库名。
  - 每个用例跑在**事务里并回滚**，因此任何测试都不可能清空已知数据库。
  - 不调用 `drop_all` / `drop database`；迁移只做 `upgrade head`。
  - 没有 TEST_DATABASE_URL 时明确 skip，不静默退化成 SQLite（05 §10 禁止用 SQLite 冒充）。
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

# --- 环境准备必须发生在导入 app.* 之前：Settings 的必填项来自环境变量 ---
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-used-anywhere-0123456789")
# 占位连接串：只有真正连库的用例才会用到，且会被 assert_test_database_url 校验。
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://pl@127.0.0.1:55432/pl_test")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.core.db import assert_test_database_url, create_session_factory  # noqa: E402

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DATABASE_URL_ENV = "TEST_DATABASE_URL"


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "database: 需要真实 PostgreSQL 测试库的用例")


@pytest.fixture(scope="session")
def test_database_url() -> str:
    """校验并返回测试库连接串；未配置或库名不安全都直接 skip / 报错。"""
    url = os.environ.get(TEST_DATABASE_URL_ENV, "").strip()
    if not url:
        pytest.skip(
            f"未设置 {TEST_DATABASE_URL_ENV}；跳过需要真实 PostgreSQL 的用例。"
            "本机可用 .dsh 下的临时集群，见交付单 T00-result.md 的复现命令。"
        )
    # 库名不带 test 标记或像生产库名 → 这里抛错而不是 skip：配置错了必须被发现。
    assert_test_database_url(url)
    return url


@pytest.fixture(scope="session")
def migrated_engine(test_database_url: str) -> Iterator[Engine]:
    """在测试库上执行 `alembic upgrade head`，返回引擎。

    只升级、不降级、不删库：迁移链本身是被测对象之一（单一 head）。
    """
    alembic_cfg = Config(os.path.join(API_DIR, "alembic.ini"))
    alembic_cfg.set_main_option("script_location", os.path.join(API_DIR, "migrations"))
    # 通过 -x db_url 传入，env.py 会强制校验这是测试库。
    alembic_cfg.cmd_opts = type("_Opts", (), {"x": [f"db_url={test_database_url}"]})()
    command.upgrade(alembic_cfg, "head")

    engine = create_engine(test_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db_session(migrated_engine: Engine) -> Iterator[Session]:
    """每个用例一个事务，结束后回滚 —— 用例之间互不影响，也不留下数据。"""
    connection = migrated_engine.connect()
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
def test_settings(test_database_url: str) -> Settings:
    """测试用配置。密钥是明显的测试值，不会出现在任何真实环境。"""
    return Settings(
        app_env="test",
        database_url=test_database_url,
        secret_key="test-only-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-test",
    )


@pytest.fixture()
def client(test_settings: Settings) -> Iterator[TestClient]:
    """生产 app 的测试客户端。模块级用例请用 support.module_app 的工厂。"""
    from app.main import create_app

    app = create_app(settings=test_settings, module_routers={})
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def database_is_reachable(engine: Engine) -> bool:
    """诊断用：库是否真的可连。仅用于给出更清楚的失败信息。"""
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
        return True
    except Exception:
        return False


__all__ = [
    "API_DIR",
    "TEST_DATABASE_URL_ENV",
    "database_is_reachable",
    "sessionmaker",
]
