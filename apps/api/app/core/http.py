"""HTTP 响应头的共用能力：共享缓存的默认关闭（01 §6、05 §7 / §8）。

为什么要有共用件：01 §6 要求「任何认证、草稿、管理接口和认证响应都不得进入共享缓存」，
05 §7 / §8 要求管理接口与首版媒体响应都用 `private, no-store`。靠每个模块自己记得加头，
早晚会漏掉一个管理端点 —— 而漏掉的表现是**草稿被中间缓存转发给匿名访客**。

提供两层：
  1. `no_store`：FastAPI 依赖，`dependencies=[Depends(no_store)]` 即可让整个 router 生效。
  2. `PrivateCacheControlMiddleware` / `install_private_cache_control`：按路径前缀兜底，
     由集成负责人在 `create_app` 里安装，覆盖其他模块以后新增的管理端点。

两层都只是**加** `Cache-Control`，不覆盖模块自己设置的更严格策略（例如媒体响应的
`private, no-store` 与 `X-Content-Type-Options: nosniff`）。
"""

from __future__ import annotations

from fastapi import FastAPI, Response

# 管理前缀 + 认证 + 媒体：这些响应永远不能进共享缓存。
PRIVATE_PATH_PREFIXES = (
    "/api/v1/admin/",
    "/api/v1/auth/",
    "/api/v1/media/",
)

PRIVATE_CACHE_CONTROL = "private, no-store"
# 公开动态数据（文章、标签）用最严格的 no-store（01 §6）；
# 管理 / 认证 / 媒体响应额外标 private（05 §7 / §8）。
PUBLIC_CACHE_CONTROL = "no-store"

NOSNIFF = "nosniff"


def no_store(response: Response) -> None:
    """公开读取依赖：`Cache-Control: no-store`。"""
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL


def private_no_store(response: Response) -> None:
    """管理 / 认证依赖：`Cache-Control: private, no-store`。"""
    response.headers["Cache-Control"] = PRIVATE_CACHE_CONTROL


def apply_private_headers(headers: dict[str, str]) -> None:
    """给原生响应（媒体流）设置同样的私有缓存策略与防嗅探头。"""
    headers["Cache-Control"] = PRIVATE_CACHE_CONTROL
    headers["X-Content-Type-Options"] = NOSNIFF


class PrivateCacheControlMiddleware:
    """纯 ASGI 中间件：命中私有前缀且响应没自带 Cache-Control 时补上。

    只用 ASGI 接口而没有用 BaseHTTPMiddleware，避免给每个请求再加一层 task group。
    """

    def __init__(self, app, prefixes: tuple[str, ...] = PRIVATE_PATH_PREFIXES) -> None:
        self.app = app
        self.prefixes = prefixes

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # /api/v1/admin 与 /api/v1/admin/… 都要覆盖。
        path = scope.get("path", "")
        if not any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in self.prefixes):
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                if not any(key.lower() == b"cache-control" for key, _ in headers):
                    headers.append((b"cache-control", PRIVATE_CACHE_CONTROL.encode("ascii")))
                if not any(key.lower() == b"x-content-type-options" for key, _ in headers):
                    headers.append((b"x-content-type-options", NOSNIFF.encode("ascii")))
            await send(message)

        await self.app(scope, receive, send_wrapper)


def install_private_cache_control(app: FastAPI) -> None:
    """安装兜底中间件。供 `create_app` 调用（集成申请项）。"""
    app.add_middleware(PrivateCacheControlMiddleware)
