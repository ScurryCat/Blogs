"""管理侧媒体列表 / 详情（P5 契约 §3.4：共享图片选择器的数据面）。

覆盖：
  - `GET /admin/media`：默认 limit 12、最大 30（超出 → 422），`created_at DESC, id DESC`
    分页 + 不透明游标；列表项带 `publicly_referenced`；
  - `GET /admin/media/{id}`：详情带 `publicly_referenced` / 尺寸 / 状态；非本人 → 404；
  - 鉴权：匿名 401；响应 `private, no-store`；
  - 不改变现有上传接口契约（上传测试见 test_upload_api.py）。

用**本文件自带的临时库**而不是 `tests/media` 的共享 T01 夹具库：
列表用例需要真实提交多条媒体，不应把数据留给同包的其他用例。
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import create_session_factory
from app.core.deps import get_session, get_settings_dep
from app.modules.auth.models import AdminUser
from app.modules.auth.router import router as auth_router
from app.modules.media import public_refs as media_public_refs
from app.modules.media.models import Media
from app.modules.media.router import router as media_router
from tests.auth.helpers import login_ok, make_admin
from tests.core.t01_db import (  # noqa: F401
    _run_migrations,
    assert_error,
    create_database,
    drop_database,
    module_api_client,
    register_temp_database,
)
from tests.media.helpers import make_media_row

UTC = timezone.utc
ADMIN_MEDIA = "/api/v1/admin/media"

_PID = os.getpid()
MEDIA_ADMIN_DATABASE_NAME = register_temp_database(f"pl_test_c1_media_{_PID}")


@pytest.fixture(scope="session")
def media_admin_database_url(test_database_url: str) -> Iterator[str]:
    url = create_database(test_database_url, MEDIA_ADMIN_DATABASE_NAME)
    _run_migrations(url)
    yield url
    drop_database(test_database_url, MEDIA_ADMIN_DATABASE_NAME)


@pytest.fixture(scope="session")
def media_admin_engine(media_admin_database_url: str) -> Iterator[Engine]:
    engine = create_engine(media_admin_database_url, pool_pre_ping=True, future=True)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def media_admin_session(media_admin_engine: Engine) -> Iterator[Session]:
    session = create_session_factory(media_admin_engine)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        with media_admin_engine.connect() as connection:
            connection.execute(
                text('TRUNCATE "admin_users", "media", "sessions", "audit_events" CASCADE')
            )
            connection.commit()


@pytest.fixture()
def media_admin_settings(media_admin_database_url: str, tmp_path) -> Settings:
    media_root = tmp_path / "media"
    media_root.mkdir(parents=True, exist_ok=True)
    return Settings(
        app_env="test",
        database_url=media_admin_database_url,
        secret_key="c1-media-test-secret-not-used-anywhere-0123456789",
        app_version="0.0.0-c1-media",
        media_root=str(media_root),
    )


@contextmanager
def admin_client(
    settings: Settings, session: Session, *, username: str = "media-owner"
) -> Iterator[tuple[TestClient, AdminUser]]:
    user = (
        session.execute(select(AdminUser).where(AdminUser.username == username))
        .scalars()
        .first()
    )
    if user is None:
        user = make_admin(session, username=username)
    with module_api_client(
        settings, session, ("auth", auth_router), ("media", media_router)
    ) as client:
        login_ok(client, username=username)
        yield client, user


@pytest.fixture(autouse=True)
def _reset_public_refs() -> Iterator[None]:
    media_public_refs.reset()
    yield
    media_public_refs.reset()


def _make_media(
    session: Session, owner: AdminUser, *, minutes_ago: int = 0, **kwargs
) -> Media:
    media = make_media_row(session, owner_id=owner.id, **kwargs)
    media.created_at = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    session.flush()
    return media


# --- 列表 -------------------------------------------------------------------


def test_list_default_pagination_and_order(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, owner):
        oldest = _make_media(media_admin_session, owner, minutes_ago=3)
        middle = _make_media(media_admin_session, owner, minutes_ago=2)
        newest = _make_media(media_admin_session, owner, minutes_ago=1)
        media_admin_session.commit()

        response = client.get(ADMIN_MEDIA)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert [item["id"] for item in payload["items"]] == [
            str(newest.id),
            str(middle.id),
            str(oldest.id),
        ]
        assert payload["next_cursor"] is None
        assert response.headers["Cache-Control"] == "private, no-store"

        item = payload["items"][0]
        assert item["publicly_referenced"] is False
        assert item["width"] > 0 and item["height"] > 0
        assert item["status"] == "ready"
        assert item["original_url"].startswith("/api/v1/media/")


def test_list_limit_and_cursor(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, owner):
        for index in range(3):
            _make_media(media_admin_session, owner, minutes_ago=index)
        media_admin_session.commit()

        first = client.get(ADMIN_MEDIA, params={"limit": 2})
        assert first.status_code == 200, first.text
        first_page = first.json()
        assert len(first_page["items"]) == 2
        assert first_page["next_cursor"]

        second = client.get(
            ADMIN_MEDIA, params={"limit": 2, "cursor": first_page["next_cursor"]}
        )
        assert second.status_code == 200, second.text
        second_page = second.json()
        assert len(second_page["items"]) == 1
        assert second_page["next_cursor"] is None

        seen = {item["id"] for item in first_page["items"]} | {
            item["id"] for item in second_page["items"]
        }
        assert len(seen) == 3


def test_list_limit_above_max_is_422(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, _owner):
        response = client.get(ADMIN_MEDIA, params={"limit": 31})
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "UNPROCESSABLE"
        assert any("limit" in key for key in response.json()["error"]["fields"])


def test_list_status_filter_and_invalid_value(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, owner):
        _make_media(media_admin_session, owner)
        _make_media(media_admin_session, owner, status="processing")
        media_admin_session.commit()

        ready_only = client.get(ADMIN_MEDIA, params={"status": "ready"})
        assert ready_only.status_code == 200, ready_only.text
        assert all(item["status"] == "ready" for item in ready_only.json()["items"])
        assert len(ready_only.json()["items"]) == 1

        invalid = client.get(ADMIN_MEDIA, params={"status": "unknown"})
        assert invalid.status_code == 422, invalid.text
        assert invalid.json()["error"]["code"] == "UNPROCESSABLE"


def test_list_publicly_referenced_flag(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, owner):
        referenced = _make_media(media_admin_session, owner, minutes_ago=1)
        unreferenced = _make_media(media_admin_session, owner, minutes_ago=0)
        media_admin_session.commit()
        # 模拟某个已注册的内容域声明 referenced 是公开引用。
        media_public_refs.register(
            "c1-test-domain", lambda session, media_id: media_id == referenced.id
        )

        response = client.get(ADMIN_MEDIA)
        assert response.status_code == 200, response.text
        flags = {item["id"]: item["publicly_referenced"] for item in response.json()["items"]}
        assert flags[str(referenced.id)] is True
        assert flags[str(unreferenced.id)] is False


def test_list_only_own_media(media_admin_settings, media_admin_session):
    with admin_client(
        media_admin_settings, media_admin_session, username="media-owner"
    ) as (client, owner):
        own = _make_media(media_admin_session, owner)
        other_owner = make_admin(media_admin_session, username="media-other")
        foreign = _make_media(media_admin_session, other_owner)
        media_admin_session.commit()

        listed = client.get(ADMIN_MEDIA)
        ids = {item["id"] for item in listed.json()["items"]}
        assert ids == {str(own.id)}
        detail = client.get(f"{ADMIN_MEDIA}/{foreign.id}")
        assert detail.status_code == 404, detail.text

        detail_ok = client.get(f"{ADMIN_MEDIA}/{own.id}")
        assert detail_ok.status_code == 200, detail_ok.text
        assert detail_ok.json()["id"] == str(own.id)


# --- 详情 -------------------------------------------------------------------


def test_detail_includes_publicly_referenced(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, owner):
        media = _make_media(media_admin_session, owner)
        media_admin_session.commit()
        media_public_refs.register(
            "c1-test-domain", lambda session, media_id: media_id == media.id
        )

        response = client.get(f"{ADMIN_MEDIA}/{media.id}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["publicly_referenced"] is True
        assert payload["status"] == "ready"
        assert payload["mime_type"] == "image/png"
        assert payload["width"] and payload["height"]
        assert response.headers["Cache-Control"] == "private, no-store"


def test_detail_unknown_or_deleted_media_404(media_admin_settings, media_admin_session):
    with admin_client(media_admin_settings, media_admin_session) as (client, owner):
        deleted = _make_media(media_admin_session, owner, deleted_at=datetime.now(UTC))
        media_admin_session.commit()

        assert client.get(f"{ADMIN_MEDIA}/{uuid.uuid4()}").status_code == 404
        assert client.get(f"{ADMIN_MEDIA}/not-a-uuid").status_code == 404
        assert client.get(f"{ADMIN_MEDIA}/{deleted.id}").status_code == 404


def test_anonymous_media_admin_access_is_401(media_admin_settings, media_admin_session):
    from tests.support.module_app import module_client

    client = module_client(
        media_admin_settings, ("auth", auth_router), ("media", media_router)
    )
    try:
        assert client.get(ADMIN_MEDIA).status_code == 401
        assert client.get(f"{ADMIN_MEDIA}/{uuid.uuid4()}").status_code == 401
    finally:
        client.close()


def test_error_envelope_401(media_admin_settings, media_admin_session):
    from tests.support.module_app import module_client

    client = module_client(
        media_admin_settings, ("auth", auth_router), ("media", media_router)
    )
    try:
        body = assert_error(client.get(ADMIN_MEDIA), status=401, code="UNAUTHORIZED")
        assert body["request_id"]
    finally:
        client.close()
