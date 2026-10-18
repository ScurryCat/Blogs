"""P5-C1 工作草稿测试的隔离夹具（真实 PostgreSQL，绝不用 SQLite）。

为什么自建库：`pl_test` 是集成负责人的共享夹具库；本包不往共享库里建表或写数据，
而是在同一个本机测试集群上建 **`pl_test_c1_<pid>`**（名字经 T00 的
`register_temp_database` 登记），跑真实迁移后使用，用例结束即 drop。
名字带 pytest 进程 pid：同机并行跑测试时不会互相 drop 对方的库。

为什么不用「外层事务 + 回滚」：

  service 的失败路径必须真的 `session.rollback()`（契约要求「失败整体回滚」）；
  当 session 绑定在一个手工 begin 的 Connection 上时，SQLAlchemy 的
  conditional-savepoint 只在**第一次**事务里生效 —— 一次 commit 之后再 rollback
  会把外层事务一起回滚，用例隔离反而被破坏。因此这里直接用真实连接：
  每个用例结束后 `TRUNCATE` 本包相关表（私有临时库，不会影响任何人），
  这样「提交失败后正式内容不变」是被真实事务回滚验证的。
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import create_session_factory
from app.core.deps import get_session, get_settings_dep
from tests.core.t01_db import (  # noqa: F401  —— 复用 T00 的建库 / 迁移工具
    _run_migrations,
    create_database,
    drop_database,
    register_temp_database,
)
from tests.support.module_app import build_module_app

_PID = os.getpid()
C1_DATABASE_NAME = register_temp_database(f"pl_test_c1_{_PID}")

# 本包可能写入的表。私有临时库里直接 TRUNCATE（含级联依赖表），
# 用例之间互不影响；不会碰共享库。
_CLEAN_TABLES = (
    "admin_users",
    "albums",
    "audit_events",
    "auth_rate_limits",
    "journal_entries",
    "journal_entry_media",
    "media",
    "moments",
    "moment_media",
    "moment_tags",
    "posts",
    "post_tags",
    "sessions",
    "tags",
    "work_draft_media",
    "work_drafts",
)


@pytest.fixture(scope="session")
def c1_database_url(test_database_url: str) -> Iterator[str]:
    """本包专用临时库：重建 → 真实迁移 → 用例结束 drop。"""
    url = create_database(test_database_url, C1_DATABASE_NAME)
    _run_migrations(url)
    yield url
    drop_database(test_database_url, C1_DATABASE_NAME)


@pytest.fixture(scope="session")
def c1_engine(c1_database_url: str) -> Iterator[Engine]:
    engine = create_engine(c1_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


def _truncate(engine: Engine) -> None:
    names = ", ".join(f'"{name}"' for name in _CLEAN_TABLES)
    with engine.connect() as connection:
        connection.execute(text(f"TRUNCATE {names} CASCADE"))
        connection.commit()


@pytest.fixture(autouse=True)
def c1_session(c1_engine: Engine) -> Iterator[Session]:
    """每个用例一个真实 Session；结束先回滚（释放行锁），再清空相关表。"""
    session = create_session_factory(c1_engine)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        _truncate(c1_engine)


@pytest.fixture()
def c1_settings(c1_database_url: str, tmp_path) -> Settings:
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=c1_database_url,
        secret_key="c1-test-secret-key-not-used-anywhere-0123456789",
        app_version="0.0.0-c1",
        media_root=str(media_root),
    )


@contextmanager
def _client(
    settings: Settings, session: Session, *routers: tuple[str, APIRouter]
) -> Iterator[TestClient]:
    """只挂给定模块 router 的客户端，会话依赖替换成用例的 session。"""
    app = build_module_app(settings, *routers)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_settings_dep] = lambda: settings
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture()
def c1_client(c1_settings: Settings, c1_session: Session) -> Iterator[TestClient]:
    """认证 + 工作草稿 + 媒体（公开读取路由）的测试客户端。"""
    from app.modules.auth.router import router as auth_router
    from app.modules.media.router import router as media_router
    from app.modules.work_drafts.router import router as work_drafts_router

    with _client(
        c1_settings,
        c1_session,
        ("auth", auth_router),
        ("media", media_router),
        ("work-drafts", work_drafts_router),
    ) as client:
        yield client


@pytest.fixture()
def c1_public_client(c1_settings: Settings, c1_session: Session) -> Iterator[TestClient]:
    """只挂公开 / 管理路由的客户端（不带登录辅助）：匿名请求直接打真实鉴权依赖。"""
    from app.modules.media.router import router as media_router
    from app.modules.work_drafts.router import router as work_drafts_router

    with _client(
        c1_settings,
        c1_session,
        ("media", media_router),
        ("work-drafts", work_drafts_router),
    ) as client:
        yield client


@pytest.fixture()
def c1_session_factory(c1_engine: Engine):
    """真实连接会话工厂（无外层事务）：仅并发用例使用，写入会真正落库。"""
    return create_session_factory(c1_engine)


@pytest.fixture(autouse=True)
def _reset_public_refs() -> Iterator[None]:
    """公开引用注册表是进程级的：每个用例前后回到「默认拒绝」。

    `work_drafts` 不登记任何公开引用；这里清空是为了让「草稿图片对匿名不可读」
    在用例里是真的（而不是被别的包残留的检查器影响）。
    """
    from app.modules.media import public_refs as media_public_refs
    from app.modules.tags import service as tags_service

    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    yield
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
