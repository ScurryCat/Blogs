"""T06 相册域测试辅助（实现见 `tests/support/t06_shared.py`，作品与相册共用）。"""

from __future__ import annotations

from tests.support.t06_shared import *  # noqa: F401,F403
from tests.support.t06_shared import __all__ as _shared_all

# 显式补充星号导入拿不到的符号：`make_admin` 等辅助来自更底层的模块。
__all__ = [*_shared_all, "make_admin", "read_session", "login_ok", "ORIGIN"]
