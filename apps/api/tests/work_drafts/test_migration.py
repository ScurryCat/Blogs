"""迁移可用性：upgrade → downgrade → upgrade，且旧数据 / 旧公开范围 / 相册来源不丢。

P5 契约 §3.1 / 设计书 §3.5：
  - 新增迁移的 `down_revision` 必须接在既有单一 head（`b7c3e9a1d2f4`）之后；
  - 可 upgrade / downgrade / 再 upgrade；
  - 不丢旧内容、旧公开范围或相册来源关系。

这个用例在**独立临时库**上跑真实 Alembic 命令，不碰共享库，也不依赖模型
`create_all`（那会掩盖"迁移缺表"的问题）。
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from tests.core.t01_db import (  # noqa: F401
    _run_migrations,
    create_database,
    drop_database,
    register_temp_database,
)

API_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREVIOUS_HEAD = "b7c3e9a1d2f4"
NEW_REVISION = "747d6fd473d9"

_PID = os.getpid()
MIGRATION_DATABASE_NAME = register_temp_database(f"pl_test_c1_mig_{_PID}")


def _alembic_config(url: str) -> Config:
    config = Config(os.path.join(API_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(API_DIR, "migrations"))
    config.cmd_opts = type("_Opts", (), {"x": [f"db_url={url}"]})()
    return config


def _alembic(url: str, action: str, target: str) -> None:
    config = _alembic_config(url)
    if action == "upgrade":
        command.upgrade(config, target)
    elif action == "downgrade":
        command.downgrade(config, target)
    elif action == "current":
        command.current(config)
    else:  # pragma: no cover
        raise ValueError(action)


@pytest.fixture(scope="session")
def c1_migration_database_url(test_database_url: str) -> Iterator[str]:
    url = create_database(test_database_url, MIGRATION_DATABASE_NAME)
    yield url
    drop_database(test_database_url, MIGRATION_DATABASE_NAME)


def _table_names(engine) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )


def _seed_old_data(engine) -> dict:
    """在旧 head（`b7c3e9a1d2f4`）上写入"迁移前已存在"的内容与相册来源。"""
    owner_id = uuid.uuid4()
    media_id = uuid.uuid4()
    moment_id = uuid.uuid4()
    album_id = uuid.uuid4()
    entry_id = uuid.uuid4()
    params = {
        "owner_id": owner_id,
        "media_id": media_id,
        "moment_id": moment_id,
        "album_id": album_id,
        "entry_id": entry_id,
    }
    with engine.begin() as connection:
        connection.execute(
            text(
                "insert into admin_users (id, username, password_hash, disabled, created_at) "
                "values (:owner_id, 'migration-owner', 'x', false, now())"
            ),
            params,
        )
        connection.execute(
            text(
                "insert into media (id, owner_id, storage_key, mime_type, bytes, width, height,"
                " sha256, variants, status, created_at) values (:media_id, :owner_id,"
                " 'migration/cover', 'image/png', 10, 10, 10, :sha, '{}'::jsonb, 'ready', now())"
            ),
            {**params, "sha": "a" * 64},
        )
        connection.execute(
            text(
                "insert into moments (id, author_id, text, status, published_at, created_at,"
                " updated_at, deleted_at, version) values (:moment_id, :owner_id, '迁移前的公开动态',"
                " 'published', now() - interval '1 hour', now() - interval '2 hour', now(), null, 3)"
            ),
            params,
        )
        connection.execute(
            text(
                "insert into moment_media (moment_id, media_id, position, alt) "
                "values (:moment_id, :media_id, 0, '迁移前的图')"
            ),
            params,
        )
        connection.execute(
            text(
                "insert into journal_entries (id, entry_date, title, content_md, mood, location,"
                " status, visibility, post_id, published_at, created_at, updated_at, deleted_at,"
                " version) values (:entry_id, '2026-10-01', '迁移前的手记', '正文', '', '',"
                " 'published', 'public', null, now() - interval '1 day', now(), now(), null, 5)"
            ),
            params,
        )
        connection.execute(
            text(
                "insert into albums (id, slug, title, description, kind, position, status,"
                " published_at, created_at, updated_at, deleted_at, version) values"
                " (:album_id, 'migration-album', '迁移前的相册', '', 'photo', 0, 'published',"
                " now(), now(), now(), null, 2)"
            ),
            params,
        )
        connection.execute(
            text(
                "insert into album_media (album_id, media_id, position, alt, caption, taken_on)"
                " values (:album_id, :media_id, 0, '迁移前的相册图', '', null)"
            ),
            params,
        )
        connection.execute(
            text(
                "insert into album_media_sources (id, album_id, media_id, moment_id, created_at)"
                " values (gen_random_uuid(), :album_id, :media_id, null, now())"
            ),
            params,
        )
    return {key: str(value) for key, value in params.items()}


def _read_old_data(engine) -> dict:
    with engine.connect() as connection:
        return {
            "moments": connection.execute(
                text("select status, text, version from moments order by created_at")
            ).all(),
            "journal": connection.execute(
                text("select title, status, visibility from journal_entries")
            ).all(),
            "moment_media": connection.execute(
                text("select position, alt from moment_media")
            ).all(),
            "album_sources": connection.execute(
                text(
                    "select count(*) from album_media_sources where moment_id is null"
                )
            ).scalar_one(),
            "album_media": connection.execute(
                text("select count(*) from album_media")
            ).scalar_one(),
        }


def test_single_head_and_work_drafts_revision(c1_migration_database_url):
    script = ScriptDirectory.from_config(_alembic_config(c1_migration_database_url))
    heads = script.get_heads()
    assert heads == [NEW_REVISION], (
        f"迁移必须保持单一 head（新增 revision 接在 {PREVIOUS_HEAD} 之后）：{heads}"
    )
    revision = script.get_revision(NEW_REVISION)
    assert revision.down_revision == PREVIOUS_HEAD


def test_migration_upgrade_downgrade_upgrade_preserves_data(
    c1_migration_database_url,
):
    url = c1_migration_database_url
    engine = create_engine(url, pool_pre_ping=True, future=True)
    try:
        # 1) 先升到旧 head，写入"迁移前"的数据。
        _alembic(url, "upgrade", PREVIOUS_HEAD)
        before = _table_names(engine)
        assert "work_drafts" not in before
        params = _seed_old_data(engine)
        old_state = _read_old_data(engine)
        assert old_state["moments"] and old_state["album_sources"] == 1

        # 2) upgrade head：新增工作草稿两张表，旧数据原样保留。
        _alembic(url, "upgrade", "head")
        after_upgrade = _table_names(engine)
        assert {"work_drafts", "work_draft_media"} <= after_upgrade
        assert _read_old_data(engine) == old_state, "升级不得丢失旧内容 / 公开状态 / 相册来源"

        # 3) downgrade -1：只回退本批新增的两张表，旧数据仍在。
        _alembic(url, "downgrade", "-1")
        after_downgrade = _table_names(engine)
        assert "work_drafts" not in after_downgrade
        assert "work_draft_media" not in after_downgrade
        assert _read_old_data(engine) == old_state, "降级不得丢失旧内容 / 公开状态 / 相册来源"
        assert params["moment_id"], "旧数据主键仍然存在"

        # 4) 再 upgrade head：可重复升级，旧数据仍原样。
        _alembic(url, "upgrade", "head")
        assert {"work_drafts", "work_draft_media"} <= _table_names(engine)
        assert _read_old_data(engine) == old_state
    finally:
        engine.dispose()


def test_work_drafts_tables_are_empty_after_fresh_upgrade(
    test_database_url, c1_migration_database_url
):
    """全新库升级后两张新表为空（迁移不伪造草稿数据）。"""
    url = c1_migration_database_url
    # 重建一个全新的库，避免上一个用例写入的"迁移前数据"影响这里的断言。
    create_database(test_database_url, MIGRATION_DATABASE_NAME)
    _alembic(url, "upgrade", "head")
    engine = create_engine(url, pool_pre_ping=True, future=True)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("select count(*) from work_drafts")).scalar_one() == 0
            assert (
                connection.execute(text("select count(*) from work_draft_media")).scalar_one()
                == 0
            )
    finally:
        engine.dispose()
