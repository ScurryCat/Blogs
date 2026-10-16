"""T09 专用临时库夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库而不是复用 `pl_test`（与 T03 / T04 / T06 同样的理由）：

  - `pl_test` 是 T00 的共享夹具库，T01 / T03 / T06 已保证零污染；T09 也不在共享库里
    建表或写数据；
  - 这里在同一个本机测试集群上建 `pl_test_t09_<pid>`，跑真实迁移后再补齐 T09 缺失的表，
    用例结束即 drop；
  - 名字里带 pytest 进程 pid：同机并行跑测试时不会互相 drop 对方的库
    （T00 已确认 `database ... does not exist` 属于并发共用固定库名的现象）。
    库名经 T00 的 `register_temp_database` 登记，并再经 `assert_test_database_url` 校验。

关于「补齐缺失的表」：T09 **不自己写迁移**（模型与迁移由 T00 集成）。在集成生成迁移之前，
`skills` / `project_skills` / `exploration_records` / `exploration_record_*` 只存在于
`Base.metadata` 里；这里用一张独立的 MetaData（FK 目标表用最小替身）把它们补进临时库，
`t09_schema_report()["created_by_fallback"]` 会如实报告补了哪些表 ——
集成迁移落地后该列表为空，届时这些表完全由真实迁移建出。

一旦迁移落库，`create_all(checkfirst=True)` **不会修改已存在的表**，因此如果迁移建出的
结构与模型不一致（缺列 / 缺约束），用例会因为真实约束缺失而失败，不会被夹具悄悄修好。
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import Settings
from app.core.db import assert_test_database_url, create_session_factory  # noqa: F401
from app.modules.exploration import models as exploration_models
from app.modules.skills import models as skills_models
from tests.core.t01_db import (  # noqa: F401  —— 复用 T00 的建库 / 迁移工具
    _run_migrations,
    create_database,
    drop_database,
    register_temp_database,
)

_PID = os.getpid()
T09_DATABASE_NAME = register_temp_database(f"pl_test_t09_{_PID}")

T09_MODEL_MODULES = (
    "app.modules.skills.models",
    "app.modules.exploration.models",
)

T09_TABLES = (
    "skills",
    "project_skills",
    "exploration_records",
    "exploration_record_posts",
    "exploration_record_projects",
)

# FK 目标表的最小替身：T09 的表引用 admin_users / posts / projects。
# 替身只在内存里用于编译 DDL，不会创建、不会改动任何真实表。
FK_TARGET_STUBS = ("admin_users", "posts", "projects")

_MODULE_BY_TABLE = {
    "skills": skills_models,
    "project_skills": skills_models,
    "exploration_records": exploration_models,
    "exploration_record_posts": exploration_models,
    "exploration_record_projects": exploration_models,
}


def _local_metadata_with_stubs():
    from sqlalchemy import Column, MetaData, Table, Uuid

    from app.core.db import NAMING_CONVENTION

    local = MetaData(naming_convention=NAMING_CONVENTION)
    for name in FK_TARGET_STUBS:
        Table(name, local, Column("id", Uuid(as_uuid=True), primary_key=True))
    for name in T09_TABLES:
        _MODULE_BY_TABLE[name].Base.metadata.tables[name].to_metadata(local)
    return local


def ensure_t09_tables(engine: Engine) -> list[str]:
    """跑完迁移后补齐缺失的表，返回被补出来的表名（空列表 = 迁移已经覆盖）。

    **只补齐 T09 自己的五张表**，不是 `create_all`：T01 的共享守卫用例会断言
    「已注册的表集合 == 冻结清单」，因此这里不能顺手把别人的表也建出来。
    """
    local = _local_metadata_with_stubs()
    with engine.connect() as connection:
        existing = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
    missing = [name for name in T09_TABLES if name not in existing]
    if missing:
        local.create_all(engine, tables=[local.tables[name] for name in missing])
    return missing


@pytest.fixture(scope="session")
def t09_database_url(test_database_url: str) -> str:
    """T09 专用临时库（真实迁移 + 补齐自己的五张表）。用例结束即 drop。"""
    url = create_database(test_database_url, T09_DATABASE_NAME)
    assert_test_database_url(url)
    yield url
    drop_database(test_database_url, T09_DATABASE_NAME)


@pytest.fixture(scope="session")
def t09_schema_report(t09_database_url: str) -> dict[str, object]:
    """`created_by_fallback` 非空说明集成迁移还没有覆盖 T09 的表。"""
    _run_migrations(t09_database_url)
    engine = create_engine(t09_database_url, pool_pre_ping=True, future=True)
    try:
        fallback = ensure_t09_tables(engine)
    finally:
        engine.dispose()
    return {"database_url": t09_database_url, "created_by_fallback": fallback}


@pytest.fixture(scope="session")
def t09_engine(t09_database_url: str, t09_schema_report: dict[str, object]) -> Engine:
    engine = create_engine(t09_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def t09_settings(t09_database_url: str, tmp_path) -> Settings:
    """T09 的测试配置：指向 **T09 自己的临时库**，媒体根指向临时目录。"""
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t09_database_url,
        secret_key="t09-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t09",
        media_root=str(media_root),
    )


@pytest.fixture()
def t09_session(t09_engine: Engine):
    """每个用例一个事务，结束回滚：用例之间互不影响，也不留下数据。"""
    connection = t09_engine.connect()
    transaction = connection.begin()
    factory = create_session_factory(connection)  # type: ignore[arg-type]
    session = factory()
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()
