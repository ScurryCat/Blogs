"""应用入口。

启动顺序：读配置 → 生产安全检查 → 导入全部模型（触发 Base.metadata 注册）→
挂中间件与错误处理器 → 挂 `/api/v1`。

**这里不做迁移。** 迁移是独立的一次性任务（06 §2：不在每个 worker 启动时同时执行迁移），
由 `deploy/compose.dev.yaml` 的 migrate 服务或显式命令执行。
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import model_registry
from app.core import logging as pl_logging
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers, request_id_middleware
from app.router import mount_api

APP_TITLE = "PHANTOM LOG API"


def create_app(settings: Settings | None = None, *, module_routers=None) -> FastAPI:
    """建应用。`module_routers` 仅供模块测试注入，生产走 `app/router.py` 的登记表。"""
    settings = settings or get_settings()
    settings.assert_production_safe()

    pl_logging.configure_logging()
    model_registry.import_all_models()

    app = FastAPI(
        title=APP_TITLE,
        version=settings.app_version,
        # 生产不公开交互式文档与 schema：管理端点的形状不对外发布。
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/v1/openapi.json",
    )

    app.middleware("http")(request_id_middleware)
    install_error_handlers(app)

    origins = settings.cors_origin_list()
    if origins and not settings.is_production:
        # 开发期分端口才需要 CORS，且必须显式列出来源 —— 带凭据请求不允许配成 "*"（05 §7）。
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    mount_api(app, module_routers)
    return app


app = create_app()
