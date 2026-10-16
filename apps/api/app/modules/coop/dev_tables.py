"""临时工具：在集成迁移生成前，为本机 dev 库创建 / 删除 coop 两张表。

为什么需要：T00 负责生成 Alembic 迁移（SHARED-CONTRACTS §5），本包**不写 migrations/**。
在那之前，浏览器验收要有一张真实的表可用，于是这里用 `Base.metadata.create_all`
只建 `friend_links` / `friend_link_tags` 两张表 —— 不碰别人的表、不做迁移。

安全护栏与测试夹具一致：库名必须命中 `pl_test` / `test_pl` / `*_test`
（`app.core.db.assert_test_database_url`），否则拒绝执行。

    uv run --project apps/api python -m app.modules.coop.dev_tables --create
    uv run --project apps/api python -m app.modules.coop.dev_tables --drop

`--create` 只建缺失的表（`checkfirst`）；已有表不会被改写。
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import Settings, get_settings
from app.core.db import Base, assert_test_database_url

# 本模块自己的两张表；显式列出而不是扫全量 metadata（别的域的表不归这里管）。
COOP_TABLES = ("friend_links", "friend_link_tags")

# 建表前必须导入 FK 指向的表（media / admin_users），否则 SQLAlchemy 解析不了外键。
# 只导入、不创建：别的域的表由迁移负责。
SUPPORT_MODEL_MODULES = (
    "app.modules.auth.models",
    "app.modules.media.models",
    "app.modules.coop.models",
)

EXIT_OK = 0
EXIT_USAGE = 2


def _engine(settings: Settings) -> Engine:
    assert_test_database_url(settings.database_url)
    return create_engine(settings.database_url, pool_pre_ping=True, future=True)


def create_tables(engine: Engine) -> list[str]:
    from app import model_registry

    model_registry.import_all_models(SUPPORT_MODEL_MODULES)
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
        name for name in COOP_TABLES if name not in existing and name in Base.metadata.tables
    ]
    if missing:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in missing])
    return sorted(missing)


def drop_tables(engine: Engine) -> None:
    from app import model_registry

    model_registry.import_all_models(SUPPORT_MODEL_MODULES)
    Base.metadata.drop_all(engine, tables=[Base.metadata.tables[name] for name in COOP_TABLES])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="为本地 dev 库补齐 / 清理 coop 表（临时手段）")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--create", action="store_true", help="创建缺失的 coop 表")
    group.add_argument("--drop", action="store_true", help="删除 coop 表（本地清理用）")
    args = parser.parse_args(argv)

    settings = get_settings()
    engine = _engine(settings)
    try:
        if args.create:
            created = create_tables(engine)
            print(f"created: {created or '（已存在，未改动）'}")
        else:
            drop_tables(engine)
            print(f"dropped: {list(COOP_TABLES)}")
    finally:
        engine.dispose()
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
