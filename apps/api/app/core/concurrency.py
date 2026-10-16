"""有界图片处理（05 §8）。

要求：「解码与压缩使用有界并发，不在事件循环里长时间执行 CPU 阻塞操作；
建议首版最多同时处理 2 张，按服务器测量调整」。

实现：
  - `anyio.to_thread.run_sync` 把 Pillow 的解码 / 缩放放到工作线程，不阻塞事件循环。
  - `anyio.CapacityLimiter` 限制同时进行的处理数量（默认取 `MEDIA_MAX_CONCURRENCY`）。
  - 限流器按「进程 + 上限」缓存：不同上限不共享，避免测试之间互相影响。

超过上限的请求会**排队等待**，而不是失败或无限并发 —— 等待时长由部署方按服务器测量调整。
"""

from __future__ import annotations

import functools
from typing import Callable, TypeVar

import anyio.to_thread

T = TypeVar("T")

_limiters: dict[int, anyio.CapacityLimiter] = {}


def limiter_for(max_concurrency: int) -> anyio.CapacityLimiter:
    if max_concurrency < 1:
        raise ValueError("max_concurrency 必须大于 0")
    limiter = _limiters.get(max_concurrency)
    if limiter is None:
        limiter = anyio.CapacityLimiter(max_concurrency)
        _limiters[max_concurrency] = limiter
    return limiter


def reset_limiters() -> None:
    """仅测试使用：清空缓存，避免用例之间共享被占满的限流器。"""
    _limiters.clear()


async def run_bounded(
    func: Callable[..., T],
    *args: object,
    max_concurrency: int,
    **kwargs: object,
) -> T:
    """在有界线程池里执行同步函数。"""
    call = functools.partial(func, *args, **kwargs)
    return await anyio.to_thread.run_sync(call, limiter=limiter_for(max_concurrency))
