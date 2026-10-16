"""T08 夹具（真实 PostgreSQL，绝不用 SQLite）。

夹具实现见 `t08_db.py`；这里把它们暴露给本目录的用例，并把共享注册表恢复到
「没有任何额外登记」的状态，避免用例之间互相污染权限判断。

**只跑自己的目录**：`pytest apps/api/tests/messaging`。
全量套件由 T00 在无人并发时串行运行（并发共用库名会让各包的临时库互相 drop，
见 T00 的说明与 T03 交付单 §5 的实测记录）。
"""

from __future__ import annotations

import pytest

from app.modules.media import public_refs as media_public_refs
from app.modules.messaging.config import MessagingSettings
from app.modules.posts import wiring as posts_wiring
from app.modules.tags import service as tags_service
from tests.core.t01_db import (  # noqa: F401  —— T00/T01 的共享夹具
    t01_database_url,
    t01_empty_database_url,
    t01_engine,
    t01_schema_report,
    t01_session,
    t01_settings,
)
from tests.messaging.t08_db import (  # noqa: F401  —— T08 专用临时库夹具
    t08_clean_tables,
    t08_database_url,
    t08_engine,
    t08_schema_report,
    t08_session,
    t08_session_factory,
    t08_settings,
)


@pytest.fixture(autouse=True)
def isolated_content_domains():
    """每个用例都从「什么都没有登记」（安全默认拒绝）开始，结束时恢复 T00 接线后的状态。

    与真实生产接线的差别是**故意的**：T08 的用例要能验证「T08 没有向共享注册表
    贡献任何条目」，而注册表的内容取决于别的包有没有登记过。
    """
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    yield
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    posts_wiring.register()


@pytest.fixture()
def t08_msg_settings() -> MessagingSettings:
    """默认走**模拟服务**（不联网、不计费），限额与超时取模块默认值。

    每个用例拿到一个新的实例，因此单独改某个字段不会影响别的用例。
    """
    return MessagingSettings()
