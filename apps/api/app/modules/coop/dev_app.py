"""临时开发入口：在 T00 登记路由**之前**，把 coop 模块挂成一个真实可访问的 app。

用途只有一个：本包的真实浏览器验收需要一个真实 HTTP 服务
（`uvicorn app.modules.coop.dev_app:app --port 8107`）。模块测试不要用它 ——
模块测试走 `apps/api/tests/support/module_app.py`（SHARED-CONTRACTS §3）。

它与生产接线的差别只有「挂了哪些模块」：`create_app` 的中间件、错误信封、
`/api/v1` 前缀与生产完全一致。为了让头像真的可读，这里显式调用一次
`coop_wiring.register()`；生产接线由 T00 在 `app/main.py` 里调用同一个函数。

**T00 登记 `("coop", "app.modules.coop.router")` 与 wiring 之后，请删除本文件。**
"""

from __future__ import annotations

from app.core.config import get_settings
from app.core.health import router as health_router
from app.main import create_app
from app.modules.auth.router import router as auth_router
from app.modules.coop import wiring as coop_wiring
from app.modules.coop.router import router as coop_router
from app.modules.media.router import router as media_router

# 头像的公开引用：与生产接线调用同一个 register()，不另写一份判断。
coop_wiring.register()

app = create_app(
    settings=get_settings(),
    module_routers={
        "auth": auth_router,
        "coop": coop_router,
        "health": health_router,
        "media": media_router,
    },
)
