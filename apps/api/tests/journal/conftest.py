"""T05 模块测试的隔离夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库：`pl_test` 是集成负责人的共享夹具库；T05 不往共享库里加表，也不依赖
「别人的并行改动是否刚好可用」。因此在本机测试集群上建 **`pl_test_t05`**：
库名通过共享 helper 的 `register_temp_database("pl_test_t05")` 登记（白名单可扩展，
不必改 T01 的文件），创建 / 删除直接用共享的 `create_database` / `drop_database`。

建好库后先跑 `alembic upgrade head`，再用 `Base.metadata.create_all` **补齐缺失的表**：
集成前迁移里还没有 journal / leisure 表；一旦集成方生成迁移，这里就用真实迁移建表。
`create_all(checkfirst=True)` 不会修改已存在的表 —— 如果迁移建出的表结构不对，
用例会因为缺列 / 缺约束而失败，不会被夹具悄悄「修好」。

**开发期只跑本目录**（`pytest apps/api/tests/journal apps/api/tests/leisure`）：
全量套件会连带跑其他包的固定库名夹具，并发时互相 drop 对方的库
（集成负责人负责串行跑全量）。
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

# 共享 helper 的白名单登记：不必编辑 T01 的文件，也不会和其他包抢同一份常量。
T05_DATABASE_NAME = register_temp_database("pl_test_t05")

# 依赖顺序：journal / leisure 引用 posts（长文）与 media（图片）与 auth（站主会话）。
T05_MODEL_MODULES = (
    "app.modules.auth.models",
    "app.modules.media.models",
    "app.modules.tags.models",
    "app.modules.posts.models",
    "app.modules.journal.models",
    "app.modules.leisure.models",
)

# 本包自己声明的表（显式列出，不用全量 `Base.metadata` —— 那是全进程共享的注册表，
# 别人的域只要在同一进程里被导入过就会出现在里面）。
T05_TABLES = ("journal_entries", "journal_entry_media", "leisure_entries")

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
    """跑完迁移后补齐缺失的表（集成尚未生成 T05 迁移时的临时手段）。"""
    from app import model_registry

    model_registry.import_all_models(T05_MODEL_MODULES)
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
        name for name in T05_TABLES if name not in existing and name in Base.metadata.tables
    ]
    if missing:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in missing])
    return sorted(missing)


# 供用例断言「迁移到没到位」的报告（与 T04 的 t04_schema_report 同形）。
T05_SCHEMA_REPORT: dict[str, object] = {"created_by_fallback": []}


@pytest.fixture(scope="session")
def t05_database_url(test_database_url: str) -> Iterator[str]:
    """T05 专用临时库：重建 → 迁移 → 建表 → 用例结束 drop。"""
    target = create_database(test_database_url, T05_DATABASE_NAME)

    _run_migrations(target)
    setup_engine = create_engine(target, pool_pre_ping=True, future=True)
    try:
        T05_SCHEMA_REPORT["created_by_fallback"] = _ensure_tables(setup_engine)
    finally:
        setup_engine.dispose()

    yield target

    drop_database(test_database_url, T05_DATABASE_NAME)


@pytest.fixture(scope="session")
def t05_schema_report() -> dict[str, object]:
    """哪些表是夹具补出来的（非空说明集成迁移还没覆盖 T05 的表）。"""
    return T05_SCHEMA_REPORT


@pytest.fixture(scope="session")
def t05_engine(t05_database_url: str) -> Iterator[Engine]:
    engine = create_engine(t05_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def t05_session(t05_engine: Engine) -> Iterator[Session]:
    """每个用例一个事务，结束回滚：用例之间互不影响，也不留下数据。

    **重要**：服务层的写路径会调用 `Session.commit()`（05 §4 要求「返回成功即已落库」），
    而本夹具的 session 绑定在一个外部事务的连接上 —— 提交会把外部事务一起提交，
    于是这一行的 rollback 不再能撤销它。因此这里在回滚之后**再显式清理**本包的表，
    否则上一个用例提交的行会留在库里，后面的断言就会看到不属于自己的数据
    （真实症状：`GET /journal/calendar?month=2` 多返回一个月）。
    """
    connection = t05_engine.connect()
    transaction = connection.begin()
    factory = create_session_factory(connection)  # type: ignore[arg-type]
    session = factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        _truncate_t05_tables(t05_engine)


def _truncate_t05_tables(engine: Engine) -> None:
    """清空本包的表（含关联表）。只动 T05 自己的表，不碰别人的数据。"""
    names = ", ".join(f'"{name}"' for name in T05_TABLES)
    with engine.connect() as connection:
        connection.execute(text(f"TRUNCATE {names} CASCADE"))
        connection.commit()


@pytest.fixture()
def t05_settings(t05_database_url: str, tmp_path: Path) -> Settings:
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=t05_database_url,
        secret_key="t05-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-t05",
        media_root=str(media_root),
    )


@pytest.fixture(autouse=True)
def _reset_public_refs() -> Iterator[None]:
    """公开引用注册表是进程级的：每个用例前后都回到「默认拒绝」。

    这样「未登记 = 匿名 404」这条契约在每个用例里都是真的，而不是被上一个用例
    的登记残留污染。
    """
    from app.modules.media import public_refs as media_public_refs

    media_public_refs.reset()
    yield
    media_public_refs.reset()


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
def journal_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    """手记模块 + 认证模块的测试客户端（管理端需要真实登录流程）。"""
    from app.modules.auth.router import router as auth_router
    from app.modules.journal.router import router as journal_router

    with module_api_client(
        t05_settings, t05_session, ("auth", auth_router), ("journal", journal_router)
    ) as client:
        yield client


@pytest.fixture()
def public_journal_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    """只挂手记公开路由的客户端（证明公开端点不依赖任何会话）。"""
    from app.modules.journal.router import router as journal_router

    with module_api_client(t05_settings, t05_session, ("journal", journal_router)) as client:
        yield client


@pytest.fixture()
def leisure_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    """放课后模块 + 认证模块的测试客户端。"""
    from app.modules.auth.router import router as auth_router
    from app.modules.leisure.router import router as leisure_router

    with module_api_client(
        t05_settings, t05_session, ("auth", auth_router), ("leisure", leisure_router)
    ) as client:
        yield client


@pytest.fixture()
def public_leisure_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    from app.modules.leisure.router import router as leisure_router

    with module_api_client(t05_settings, t05_session, ("leisure", leisure_router)) as client:
        yield client


@pytest.fixture()
def journal_media_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    """手记 + 媒体 + 认证：用来验证「切为 private 后图片也立即拒读」。

    单独一个夹具而不是复用 `journal_client`：媒体端点在 media 模块里，
    只有把它一起挂上，「可见性切换 → 图片权限」这条链路才是真的被 HTTP 走了一遍。
    """
    from app.modules.auth.router import router as auth_router
    from app.modules.journal.router import router as journal_router
    from app.modules.media.router import router as media_router

    with module_api_client(
        t05_settings,
        t05_session,
        ("auth", auth_router),
        ("journal", journal_router),
        ("media", media_router),
    ) as client:
        yield client


@pytest.fixture()
def anonymous_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    """**没有站主 Cookie** 的客户端，但会话依赖指向同一个事务 session。

    为什么需要它：共享客户端的 `optional_admin` 会让站主读到原图与已撤回对象
    （T01 的既定语义），所以「匿名能不能读这张图」必须用另一个客户端来问，
    否则用例会在登录态下**永远通过**，而真实匿名访客看到的是 404。

    与 `journal_media_client` 共用同一个 `t05_session`（function 级夹具在同一用例内
    是同一实例），因此两个客户端看到的是同一份数据。
    """
    from app.modules.media.router import router as media_router

    with module_api_client(t05_settings, t05_session, ("media", media_router)) as client:
        yield client


@pytest.fixture()
def media_client(t05_settings: Settings, t05_session: Session) -> Iterator[TestClient]:
    """手记 + 放课后 + 媒体 + 认证：验证「一张图被日记引用后匿名能不能读」。

    这是验收 1 / 集成矩阵「同图所有公开引用撤回 → 新匿名媒体请求不可读」需要的最小组合。
    """
    from app.modules.auth.router import router as auth_router
    from app.modules.journal.router import router as journal_router
    from app.modules.leisure.router import router as leisure_router
    from app.modules.media.router import router as media_router

    with module_api_client(
        t05_settings,
        t05_session,
        ("auth", auth_router),
        ("journal", journal_router),
        ("leisure", leisure_router),
        ("media", media_router),
    ) as client:
        yield client
