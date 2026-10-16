"""Alembic 运行环境。

连接串来源（按优先级）：
  1. `alembic -x db_url=...`：供测试与 CI 在隔离测试库上验证迁移。
     走这条路径时**强制校验库名带 test 标记**，避免误把生产库当测试库升级。
  2. 环境变量 DATABASE_URL（经 app.core.config 读取）：本地与生产使用。

模型来源：`app.model_registry` 的显式清单，不做目录扫描 —— 迁移必须看到与运行时
完全相同的模型集合，否则 autogenerate 会凭目录内容给出漂移的迁移。
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.core.db import Base, assert_test_database_url
from app import model_registry

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

model_registry.import_all_models()
target_metadata = Base.metadata


def _database_url() -> str:
    """决定本次迁移连接哪个库。"""
    override = context.get_x_argument(as_dictionary=True).get("db_url")
    if override:
        # 显式传入的连接串只允许指向测试库；生产迁移走 DATABASE_URL。
        assert_test_database_url(override)
        return override
    return get_settings().database_url


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连接数据库。"""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连接数据库执行迁移。"""
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
