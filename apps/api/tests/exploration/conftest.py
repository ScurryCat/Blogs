"""T09 · 技能与问题记录域的隔离夹具（真实 PostgreSQL）。

夹具实现见 `tests/support/t09_db.py`（T09 专用临时库）。这里只把它们暴露给本目录的
用例，并把共享注册表恢复到「T08 集成后的状态」，避免用例之间互相污染权限。
"""

from __future__ import annotations

import pytest

from app.modules.media import public_refs as media_public_refs
from app.modules.coop import wiring as coop_wiring
from app.modules.gallery import wiring as gallery_wiring
from app.modules.journal import wiring as journal_wiring
from app.modules.leisure import wiring as leisure_wiring
from app.modules.moments import wiring as moments_wiring
from app.modules.posts import wiring as posts_wiring
from app.modules.projects import wiring as projects_wiring
from app.modules.tags import service as tags_service
from tests.support.t09_db import (  # noqa: F401  —— T09 专用临时库夹具
    t09_database_url,
    t09_engine,
    t09_schema_report,
    t09_session,
    t09_settings,
)


@pytest.fixture(autouse=True)
def restored_content_domains():
    """每个用例前后把共享注册表恢复到「T08 集成后的状态」。

    T09 **不贡献**任何共享注册（`wiring.CONTRIBUTIONS` 是空元组），
    因此这里不需要为 skills / exploration 注册任何东西 ——
    恢复动作只是为了让同一个 pytest 进程里的其它用例（或 `create_app` 的接线）
    看到的注册表与生产一致。
    """
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    yield
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    posts_wiring.register()
    moments_wiring.register()
    coop_wiring.register()
    journal_wiring.register()
    leisure_wiring.register()
    projects_wiring.register()
    gallery_wiring.register()
