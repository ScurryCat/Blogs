"""readiness 端点的真实检查（T01 任务卡第 8 条、06 §1 / §3、ACCEPTANCE §2）。

断言的目标不是「端点存在」，而是：
  - DB 可用 + schema 已迁移 + 媒体目录可写 → 200 ready；
  - 三者任一不满足 → 503 not_ready，并且**指出是哪一项**；
  - 未就绪响应里不出现路径、连接串、库名、表名或异常文本；
  - `/health/ready` 确实挂在 `/api/v1` 下，`/health/live` 仍由核心 router 负责。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.core.config import Settings
from app.core.health import (
    CHECK_DATABASE,
    CHECK_MEDIA_STORAGE,
    CHECK_SCHEMA,
    STATUS_MISSING,
    STATUS_NOT_MIGRATED,
    STATUS_NOT_WRITABLE,
    STATUS_OK,
    STATUS_UNAVAILABLE,
    readiness_router,
)
from app.core.db import make_url  # noqa: F401  （保持与生产同一套 URL 解析）
from tests.core.t01_db import module_api_client

READY_PATH = "/api/v1/health/ready"


def _client(settings: Settings, session, *, engine=None, media_root: Path | None = None):
    router = readiness_router(
        settings_provider=lambda: settings,
        engine_provider=(lambda: engine) if engine is not None else (lambda: _unreachable()),
        media_root_provider=(lambda _settings: media_root) if media_root is not None else None,
    )
    return module_api_client(settings, session, ("health", router))


def _unreachable():
    """指向一个没有监听的端口：连接立即被拒绝，模拟 DB 不可用。"""
    return create_engine(
        "postgresql+psycopg://pl@127.0.0.1:55433/pl_test_unreachable",
        connect_args={"connect_timeout": 2},
    )


def test_ready_when_database_schema_and_media_are_ok(t01_settings, t01_session, t01_engine):
    with _client(t01_settings, t01_session, engine=t01_engine) as client:
        response = client.get(READY_PATH)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"] == {
        CHECK_DATABASE: STATUS_OK,
        CHECK_SCHEMA: STATUS_OK,
        CHECK_MEDIA_STORAGE: STATUS_OK,
    }
    assert body["service"] == "phantom-log-api"
    assert body["checked_at"].endswith("Z")
    assert response.headers["cache-control"] == "no-store"


def test_not_ready_when_database_is_unreachable(t01_settings, t01_session):
    with _client(t01_settings, t01_session, engine=_unreachable()) as client:
        response = client.get(READY_PATH)
    assert response.status_code == 503, response.text
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"][CHECK_DATABASE] == STATUS_UNAVAILABLE
    assert body["checks"][CHECK_SCHEMA] == STATUS_NOT_MIGRATED


def test_not_ready_when_schema_is_not_migrated(
    t01_settings, t01_session, t01_empty_database_url
):
    """空库（没有任何表 / 没有 alembic_version）必须报 not_migrated，而不是 ready。"""
    empty_engine = create_engine(t01_empty_database_url, pool_pre_ping=True)
    try:
        with _client(t01_settings, t01_session, engine=empty_engine) as client:
            response = client.get(READY_PATH)
    finally:
        empty_engine.dispose()
    assert response.status_code == 503, response.text
    body = response.json()
    assert body["checks"][CHECK_SCHEMA] == STATUS_NOT_MIGRATED
    assert body["checks"][CHECK_DATABASE] == STATUS_OK  # 库本身是通的，问题在 schema


def test_not_ready_when_media_root_is_missing(t01_settings, t01_session, t01_engine, tmp_path):
    missing = tmp_path / "not-mounted-media-volume"
    with _client(t01_settings, t01_session, engine=t01_engine, media_root=missing) as client:
        response = client.get(READY_PATH)
    assert response.status_code == 503, response.text
    assert response.json()["checks"][CHECK_MEDIA_STORAGE] == STATUS_MISSING


@pytest.mark.skipif(os.geteuid() == 0, reason="root 无视目录权限，无法构造只读挂载")
def test_not_ready_when_media_root_is_read_only(t01_settings, t01_session, t01_engine, tmp_path):
    read_only = tmp_path / "read-only-media"
    read_only.mkdir()
    read_only.chmod(0o500)
    try:
        with _client(t01_settings, t01_session, engine=t01_engine, media_root=read_only) as client:
            response = client.get(READY_PATH)
    finally:
        read_only.chmod(0o700)
    assert response.status_code == 503, response.text
    assert response.json()["checks"][CHECK_MEDIA_STORAGE] == STATUS_NOT_WRITABLE


def test_not_ready_response_does_not_leak_paths_or_database_names(
    t01_settings, t01_session, tmp_path
):
    """未就绪时也不能泄漏路径 / 连接串 / 库名 / 表名 / 异常文本。"""
    missing = tmp_path / "secret-media-location"
    with _client(t01_settings, t01_session, engine=_unreachable(), media_root=missing) as client:
        response = client.get(READY_PATH)
    assert response.status_code == 503
    raw = response.text
    for leaked in (
        str(missing),
        "secret-media-location",
        "pl_test_t01",
        "pl_test",
        "postgresql",
        "psycopg",
        "Traceback",
        "alembic_version",
        "admin_users",
        "posts",
        "sessions",
        ".py",
        "OSError",
        "OperationalError",
    ):
        assert leaked not in raw, f"未就绪响应泄漏了 {leaked!r}：{raw}"
    # 任何绝对路径都会带斜杠；响应体里不应出现斜杠。
    assert "/" not in raw, raw


def test_readiness_router_is_mounted_under_api_v1(t01_settings, t01_session, t01_engine):
    """路径必须是 /api/v1/health/ready（06 §1）；live 仍由 T00 的核心 router 提供。"""
    with _client(t01_settings, t01_session, engine=t01_engine) as client:
        ready = client.get(READY_PATH)
        assert ready.status_code == 200
        # live 不属于本模块（T00 的核心 router 已提供，模块测试 app 也会挂上），
        # 这里只确认本模块没有多挂一条重复或形状不同的 live。
        assert client.get("/api/v1/health/live").status_code == 200
        assert client.get("/api/v1/health").status_code == 404
        assert client.get("/api/v1/health/readiness").status_code == 404
