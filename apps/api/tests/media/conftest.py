"""T01 隔离夹具（真实 PostgreSQL）。

夹具实现见 `tests/core/t01_db.py`；这里只把它们暴露给本目录的用例。
"""

from __future__ import annotations

import pytest

from app.modules.media import public_refs as media_public_refs
from app.modules.posts import wiring as posts_wiring
from app.modules.tags import service as tags_service
from tests.core.t01_db import (  # noqa: F401  —— pytest 通过 conftest 命名空间发现夹具
    t01_database_url,
    t01_empty_database_url,
    t01_engine,
    t01_schema_report,
    t01_session,
    t01_settings,
)


@pytest.fixture(autouse=True)
def isolated_public_contributions():
    """媒体权限用例必须能控制「哪些域已登记」。

    每个用例都从「什么都没登记」（安全默认拒绝）开始；结束时把登记恢复到
    T00 接线后的状态，避免污染同一进程里后面的用例。
    """
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    yield
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    posts_wiring.register()
