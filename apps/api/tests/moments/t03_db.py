"""T03 专用临时库夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库而不是复用 `pl_test`：
  - `pl_test` 是 T00 的共享夹具库（`migrated_engine`），T01 已保证零污染；
    T03 同样不在共享库里建表或写数据。
  - 因此这里在同一个本机测试集群上建 `pl_test_t03_<pid>`（外加一个
    `pl_test_t03_<pid>_second`，供「另一浏览器 / 第二个连接」类用例使用），
    跑真实迁移后再补齐缺失的表，用例结束即 drop。两个名字通过 T00 的
    `register_temp_database` 登记，并再经 `assert_test_database_url` 校验。
    **名字里带 pytest 进程的 pid**：同机并行跑测试时不会互相 drop 对方的库
    （T00 已确认 `database ... does not exist` 属于并发共用固定库名的现象）。

关于「补齐缺失的表」：T03 **不自己写迁移**（模型与迁移由 T00 集成）。
在集成生成迁移之前，`moments` / `moment_media` / `moment_tags` 只存在于
`Base.metadata` 里；这里用 `create_all(checkfirst=True)` 把它们补进临时库。
`t03_schema_report()["created_by_fallback"]` 会如实报告补了哪些表 ——
集成迁移落地后该列表为空，届时这些表就完全由真实迁移建出。

一旦迁移落库，`create_all(checkfirst=True)` **不会修改已存在的表**，
因此如果迁移建出的结构与模型不一致（缺列 / 缺约束），用例会因为真实约束缺失而失败。
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app import model_registry
from app.core.config import Settings
from app.core.db import assert_test_database_url, create_session_factory  # noqa: F401
from app.modules.moments import models as moments_models
from tests.core.t01_db import (  # noqa: F401  —— 复用 T00 的建库 / 迁移工具
    _run_migrations,
    create_database,
    drop_database,
    register_temp_database,
)

# 临时库名走 T00 提供的逐包登记（不编辑共享白名单常量，避免多包并行时写-写争用）。
# `register_temp_database` 会先按 `assert_test_database_url` 的同一套规则校验库名。
#
# **名字里带 pid**：多个 agent（T03 / T04 / T00 的全量串行跑）会在同一台机器上
# 同时跑 pytest，固定库名意味着「我把库 drop 掉的同时别人正在用」。T00 已确认
# `database ... does not exist` 是并发共用固定库名的必然结果，而不是任何人的缺陷；
# 带 pid 之后，每个 pytest 进程只操作自己的库，这个干扰从根上消失。
# 库名仍含 `test` 标记，仍会被 `assert_test_database_url` 接受。
_PID = os.getpid()
T03_DATABASE_NAME = register_temp_database(f"pl_test_t03_{_PID}")
T03_SECOND_DATABASE_NAME = register_temp_database(f"pl_test_t03_{_PID}_second")

# T03 自己的模型模块。等 T00 写入 MODEL_MODULES 后这里仍然显式列出，
# 目的不是绕过集成，而是让「模型没登记」这件事在测试报告里看得见。
T03_MODEL_MODULES = ("app.modules.moments.models",)

MOMENTS_TABLES = tuple(
    name for name in ("moments", "moment_media", "moment_tags")
)


FK_TARGET_STUBS = ("admin_users", "media", "tags")


def _local_metadata_with_stubs():
    """声明 FK 目标表的**最小替身**，再把 T03 的三张表复制进来。

    为什么需要替身：`to_metadata()` 复制 `moments` 时必须能解析
    `ForeignKey("admin_users.id")` 之类的目标，而这些表属于 T01 的模块。
    替身只在内存里用于生成 DDL，不会创建、不会改动任何真实表，
    也不会污染 `Base.metadata`（Alchemy 的模型注册表）。
    """
    from sqlalchemy import Column, MetaData, Table, Uuid

    from app.core.db import NAMING_CONVENTION

    local = MetaData(naming_convention=NAMING_CONVENTION)
    for name in FK_TARGET_STUBS:
        Table(name, local, Column("id", Uuid(as_uuid=True), primary_key=True))
    for name in MOMENTS_TABLES:
        moments_models.Base.metadata.tables[name].to_metadata(local)
    return local


def ensure_moments_tables(engine: Engine) -> list[str]:
    """跑完迁移后补齐缺失的表，返回被补出来的表名（空列表 = 迁移已经覆盖）。

    **只补齐 T03 自己的三张表**，不是 `create_all`：
    T01 的共享守卫用例会断言「已注册的表集合 == 冻结清单」，
    因此这里不能顺手把别人的表也建出来，更不能假装迁移已经生成。

    DDL 来自一张独立的 MetaData（见 `_local_metadata_with_stubs`），
    因此表的列与约束与模型定义一致，约束名也和集成迁移将要生成的形状相同，
    测试里可以直接按名字断言。FK 目标表用替身参与编译，`create_all` 只建
    `MOMENTS_TABLES` 里的三张，替身不会被真的创建。
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
    missing = [name for name in MOMENTS_TABLES if name not in existing]
    if missing:
        local.create_all(engine, tables=[local.tables[name] for name in missing])
    return missing


