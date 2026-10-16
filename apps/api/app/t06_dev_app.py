"""T06 本地验证入口（**集成登记后请删除本文件**）。

为什么需要它：T06 的模型不在 `app/model_registry.py` 的 `MODEL_MODULES` 里、路由也不在
`app/router.py` 的 `MODULE_ROUTER_TARGETS` 里（两者都归集成负责人所有，本包不改）。
因此在接线之前，只能在一个**显式的**临时入口里把 T06 的两块挂上去，才能在真实
PostgreSQL + 真实 uvicorn 上跑浏览器验收。

与生产 `app.main:app` 的差别**只有三件事**，全部在这里看得见：

  1. 导入 `app.modules.projects.models` / `app.modules.gallery.models`
     （触发 `Base.metadata` 注册，让 `--create-tables` 与 `create_all` 能看到它们）；
  2. 把 projects / gallery 的 router 加进 `module_routers`；
  3. 调用两个域的 `wiring.register()` 登记媒体公开引用检查。

它**不修改** `app/main.py`、`app/router.py`、`app/model_registry.py`，也不写迁移。
T00 按交付单 §集成申请 登记模型与路由之后，本文件即无用途，**请删除**
（交付单 §集成申请 第 5 条点名了这件事）。

用法：

    APP_ENV=dev DATABASE_URL=… SECRET_KEY=… \
      uv run --project apps/api uvicorn app.t06_dev_app:app --port 8100
"""

from __future__ import annotations

import os

# 模型注册必须在 create_app 之前（create_app 会调 model_registry.import_all_models）。
from app import model_registry  # noqa: E402
from app.core.config import Settings  # noqa: E402

T06_MODEL_MODULES = (
    "app.modules.projects.models",
    "app.modules.gallery.models",
)

model_registry.import_all_models(T06_MODEL_MODULES)


def build_t06_app(settings: Settings | None = None):
    """生产 app 的构造路径 + 显式补挂 T06 的两块。"""
    from app.modules.gallery.router import router as gallery_router
    from app.modules.gallery.wiring import register as register_gallery
    from app.modules.projects.router import router as projects_router
    from app.modules.projects.wiring import register as register_projects
    from app.main import create_app

    # 显式登记 T06 的媒体公开引用检查。重复调用会报错（那是刻意的），
    # 因此这里只在还没登记时登记。
    from app.modules.media import public_refs as media_public_refs

    registered = set(media_public_refs.registered())
    if "projects" not in registered:
        register_projects()
    if "gallery" not in registered:
        register_gallery()

    # 显式列出**全部**要挂的模块：`create_app(module_routers=...)` 是测试接线，
    # 它会跳过 `app/router.py` 的生产登记表，因此这里必须把 T06 依赖的模块一起列出来 ——
    # 第一版只列了 projects / gallery，于是 `/api/v1/media/...` 根本没有路由、
    # 匿名读图永远是 404（一度看起来像「公开引用检查没登记」，其实是路由没挂）。
    from app.modules.auth.router import router as auth_router
    from app.modules.media.router import router as media_router
    from app.modules.moments.router import router as moments_router
    from app.modules.nav.router import router as nav_router
    from app.modules.posts.router import router as posts_router
    from app.modules.tags.router import router as tags_router

    return create_app(
        settings=settings,
        module_routers={
            "auth": auth_router,
            "gallery": gallery_router,
            "media": media_router,
            "moments": moments_router,
            "nav": nav_router,
            "posts": posts_router,
            "projects": projects_router,
            "tags": tags_router,
        },
    )


app = build_t06_app()


def _create_tables() -> None:
    """在**已迁移**的 dev 库上补齐 T06 的两张新表（T00 未生成迁移前的本地手段）。

    只用 `create_all` 建 T06 自己的表，不碰别人的表；`checkfirst=True` 不会修改已存在
    的表。生产迁移由 T00 生成，这一步只是本地联调。
    """
    from sqlalchemy import create_engine

    from app.core.db import Base
    from app.core.config import get_settings

    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
    names = (
        "projects",
        "project_media",
        "albums",
        "album_media",
    )
    tables = [Base.metadata.tables[name] for name in names if name in Base.metadata.tables]
    Base.metadata.create_all(engine, tables=tables, checkfirst=True)
    engine.dispose()


if os.environ.get("T06_CREATE_TABLES") == "1":  # pragma: no cover - 本地联调开关
    _create_tables()
