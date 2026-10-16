"""迁移与模型同步守卫。

为什么需要它：交接计划要求单一 Alembic head，且迁移由集成负责人生成（模块不自己
写 `migrations/`）。最容易出的事故是「加了模型/字段却没生成迁移」—— 本地测试用
`create_all` 建表时一切正常，部署时却缺表缺列。这条断言把那种情况挡在测试里。

它同时守住「单一 head」：`migrated_engine` 夹具跑的是 `alembic upgrade head`，
如果存在平行 head，这一步就会失败。
"""

from __future__ import annotations

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.engine import Engine

from app.core.db import Base
from app import model_registry


@pytest.mark.database
def test_models_and_migrations_are_in_sync(migrated_engine: Engine) -> None:
    """当前模型声明必须与 `alembic upgrade head` 后的库结构完全一致。"""
    model_registry.import_all_models()

    with migrated_engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "compare_server_default": True}
        )
        differences = list(compare_metadata(context, Base.metadata))

    assert not differences, (
        "模型与迁移不一致；请重新生成迁移（apps/api/scripts 之外的生成流程见集成台账）：\n"
        + "\n".join(f"  {kind} {detail}" for kind, detail in differences)
    )


@pytest.mark.database
def test_expected_tables_exist_after_migration(migrated_engine: Engine) -> None:
    """建表迁移的可见结果：模型声明的表在库里真实存在。"""
    from sqlalchemy import text

    expected = set(model_registry.registered_tables())
    assert expected, "MODEL_MODULES 为空时表集合断言没有意义"

    with migrated_engine.connect() as connection:
        actual = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )

    missing = sorted(expected - actual)
    assert not missing, f"迁移后仍缺表：{missing}"
