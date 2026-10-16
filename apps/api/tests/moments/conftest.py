"""T03 隔离夹具（真实 PostgreSQL，绝不用 SQLite）。

夹具实现见 `tests/core/t01_db.py` 与 `tests/moments/t03_db.py`；这里只把它们暴露给
本目录的用例，并把共享注册表恢复到「T00 接线后的状态」，避免用例之间互相污染权限。

T03 自己的临时库是 **`pl_test_t03_<pid>`**：在 `t03_db.py` 里用 T00 的
`register_temp_database(...)` 逐包登记，**不需要编辑共享白名单常量**；
名字带 pytest 进程的 pid，因此同机并行跑测试时不会互相 drop 对方的库。
不复用 `pl_test`：它是 T00 的共享夹具库，T01 已保证零污染，T03 同样不往里写。
"""

from __future__ import annotations

import pytest

from app.modules.media import public_refs as media_public_refs
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
from tests.moments.t03_db import (  # noqa: F401  —— T03 专用临时库夹具
    t03_database_url,
    t03_engine,
    t03_schema_report,
    t03_second_engine,
    t03_session,
    t03_settings,
)


@pytest.fixture(autouse=True)
def isolated_content_domains():
    """每个用例都从「什么都没有登记」（安全默认拒绝）开始。

    这与真实生产接线的差别是**故意的**：T03 的用例必须能分别验证
    「未登记 → 匿名读图片 404」与「登记后 → 可读」，否则注册表本身没被测到。
    结束时恢复到 T00 接线后的状态（文章域已登记）。
    """
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    yield
    media_public_refs.reset()
    tags_service.reset_public_tag_sources()
    posts_wiring.register()
