"""放课后测试的夹具入口。

库夹具（`pl_test_t05` 的创建 / 迁移 / 回滚）与手记共用同一份实现，定义在
`tests/journal/conftest.py`（**一个包一个临时库，不做两份**）：这里只把名字
重新暴露给 `tests/leisure/`，pytest 才能在本目录的用例里注入它们。

单独放一份而不是让 leisure 也建一个库：两个目录在同一次 pytest 会话里跑，
共用一个库既省时间，也避免「两个库各建一半表」造成夹具漂移。
"""

from __future__ import annotations

from tests.journal.conftest import (  # noqa: F401  (pytest 夹具需要在本命名空间可见)
    T05_DATABASE_NAME,
    T05_MODEL_MODULES,
    T05_SCHEMA_REPORT,
    T05_TABLES,
    _reset_public_refs,
    _truncate_t05_tables,
    anonymous_client,
    journal_client,
    journal_media_client,
    leisure_client,
    media_client,
    module_api_client,
    public_journal_client,
    public_leisure_client,
    t05_database_url,
    t05_engine,
    t05_schema_report,
    t05_session,
    t05_settings,
)

__all__ = [
    "T05_DATABASE_NAME",
    "T05_MODEL_MODULES",
    "T05_TABLES",
    "anonymous_client",
    "leisure_client",
    "media_client",
    "module_api_client",
    "public_leisure_client",
    "t05_database_url",
    "t05_engine",
    "t05_schema_report",
    "t05_session",
    "t05_settings",
]
