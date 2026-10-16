"""公开读取的轻量限流（05 §5 / §9）。

05 §5 要求 `POST /nav/resolve`「只接受 JSON 并实施输入校验和限流」，§9 给的起始建议是
**搜索 / 定位每 IP 每分钟 60 次**。本站的量级不需要 Redis（05 §9 末），也不需要
`auth_rate_limits` 那样的持久安全表（那是登录失败限制专用的），因此这里是**进程内**
固定窗口计数器：

  - 键是 `sha256(scope:ip)` 的截断散列，内存里不保存原始 IP（05 §9「IP 标识最小化」）；
  - 触发限流返回 429 且带 `Retry-After`（05 §9）；
  - 只服务读接口：被限流的访客不会因此丢失任何内容，页面会显示「导航暂时不可用」；
  - **已知限制**：多进程 / 多容器部署时每个进程各有一份计数，实际阈值会乘以进程数。
    T10 若需要严格全局限流，改用网关限流或共享计数（交付单已记录）。
"""

from __future__ import annotations

import hashlib
import time

from fastapi import Depends, Request

from app.core.config import Settings
from app.core.deps import get_settings_dep
from app.core.errors import CODE_RATE_LIMITED, ApiError
from app.modules.auth.ratelimit import client_ip

WINDOW_SECONDS = 60
RESOLVE_SCOPE = "nav-resolve"
SEARCH_SCOPE = "nav-search"
RESOLVE_PER_MINUTE = 60
SEARCH_PER_MINUTE = 60

# 计数桶：(scope, 散列标识, 窗口序号) → 次数。窗口序号 = int(epoch / 60)。
_buckets: dict[tuple[str, str, int], int] = {}
_MAX_TRACKED_KEYS = 8192


def reset() -> None:
    """清空计数。仅测试与集成自检使用。"""
    _buckets.clear()


def _hashed(scope: str, identifier: str) -> str:
    return hashlib.sha256(f"{scope}:{identifier}".encode("utf-8")).hexdigest()[:16]


def _purge(now: float) -> None:
    """机会式清理过期窗口，避免散列键无限增长。"""
    current = int(now // WINDOW_SECONDS)
    for key in [item for item in _buckets if item[2] < current]:
        _buckets.pop(key, None)


def check(scope: str, identifier: str, *, limit: int, now: float | None = None) -> None:
    """记一次访问；超过 limit 抛 429 + Retry-After。"""
    moment = time.time() if now is None else now
    window = int(moment // WINDOW_SECONDS)
    key = (scope, _hashed(scope, identifier), window)
    if len(_buckets) > _MAX_TRACKED_KEYS:
        _purge(moment)
    count = _buckets.get(key, 0) + 1
    _buckets[key] = count
    if count > limit:
        retry_after = max(1, WINDOW_SECONDS - int(moment % WINDOW_SECONDS))
        raise ApiError(
            CODE_RATE_LIMITED,
            "请求过于频繁，请稍后再试",
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )


def _identity(request: Request, settings: Settings) -> str:
    return client_ip(request, settings)


def resolve_rate_limit(
    request: Request, settings: Settings = Depends(get_settings_dep)
) -> None:
    check(RESOLVE_SCOPE, _identity(request, settings), limit=RESOLVE_PER_MINUTE)


def search_rate_limit(
    request: Request, settings: Settings = Depends(get_settings_dep)
) -> None:
    check(SEARCH_SCOPE, _identity(request, settings), limit=SEARCH_PER_MINUTE)
