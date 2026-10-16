"""T01 模块测试的隔离夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库而不是复用 `pl_test`：
  - `pl_test` 是 T00 的共享夹具库（`migrated_engine`），迁移链验证由 T00 负责；
    T01 不应该往共享库里加表或依赖「迁移是否已经生成」。
  - 因此这里在**同一个本机测试集群**上建一个专用库 `pl_test_t01`（外加一个
    永远保持空库状态的 `pl_test_t01_empty`，用于 readiness 的「未迁移」分支），
    名字硬编码 + 经 `assert_test_database_url` 校验，且只有这两个名字允许被 drop。
  - 建库后先跑 `alembic upgrade head`；若集成尚未生成 T01 的迁移，则用
    `Base.metadata.create_all` 补齐缺失的表。**迁移链本身的验证不属于本夹具**：
    一旦迁移落库，这里就会用真实迁移建表；若迁移建出的表结构不对，
    `create_all(checkfirst=True)` 不会修改已存在的表，测试会因为缺列/约束而失败。

数据库约束（CHECK / 唯一 / 外键）全部由真实 PostgreSQL 执行，测试断言的是真实约束行为。
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import Base, assert_test_database_url, create_session_factory
from app.core.deps import get_session, get_settings_dep
from tests.support.module_app import build_module_app

T01_DATABASE_NAME = "pl_test_t01"
T01_EMPTY_DATABASE_NAME = "pl_test_t01_empty"
ALLOWED_TEMP_DATABASES = (T01_DATABASE_NAME, T01_EMPTY_DATABASE_NAME)

# 逐包登记用的附加白名单。
#
# 为什么要有它：`create_database` / `drop_database` 是所有包的测试共用工具，而白名单
# 原先只有一份常量 —— 于是每来一个新包（T04 / T05 / T07 / T08 / T09…）都要编辑本文件，
# 多个包并行时就是同一文件的写-写争用。
#
# 现在各包在自己的测试支撑文件里调一次 `register_temp_database("pl_test_tXX")` 即可，
# 互不干扰。**安全性不变**：登记时仍然要求库名像测试库（与 `assert_test_database_url`
# 同一套校验），运行时也仍有 `_guard_name` + `assert_test_database_url` 两层拦截。
_EXTRA_TEMP_DATABASES: set[str] = set()


def register_temp_database(name: str) -> str:
    """登记本包使用的临时库名，返回它以便直接引用。

    必须在库名像测试库时才通过（含 `test` 段、不含 prod/production/live/main）。
    """
    assert_test_database_url(url_with_database("postgresql+psycopg://pl@127.0.0.1:5432/placeholder", name))
    _EXTRA_TEMP_DATABASES.add(name)
    return name


def allowed_temp_databases() -> frozenset[str]:
    """当前允许创建/删除的临时库全集（内置 + 各包登记）。"""
    return frozenset(ALLOWED_TEMP_DATABASES) | frozenset(_EXTRA_TEMP_DATABASES)

# 与集成申请里给 T00 的清单一致；顺序即依赖顺序（auth → media → tags → posts）。
T01_MODEL_MODULES = (
    "app.modules.auth.models",
    "app.modules.media.models",
    "app.modules.tags.models",
    "app.modules.posts.models",
)

API_DIR = Path(__file__).resolve().parents[2]


def url_with_database(url: str, name: str) -> str:
    return make_url(url).set(database=name).render_as_string(hide_password=False)


def _guard_name(name: str) -> None:
    if name not in allowed_temp_databases():
        raise RuntimeError(f"拒绝操作非 T01 临时库：{name!r}")


def create_database(base_url: str, name: str) -> str:
    """在测试集群上重建一个空的 T01 临时库，返回其连接串。

    权限不足（非 CREATEDB / 非超级用户）时 skip 并说明原因，不静默降级。
    """
    _guard_name(name)
    target = url_with_database(base_url, name)
    assert_test_database_url(target)
    engine = create_engine(base_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
            connection.execute(text(f'CREATE DATABASE "{name}"'))
    except (ProgrammingError, OperationalError) as exc:
        pytest.skip(f"当前测试角色无法创建 / 删除临时数据库（{type(exc).__name__}）：本机测试集群需 CREATEDB 权限")
    finally:
        engine.dispose()
    return target


def drop_database(base_url: str, name: str) -> None:
    _guard_name(name)
    try:
        engine = create_engine(base_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        engine.dispose()
    except Exception:  # pragma: no cover - 清理失败不应该让测试会话失败
        pass


def _run_migrations(url: str) -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    config.cmd_opts = type("_Opts", (), {"x": [f"db_url={url}"]})()
    command.upgrade(config, "head")


# T01 自己声明的 8 张表（与 `MODEL_MODULES` 一一对应）。
# 显式列出而不是扫 `Base.metadata`：那是**全进程共享**的注册表，其他域
# （T03 / T04…）的模型只要在同一个 pytest 进程里被导入过就会出现在里面，
# 用全量集合做「迁移覆盖度」断言会把别的域的表误算成 T01 漏掉的表。
T01_TABLES = (
    "admin_users",
    "audit_events",
    "auth_rate_limits",
    "media",
    "post_tags",
    "posts",
    "sessions",
    "tags",
)


def _ensure_tables(engine: Engine) -> list[str]:
    """跑完迁移后补齐缺失的表（集成前迁移还没有 T01 表时的临时手段）。

    返回被 `create_all` 补出来的表名，便于测试断言「迁移到没到位」。
    """
    from app import model_registry

    model_registry.import_all_models(T01_MODEL_MODULES)
    with engine.connect() as connection:
        existing = set(
            connection.execute(
                text("select table_name from information_schema.tables where table_schema = current_schema()")
            ).scalars()
        )
    missing = [
        name
        for name in T01_TABLES
        if name not in existing and name in Base.metadata.tables
    ]
    if missing:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in missing])
    return sorted(missing)


@pytest.fixture(scope="session")
def t01_database_url(test_database_url: str) -> Iterator[str]:
    """T01 专用临时库（迁移 + 建表）。"""
    url = create_database(test_database_url, T01_DATABASE_NAME)
    yield url
    drop_database(test_database_url, T01_DATABASE_NAME)


@pytest.fixture(scope="session")
def t01_empty_database_url(test_database_url: str) -> Iterator[str]:
    """一个**始终为空**的临时库：用于 readiness 的「schema 未迁移」与「无表」分支。"""
    url = create_database(test_database_url, T01_EMPTY_DATABASE_NAME)
    yield url
    drop_database(test_database_url, T01_EMPTY_DATABASE_NAME)


@pytest.fixture(scope="session")
def t01_schema_report(t01_database_url: str) -> dict[str, object]:
    """建表来源报告：先跑真实迁移，再补齐缺失的表（记录补了哪些）。

    这是给交付证据用的：`created_by_fallback` 非空说明集成迁移还没生成 T01 的表。
    """
    _run_migrations(t01_database_url)
    engine = create_engine(t01_database_url, pool_pre_ping=True, future=True)
    try:
        fallback = _ensure_tables(engine)
    finally:
        engine.dispose()
    return {"database_url": t01_database_url, "created_by_fallback": fallback}


@pytest.fixture(scope="session")
def t01_engine(t01_database_url: str, t01_schema_report: dict[str, object]) -> Iterator[Engine]:
    engine = create_engine(t01_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def t01_session(t01_engine: Engine) -> Iterator[Session]:
    """每个用例一个事务，结束回滚：用例之间互不影响，也不留下数据。"""
    connection = t01_engine.connect()
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
def t01_settings(t01_database_url: str, tmp_path: Path) -> Settings:
    """测试配置：媒体根指向临时目录，密钥是明显的测试值。"""
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t01_database_url,
        secret_key="t01-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t01",
        media_root=str(media_root),
    )


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


def error_code(response) -> str | None:
    """取错误响应里的 code，便于断言而不依赖文案。"""
    try:
        payload = response.json()
    except Exception:  # pragma: no cover - 非 JSON 响应
        return None
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        return payload["error"].get("code")
    return None


def assert_error(response, *, status: int, code: str) -> dict:
    """断言错误契约（状态码 + code + 信封形状），并返回响应体。"""
    payload = response.json()
    assert response.status_code == status, f"期望 {status}，实际 {response.status_code}：{payload}"
    assert set(payload) == {"error", "request_id"}, payload
    assert set(payload["error"]) == {"code", "message", "fields"}, payload
    assert payload["error"]["code"] == code, payload
    assert isinstance(payload["error"]["fields"], dict), payload
    assert payload["request_id"], payload
    return payload


# 以便 test 模块直接 `from tests.core.t01_db import uuid4` 之类的辅助零散使用。
def unique_slug(prefix: str = "post") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


__all__ = [
    "T01_DATABASE_NAME",
    "T01_EMPTY_DATABASE_NAME",
    "T01_MODEL_MODULES",
    "assert_error",
    "error_code",
    "module_api_client",
    "unique_slug",
    "url_with_database",
]


# 环境变量里的 TEST_DATABASE_URL 会在 conftest 里被校验；这里额外保证测试进程
# 不会因为 APP_ENV 之类被误设成 prod 而连到别的库。
os.environ.setdefault("APP_ENV", "test")