@pytest.fixture(scope="session")
def t03_database_url(test_database_url: str) -> str:
    """T03 专用临时库（真实迁移 + 补齐自己的三张表）。用例结束即 drop。"""
    url = create_database(test_database_url, T03_DATABASE_NAME)
    assert_test_database_url(url)
    yield url
    drop_database(test_database_url, T03_DATABASE_NAME)


@pytest.fixture(scope="session")
def t03_schema_report(t03_database_url: str) -> dict[str, object]:
    """`created_by_fallback` 非空说明集成迁移还没有覆盖 T03 的表。"""
    _run_migrations(t03_database_url)
    engine = create_engine(t03_database_url, pool_pre_ping=True, future=True)
    try:
        fallback = ensure_moments_tables(engine)
    finally:
        engine.dispose()
    return {"database_url": t03_database_url, "created_by_fallback": fallback}


@pytest.fixture(scope="session")
def t03_engine(t03_database_url: str, t03_schema_report: dict[str, object]) -> Engine:
    engine = create_engine(t03_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def t03_settings(t03_database_url: str, tmp_path) -> Settings:
    """T03 的测试配置：指向 **T03 自己的临时库**，媒体根指向临时目录。

    刻意不复用 `t01_settings`：那个夹具依赖 T01 的临时库，而全量测试跑完 T01 目录后
    该库会被 drop（T01 的用例故意在生产 app 上跑一次，因此它的 session 夹具是在
    全部测试结束时才 teardown）。复用会让 T03 的用例在「先跑 T01 再跑 T03」时
    连到一个已经不存在的库上 —— 这与 T03 的功能无关，纯粹是夹具耦合。
    """
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t03_database_url,
        secret_key="t03-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t03",
        media_root=str(media_root),
    )


@pytest.fixture()
def t03_session(t03_engine: Engine):
    """每个用例一个事务，结束回滚：用例之间互不影响，也不留下数据。

    「约束用例」故意让写入失败，SQLAlchemy 会把事务从连接上解绑；此时再 rollback
    会报 `transaction already deassociated`。这里用 `is_active` 判断，保持输出干净
    （失败原因仍然是那条真实的约束错误）。
    """
    connection = t03_engine.connect()
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


@pytest.fixture()
def t03_second_engine(
    t03_database_url: str, t03_schema_report: dict[str, object]
) -> Engine:
    """第二个**独立连接池**：模拟「另一台浏览器 / 另一个进程」读同一份真实数据。

    与 `t03_engine` 指向同一个库，但连接池、事务与快照互不相干 ——
    这正是「发布一条图文并在另一浏览器读取」要验证的东西。
    """
    engine = create_engine(t03_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()
