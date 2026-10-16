"""T08 专用临时库夹具（真实 PostgreSQL，绝不用 SQLite）。

与 T03 的做法一致：在同一个本机测试集群上**自建** `pl_test_t08_<pid>`，
名字经 T00 的 `register_temp_database` 登记 + `assert_test_database_url` 校验，
用例结束即 drop。**带 pytest 进程 pid**：同机并行跑测试时不会互相 drop 对方的库。

与 T03 的两点不同，都是本模块的性质决定的：

1. **用例之间用 TRUNCATE 而不是「一个事务跑完再回滚」。**
   本模块要验证的东西（幂等唯一约束、部分唯一索引、跨进程/跨连接的可见性、
   真实并发下的原子预留）在「所有写入都待在一个最后被回滚的事务里」时**根本测不到**，
   甚至测出来是假通过的。因此这里的 session 会真的提交，用例开始前清空本模块的表。
   `TRUNCATE ... RESTART IDENTITY CASCADE` 只影响 messaging 自己的表
   （`visitor_sessions` 级联到它的四张子表）。

2. **不用 `Base.metadata.create_all` 建别人的表。**
   `_ensure_tables` 只补本模块的六张表，DDL 来自一张带 FK 替身的独立 MetaData，
   因此既有真实约束名可断言，也不会污染 T01 的共享守卫用例。
   `t08_schema_report()["created_by_fallback"]` 如实报告补了哪些表 ——
   T00 生成迁移后该列表应为空。
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import Settings
from app.core.db import assert_test_database_url, create_session_factory
from app.modules.messaging import models as messaging_models
from tests.core.t01_db import (  # noqa: F401  —— 复用 T00 的建库 / 迁移工具
    _run_migrations,
    create_database,
    drop_database,
    register_temp_database,
)

_PID = os.getpid()
T08_DATABASE_NAME = register_temp_database(f"pl_test_t08_{_PID}")

T08_MODEL_MODULES = ("app.modules.messaging.models",)

MESSAGING_TABLES = (
    "visitor_sessions",
    "conversations",
    "messages",
    "ai_requests",
    "ai_budget_days",
    "ai_visitor_days",
)

# `conversations` 不引用其他域的表；`messages` 引用 `ai_requests`（本域）。
FK_TARGET_STUBS: tuple[str, ...] = ()


def _local_metadata():
    """只含本模块六张表的独立 MetaData（用于生成补齐用的 DDL）。"""
    from sqlalchemy import MetaData

    from app.core.db import NAMING_CONVENTION

    local = MetaData(naming_convention=NAMING_CONVENTION)
    for name in MESSAGING_TABLES:
        messaging_models.Base.metadata.tables[name].to_metadata(local)
    return local


def ensure_messaging_tables(engine: Engine) -> list[str]:
    """跑完迁移后补齐缺失的表，返回被补出来的表名（空列表 = 迁移已覆盖）。"""
    local = _local_metadata()
    with engine.connect() as connection:
        existing = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
    missing = [name for name in MESSAGING_TABLES if name not in existing]
    if missing:
        local.create_all(engine, tables=[local.tables[name] for name in missing])
    return missing


@pytest.fixture(scope="session")
def t08_database_url(test_database_url: str) -> str:
    """T08 专用临时库（真实迁移 + 补齐自己的六张表）。用例结束即 drop。"""
    url = create_database(test_database_url, T08_DATABASE_NAME)
    assert_test_database_url(url)
    yield url
    drop_database(test_database_url, T08_DATABASE_NAME)


@pytest.fixture(scope="session")
def t08_schema_report(t08_database_url: str) -> dict[str, object]:
    _run_migrations(t08_database_url)
    engine = create_engine(t08_database_url, pool_pre_ping=True, future=True)
    try:
        fallback = ensure_messaging_tables(engine)
    finally:
        engine.dispose()
    return {"database_url": t08_database_url, "created_by_fallback": fallback}


@pytest.fixture(scope="session")
def t08_engine(t08_database_url: str, t08_schema_report: dict[str, object]) -> Engine:
    engine = create_engine(t08_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def t08_session_factory(t08_engine: Engine):
    """**会真的提交**的 sessionmaker。用例之间靠 TRUNCATE 清理，不靠回滚。"""
    return create_session_factory(t08_engine)


@pytest.fixture(autouse=True)
def t08_clean_tables(t08_engine: Engine, t08_session_factory):
    """用例开始前清空本模块的表（含登录用的 `admin_users` 中的 T08 自建行）。

    TRUNCATE 只列 messaging 自己的表；`CASCADE` 只是把这些表的子表一起清掉。
    绝不 `drop_all`、绝不 `drop database`。
    """
    from sqlalchemy import text as sql_text

    with t08_engine.begin() as connection:
        connection.execute(
            sql_text(
                "truncate table visitor_sessions, ai_budget_days restart identity cascade"
            )
        )
    yield


@pytest.fixture()
def t08_settings(t08_database_url: str, tmp_path) -> Settings:
    """T08 的**核心**配置（Cookie 策略等）。AI 运行参数见 `t08_msg_settings`。"""
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t08_database_url,
        secret_key="t08-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t08",
        media_root=str(media_root),
        # 与浏览器同源形态一致：调试期前端在 3100。
        cors_origins="http://127.0.0.1:3100",
    )


@pytest.fixture()
def t08_session(t08_session_factory):
    """一个会提交的 session。用完关闭。"""
    session = t08_session_factory()
    try:
        yield session
    finally:
        session.close()
