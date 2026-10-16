"""路由注册。

契约（SHARED-CONTRACTS §2 / §5）：
  - 所有业务路由挂在 `/api/v1` 前缀下；网关原样转发，不剥离前缀。
  - 模块把 router 交给 T00 登记，由 T00 挂载；模块不直接改生产总路由。
  - 这里**没有** readiness 端点。数据库 / schema / 媒体是否真正可用由 T01 / T10 实现，
    不允许用永远返回 ok 的实现冒充就绪（交接计划 T00 执行清单）。
"""

from __future__ import annotations

import importlib
from datetime import datetime, timezone

from fastapi import APIRouter, FastAPI

API_V1_PREFIX = "/api/v1"

# 生产模块 router 的显式清单（模块名 → 模块路径，模块内需有 `router` 属性）。
# 按名称排序挂载，保证对外路径顺序可复现。新增模块由集成负责人写入这里。
MODULE_ROUTER_TARGETS: tuple[tuple[str, str], ...] = (
    ("auth", "app.modules.auth.router"),
    ("coop", "app.modules.coop.router"),
    ("health", "app.core.health"),
    ("journal", "app.modules.journal.router"),
    ("leisure", "app.modules.leisure.router"),
    ("media", "app.modules.media.router"),
    ("messaging", "app.modules.messaging.router"),
    ("moments", "app.modules.moments.router"),
    ("nav", "app.modules.nav.router"),
    ("posts", "app.modules.posts.router"),
    ("projects", "app.modules.projects.router"),
    ("gallery", "app.modules.gallery.router"),
    ("tags", "app.modules.tags.router"),
)


class DuplicateModuleError(RuntimeError):
    """同名模块被登记两次，或两个模块抢同一个前缀。"""


# 模块名 → router。显式登记，不做目录扫描。
_MODULE_ROUTERS: dict[str, APIRouter] = {}


def register_module_router(name: str, router: APIRouter) -> None:
    """登记一个模块 router。重复登记立即报错，避免静默覆盖别人的路由。"""
    if name in _MODULE_ROUTERS:
        raise DuplicateModuleError(f"模块 {name!r} 已登记过 router")
    for existing_name, existing in _MODULE_ROUTERS.items():
        if existing.prefix and existing.prefix == router.prefix:
            raise DuplicateModuleError(
                f"模块 {name!r} 的前缀 {router.prefix!r} 已被 {existing_name!r} 占用"
            )
    _MODULE_ROUTERS[name] = router


def registered_module_routers() -> dict[str, APIRouter]:
    """当前登记的模块 router 快照（测试与集成检查用）。"""
    return dict(_MODULE_ROUTERS)


def reset_module_routers() -> None:
    """清空登记表。仅测试使用；生产进程只在启动时登记一次。"""
    _MODULE_ROUTERS.clear()


def register_declared_modules() -> tuple[str, ...]:
    """按 MODULE_ROUTER_TARGETS 导入并登记模块 router，返回本次新登记的名字。

    重复调用安全（已登记的跳过），因此测试里反复建生产 app 不会因重复登记报错。
    """
    newly: list[str] = []
    for name, module_path in MODULE_ROUTER_TARGETS:
        if name in _MODULE_ROUTERS:
            continue
        module = importlib.import_module(module_path)
        register_module_router(name, module.router)
        newly.append(name)
    return tuple(newly)


def _health_router() -> APIRouter:
    router = APIRouter(tags=["meta"])

    @router.get("/health/live", summary="进程存活状态")
    def health_live() -> dict[str, str]:
        """只报告进程自身的存活状态（06 §1：liveness 仅判断进程是否响应）。

        不查数据库、不查媒体卷、不查 schema。**本文件刻意不提供 `/health/ready`**：
        readiness 要验证 DB 可用、schema 版本兼容与媒体目录可用，属 T01 / T10 的实现，
        用永远返回 ok 的占位实现冒充就绪被交接计划明确禁止。

        响应字段名文档未规定，此处只给最小状态，且不泄漏连接串、目录、数据库名或堆栈。
        """
        return {
            "status": "ok",
            "service": "phantom-log-api",
            "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

    return router


def build_api_router(module_routers: dict[str, APIRouter] | None = None) -> APIRouter:
    """构造 `/api/v1` 聚合 router：健康端点 + 已登记模块。

    模块顺序按登记顺序，保证多次启动路由表稳定（OrderedDict 语义）。
    """
    routers = _MODULE_ROUTERS if module_routers is None else module_routers
    api = APIRouter(prefix=API_V1_PREFIX)
    api.include_router(_health_router())
    for name in sorted(routers):
        api.include_router(routers[name])
    return api


def mount_api(app: FastAPI, module_routers: dict[str, APIRouter] | None = None) -> None:
    """把聚合 router 挂到应用上。main.py 与模块测试 app 工厂共用这一条路径。

    `module_routers=None` 表示生产接线：先按清单登记真实模块，再挂载。
    显式传入字典表示测试接线：只挂给定模块，不触碰生产登记表。
    """
    if module_routers is None:
        register_declared_modules()
    app.include_router(build_api_router(module_routers))
