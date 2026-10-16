"""本地验证入口：生产 app + 补挂**尚未登记**的 T05 路由。

用途：`app/router.py` 的 `MODULE_ROUTER_TARGETS` 由集成负责人拥有，T05 的
`journal` / `leisure` 还没写进去。在集成之前，本文件让我们能在**真实进程**里
验证真实浏览器行为，而不是只跑模块测试：

    APP_ENV=dev DATABASE_URL=... \
      uv run --project apps/api uvicorn app.modules.t05_dev_app:app --port 8100

它**不修改**任何生产文件：`create_app` 的 `module_routers` 参数正是模块测试用的
同一个注入点（见 `tests/support/module_app.py`）。集成负责人把两条路由写进
`MODULE_ROUTER_TARGETS` 之后，本文件即可删除（交付单 §「集成申请」已注明）。
"""

from __future__ import annotations

from app.core.config import get_settings
from app.main import create_app
from app.modules.auth.router import router as auth_router
from app.modules.journal.router import router as journal_router
from app.modules.leisure.router import router as leisure_router
from app.modules.moments.router import router as moments_router
from app.modules.media.router import router as media_router
from app.modules.nav.router import router as nav_router
from app.modules.posts.router import router as posts_router
from app.modules.tags.router import router as tags_router

# 显式清单：与 `app/router.py` 的目标表同形，只是多挂了 T05 的两条。
# 同时登记 T03 / T04 是为了在浏览器里验证「INS、导航、手记、放课后在同一站里共存」。
app = create_app(
    settings=get_settings(),
    module_routers={
        "auth": auth_router,
        "journal": journal_router,
        "leisure": leisure_router,
        "media": media_router,
        "moments": moments_router,
        "nav": nav_router,
        "posts": posts_router,
        "tags": tags_router,
    },
)
