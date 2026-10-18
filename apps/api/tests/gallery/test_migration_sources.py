"""N3 · 迁移证据自动化：回填独立来源 + 安全降级（任务书 §4.7 / §8.5）。

在**独立临时库**上验证：

  1. 升级到 N3 之前的 head（`528a38f23614`）→ 插入历史相册图片 → 升级到 `head`：
     每一张历史图片都回填成**独立来源**（moment_id IS NULL），数量与 album_media 行一致；
  2. 降级前先制造一条「纯动态来源」的显示关系 → 降级 → 该显示关系被删除，
     独立收录的图片保留；来源表消失。这样旧 schema 不会把撤回来源当成独立来源公开；
  3. 再次升级：回填幂等（不重复），并如实记录「降级会丢失动态收录配置」这一限制。

临时库名带 pytest 进程 pid，经 T00 的白名单登记与 `assert_test_database_url` 双重校验，
用例结束即 drop —— 不碰 pl_test / pl_test_n3 等共享库。
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from tests.core.t01_db import (
    API_DIR,
    create_database,
    drop_database,
    register_temp_database,
)

UTC = timezone.utc

PRE_N3_REVISION = "528a38f23614"
N3_REVISION = "b7c3e9a1d2f4"

_PID = os.getpid()
MIGRATION_DATABASE_NAME = register_temp_database(f"pl_test_n3_mig_{_PID}")


def _alembic_config(url: str) -> Config:
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    config.cmd_opts = type("_Opts", (), {"x": [f"db_url={url}"]})()
    return config


def _table_exists(engine: Engine, name: str) -> bool:
    with engine.connect() as connection:
        return (
            connection.execute(
                text(
                    "select count(*) from information_schema.tables "
                    "where table_schema = current_schema() and table_name = :name"
                ),
                {"name": name},
            ).scalars().one()
            > 0
        )


def _count(engine: Engine, sql: str, **params) -> int:
    with engine.connect() as connection:
        return int(connection.execute(text(sql), params).scalars().one())


def _seed_pre_n3_history(engine: Engine) -> dict[str, uuid.UUID]:
    """在 N3 之前的 schema 里插入两条相册、三张图、三条相册关系（历史数据）。"""
    owner_id = uuid.uuid4()
    media_ids = [uuid.uuid4() for _ in range(3)]
    album_ids = [uuid.uuid4() for _ in range(2)]
    now = datetime.now(UTC)
    with engine.begin() as connection:
        connection.execute(
            text(
                "insert into admin_users (id, username, password_hash, disabled, created_at) "
                "values (:id, :username, :password_hash, false, :now)"
            ),
            {
                "id": owner_id,
                "username": "n3-migration-owner",
                "password_hash": "x" * 40,
                "now": now,
            },
        )
        for index, media_id in enumerate(media_ids):
            connection.execute(
                text(
                    "insert into media "
                    "(id, owner_id, storage_key, mime_type, bytes, width, height, sha256, "
                    " variants, status, created_at, deleted_at) "
                    "values (:id, :owner_id, :storage_key, 'image/png', 100, 800, 600, "
                    "        :sha256, '{}'::jsonb, 'ready', :now, null)"
                ),
                {
                    "id": media_id,
                    "owner_id": owner_id,
                    "storage_key": f"m/{media_id}.png",
                    "sha256": f"{index:064d}",
                    "now": now,
                },
            )
        for index, album_id in enumerate(album_ids):
            connection.execute(
                text(
                    "insert into albums "
                    "(id, slug, title, description, kind, position, status, published_at, "
                    " created_at, updated_at, deleted_at, version) "
                    "values (:id, :slug, :title, '', 'photo', :position, 'published', :now, "
                    "        :now, :now, null, 1)"
                ),
                {
                    "id": album_id,
                    "slug": f"migration-album-{index}",
                    "title": f"迁移相册 {index}",
                    "position": index,
                    "now": now,
                },
            )
        # 三条历史相册关系：第一册 2 张、第二册 1 张。
        relations = [
            (album_ids[0], media_ids[0], 0),
            (album_ids[0], media_ids[1], 1),
            (album_ids[1], media_ids[2], 0),
        ]
        for album_id, media_id, position in relations:
            connection.execute(
                text(
                    "insert into album_media "
                    "(album_id, media_id, position, alt, caption, taken_on) "
                    "values (:album_id, :media_id, :position, :alt, '', null)"
                ),
                {
                    "album_id": album_id,
                    "media_id": media_id,
                    "position": position,
                    "alt": f"历史照片 {position}",
                },
            )
    return {"owner_id": owner_id, "media_ids": media_ids, "album_ids": album_ids}


@pytest.mark.database
def test_migration_backfills_independent_sources_and_downgrade_stays_safe(
    test_database_url: str,
) -> None:
    database_url = create_database(test_database_url, MIGRATION_DATABASE_NAME)
    engine = create_engine(database_url, pool_pre_ping=True, future=True)
    try:
        # --- 升级到 N3 之前 -------------------------------------------------
        command.upgrade(_alembic_config(database_url), PRE_N3_REVISION)
        assert not _table_exists(engine, "album_media_sources")
        seed = _seed_pre_n3_history(engine)
        assert _count(engine, "select count(*) from album_media") == 3

        # --- 升级到 N3（N3 之后可能还有别的迁移：断言的是「升到了当前 head」）--
        command.upgrade(_alembic_config(database_url), "head")
        assert _table_exists(engine, "album_media_sources")
        # head 会随新迁移变化，这里动态取当前 head，避免每加一个迁移就要改本断言。
        current_head = ScriptDirectory.from_config(
            _alembic_config(database_url)
        ).get_current_head()
        assert current_head is not None
        with engine.connect() as connection:
            version = connection.execute(
                text("select version_num from alembic_version")
            ).scalars().one()
        assert version == current_head

        backfilled = _count(engine, "select count(*) from album_media_sources")
        assert backfilled == 3, "迁移前已有的每一张相册图片都必须回填为独立来源"
        assert (
            _count(
                engine,
                "select count(*) from album_media_sources where moment_id is null",
            )
            == 3
        )
        with engine.connect() as connection:
            relations = connection.execute(
                text(
                    "select am.album_id, am.media_id from album_media am "
                    "left join album_media_sources s "
                    "  on s.album_id = am.album_id and s.media_id = am.media_id "
                    "where s.id is null"
                )
            ).all()
        assert relations == [], "不应存在没有来源的相册关系"

        # --- 制造一条「纯动态来源」关系，验证降级安全性 --------------------
        moment_id = uuid.uuid4()
        dynamic_media_id = uuid.uuid4()
        dynamic_album_id = seed["album_ids"][0]
        now = datetime.now(UTC)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "insert into media "
                    "(id, owner_id, storage_key, mime_type, bytes, width, height, sha256, "
                    " variants, status, created_at, deleted_at) "
                    "values (:id, :owner_id, :storage_key, 'image/png', 100, 800, 600, "
                    "        :sha256, '{}'::jsonb, 'ready', :now, null)"
                ),
                {
                    "id": dynamic_media_id,
                    "owner_id": seed["owner_id"],
                    "storage_key": f"m/{dynamic_media_id}.png",
                    "sha256": "9" * 64,
                    "now": now,
                },
            )
            connection.execute(
                text(
                    "insert into moments "
                    "(id, author_id, text, status, published_at, created_at, updated_at, "
                    " deleted_at, version) "
                    "values (:id, :author_id, '动态来源', 'published', :now, :now, :now, null, 1)"
                ),
                {"id": moment_id, "author_id": seed["owner_id"], "now": now},
            )
            connection.execute(
                text(
                    "insert into album_media "
                    "(album_id, media_id, position, alt, caption, taken_on) "
                    "values (:album_id, :media_id, 5, '动态收录', '', null)"
                ),
                {"album_id": dynamic_album_id, "media_id": dynamic_media_id},
            )
            connection.execute(
                text(
                    "insert into album_media_sources "
                    "(id, album_id, media_id, moment_id, created_at) "
                    "values (:id, :album_id, :media_id, :moment_id, :now)"
                ),
                {
                    "id": uuid.uuid4(),
                    "album_id": dynamic_album_id,
                    "media_id": dynamic_media_id,
                    "moment_id": moment_id,
                    "now": now,
                },
            )
        assert _count(engine, "select count(*) from album_media") == 4

        # --- 降级：来源表消失，纯动态来源的显示关系被安全清理 --------------
        command.downgrade(_alembic_config(database_url), PRE_N3_REVISION)
        assert not _table_exists(engine, "album_media_sources")
        remaining_relations = _count(engine, "select count(*) from album_media")
        assert remaining_relations == 3, (
            "降级必须删除没有独立来源的显示关系，避免旧 schema 把撤回来源当成独立收录公开"
        )
        with engine.connect() as connection:
            pure_dynamic_gone = connection.execute(
                text(
                    "select count(*) from album_media where media_id = :media_id"
                ),
                {"media_id": dynamic_media_id},
            ).scalars().one()
        assert pure_dynamic_gone == 0
        # 独立收录的历史关系仍在（降级不销毁迁移前数据）。
        assert (
            _count(
                engine,
                "select count(*) from album_media where album_id = :album_id",
                album_id=seed["album_ids"][1],
            )
            == 1
        )

        # --- 再升级：回填幂等，且如实记录「动态收录配置已在降级中丢失」 ----
        command.upgrade(_alembic_config(database_url), "head")
        assert _count(engine, "select count(*) from album_media_sources") == 3
        assert (
            _count(
                engine,
                "select count(*) from album_media_sources where moment_id is not null",
            )
            == 0
        ), "降级会丢失动态收录配置（限制已在报告 §8 记录），重新升级后不会复活"
    finally:
        engine.dispose()
        drop_database(test_database_url, MIGRATION_DATABASE_NAME)
