"""本地验证入口：在生产 app 上补挂 nav 路由（**T00 登记路由之前**临时使用）。

为什么需要它：生产路由清单 `app/router.py: MODULE_ROUTER_TARGETS` 由 T00 拥有，
模块不能自己写进去（SHARED-CONTRACTS §2）。在集成负责人完成登记之前，本文件让
「真实 uvicorn + 真实 PostgreSQL + 真实浏览器」的验收可以现在就跑。

```sh
APP_ENV=dev DATABASE_URL=… SECRET_KEY=… \
  uv run --project apps/api uvicorn app.modules.nav.dev_app:app --port 8100
```

它**不复制**生产接线：先 `create_app()`（生产清单与内容域 wiring 原样生效），
再把本模块 router 挂到 `/api/v1`。T00 把 `("nav", "app.modules.nav.router")`
写进 `MODULE_ROUTER_TARGETS` 之后，本文件即可删除（交付单已列为集成动作）。
"""

from __future__ import annotations

from app.main import create_app
from app.modules.nav.router import router as nav_router
from app.router import API_V1_PREFIX

app = create_app()
app.include_router(nav_router, prefix=API_V1_PREFIX)
