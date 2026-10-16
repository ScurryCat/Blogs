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
from app.core.http import install_private_cache_control
from app.router import mount_api

APP_TITLE = "PHANTOM LOG API"

# 内容域贡献是进程级注册表，登记一次即可。`create_app()` 在同一进程里可能被调用多次
# （模块级 app、测试、导出脚本），而 `wiring.register()` 会对重复登记报错 —— 那是
# 模块侧正确的防呆，所以调用方这里负责「只登记一次」。
_content_domains_registered = False


def register_content_domains() -> tuple[str, ...]:
    """登记内容域对共享扩展点的贡献（媒体公开引用检查、公开标签来源）。

    为什么必须显式登记：两个扩展点的默认行为都是「不贡献」—— 媒体对匿名 404，
    标签列表为空。这是刻意的安全默认（SHARED-CONTRACTS §5：默认不生效，集成负责人
    显式注册后才开放）。只注册媒体检查而漏掉标签来源，会让 `GET /api/v1/tags`
    永远返回空数组 —— 安全但坏，所以两件事收在同一个 wiring 单点里。

    幂等：同进程内只登记一次。测试若要验证「未登记 = 默认拒绝」，请用
    `create_app(module_routers={...})` 走测试接线，或显式调用各域的 `unregister()`。
    """
    global _content_domains_registered
    if _content_domains_registered:
        return ()

    from app.modules.moments import wiring as moments_wiring
    from app.modules.posts import wiring as posts_wiring

    posts_wiring.register()
    moments_wiring.register()
    _content_domains_registered = True
    return ("app.modules.posts", "app.modules.moments")


def create_app(settings: Settings | None = None, *, module_routers=None) -> FastAPI:
    """建应用。`module_routers` 仅供模块测试注入，生产走 `app/router.py` 的登记表。"""
    settings = settings or get_settings()
    settings.assert_production_safe()

    pl_logging.configure_logging()
    model_registry.import_all_models()

    production_wiring = module_routers is None

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

    # 兜底把 `Cache-Control: private, no-store` 加到 /api/v1/admin/* 的所有响应上。
    # 用中间件而不是逐端点声明：这样连异常响应（401/404/409）也带得上 —— 否则一个
    # 401 的响应体可能被共享缓存留下。01 §6：认证、草稿与管理响应不得进入共享缓存。
    install_private_cache_control(app)

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

    if production_wiring:
        # 内容域的共享扩展点贡献只在生产接线下登记；测试用显式 module_routers，
        # 由测试自己控制登记状态（未登记 = 默认拒绝 / 默认不贡献）。
        register_content_domains()

    mount_api(app, module_routers)
    return app


app = create_app()
