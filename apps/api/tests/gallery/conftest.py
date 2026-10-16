"""T06 · 作品域的隔离夹具（真实 PostgreSQL）。

夹具实现见 `tests/core/t01_db.py`（T00/T01 共享）与 `tests/support/t06_db.py`（T06 专用临时库）。
这里只把它们暴露给本目录的用例，并把共享注册表恢复到「T00 接线后的状态」，
避免用例之间互相污染权限。
"""

from __future__ import annotations

import pytest

from app.modules.media import public_refs as media_public_refs
from app.modules.moments import wiring as moments_wiring
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
from tests.support.t06_db import (  # noqa: F401  —— T06 专用临时库夹具
    t06_database_url,
    t06_engine,
    t06_schema_report,
    t06_second_engine,
    t06_session,
    t06_settings,
)


@pytest.fixture(autouse=True)
def isolated_content_domains():
    """每个用例都从「什么都没有登记」（安全默认拒绝）开始。

    这与真实生产接线的差别是**故意的**：T06 的用例必须能分别验证

      - 未登记 → 匿名读作品 / 相册图片 404；
      - 只登记 articles（T01 的 posts）→ 仍然 404（T06 的域没登记）；
      - 登记 T06 的 projects / gallery → 可读；

    否则「公开作品图片对匿名可读」这件事根本没被测到，只是碰巧因为注册表里有别人
    的检查器而通过。结束时恢复到 T00 接线后的状态（posts + moments 已登记）。

    两个注册表都要清：`media.public_refs` 与 `tags.public_tag_sources`。
    后者虽然与 T06 无关，但 `create_app` 的接线会重复登记 `posts` 而报错 ——
    那是 T01 刻意的防呆，测试要自己保证回到干净状态。
    """
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    yield
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    posts_wiring.register()
    moments_wiring.register()
