"""访客写操作的闸门：Origin / Fetch Metadata + CSRF（08 §7「状态修改遵守同源与 CSRF 约束」）。

为什么不去直接调 `app/core/csrf.py` 的 `verify_write_request`（那是 T01 的模块级依赖）：

  T03 在真实浏览器联调里抓到过一个**形态问题**（T03 交付单 §8 第 1 条）：
  浏览器 → Next(3100) 的同源 POST 经 rewrite 转发到 API 之后，`Origin` 头是**空的**
  —— Chrome 只在跨源请求上发送 `Origin`。而 `verify_origin` 的规则是
  「缺失 Origin 的状态变更请求一律拒绝」，于是所有同源写请求都会 403。
  这是集成层形态与设计假设不一致，T08 不改 `app/core/`（T01 所有）。

本模块的做法是一个**更严、且在该形态下仍然正确**的闸门：

  1. `Origin` 存在 → 必须命中可信来源（同源 Host 比对或 `CORS_ORIGINS` 白名单）。
     这一条覆盖了所有**跨源**攻击：浏览器一定会在跨源 POST 上带 `Origin`。
  2. `Origin` 缺失 → 必须同时满足
       - `Sec-Fetch-Site: same-origin` 或 `same-site`（浏览器自己设置、页面脚本改不了），
       - 且 `Sec-Fetch-Mode: cors` 或 `same-origin`。
     两者都缺（脚本客户端、老浏览器、被剥离头的代理）→ 拒绝。
  3. CSRF token 必须与访客会话匹配（`hmac.compare_digest`）。

结果：跨站页面发起的请求被 (1) 拦住；不带任何来源信息的手写请求被 (2) 拦住；
冒充访客的请求被 (3) 拦住。没有任何一条路径是「因为缺少 Origin 就放行」。

`tests/messaging/test_write_guard.py` 逐条覆盖以上分支。
"""

from __future__ import annotations

from fastapi import Request

from app.core.config import Settings
from app.core.csrf import (
    CSRF_FIELD,
    CSRF_HEADER,
    csrf_token_from_request,
    origin_allowed,
    tokens_match,
)
from app.core.errors import CODE_FORBIDDEN, ApiError

# 浏览器自己设置的 Fetch Metadata 头。
SEC_FETCH_SITE = "sec-fetch-site"
SEC_FETCH_MODE = "sec-fetch-mode"

# 允许「没有 Origin」的两种 same-* 取值：
#   same-origin —— 同源页面的 fetch；
#   same-site   —— 同一站点的子域之间（本站部署在同一来源，出现即说明确实是浏览器）。
# `none` 表示用户直接输入地址栏，那不会产生写请求，因此不接受。
TRUSTED_FETCH_SITES = frozenset({"same-origin", "same-site"})
# 允许的请求模式：cors（fetch 默认）/ same-origin / no-cors 一律不接受
# （no-cors 无法读取响应，写操作没有理由用它）。
TRUSTED_FETCH_MODES = frozenset({"cors", "same-origin"})


def _forbidden(message: str) -> ApiError:
    return ApiError(CODE_FORBIDDEN, message, status_code=403)


def verify_visitor_origin(request: Request, settings: Settings) -> None:
    """Origin 或 Fetch Metadata 二者必须有一个能证明「这是本站发起的写请求」。"""
    origin = request.headers.get("origin", "").strip()
    if origin:
        if not origin_allowed(origin, request, settings):
            raise _forbidden("请求来源不被信任")
        return

    site = request.headers.get(SEC_FETCH_SITE, "").strip().lower()
    mode = request.headers.get(SEC_FETCH_MODE, "").strip().lower()
    if site in TRUSTED_FETCH_SITES and mode in TRUSTED_FETCH_MODES:
        return
    raise _forbidden("缺少 Origin，且请求没有可验证的同源标记")


async def verify_visitor_write(
    request: Request,
    settings: Settings,
    *,
    expected_token: str | None,
) -> None:
    """访客写操作的统一闸门：来源校验 + CSRF 校验。失败一律 403。"""
    verify_visitor_origin(request, settings)
    provided = await csrf_token_from_request(request)
    if not tokens_match(provided, expected_token):
        raise _forbidden("CSRF 校验失败，请重新读取访客会话")


__all__ = [
    "CSRF_FIELD",
    "CSRF_HEADER",
    "SEC_FETCH_MODE",
    "SEC_FETCH_SITE",
    "TRUSTED_FETCH_MODES",
    "TRUSTED_FETCH_SITES",
    "verify_visitor_origin",
    "verify_visitor_write",
]
