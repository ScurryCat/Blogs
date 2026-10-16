"""CSRF 与来源校验（05 §5.4 / §5.7）。

规则：
  - 所有状态变更请求（登录、注销、上传、发布、编辑）必须同时通过 **CSRF token** 与 **Origin** 校验。
  - CSRF token 由服务端在会话上生成，与会话绑定；校验用 `hmac.compare_digest`（常量时间）。
  - SameSite 只是附加防护，不替代 CSRF（05 §5.7）。
  - token 传输：优先 `X-CSRF-Token` 请求头；也接受 JSON body 或 multipart 表单里的
    `csrf_token` 字段（Django 式表单字段是常规做法，且不要求前端改造共享客户端）。
    **不接受查询串**，避免 token 出现在访问日志与 Referer 中。
  - Origin 校验采用「同源（Host 比对）或显式白名单」。缺失 Origin 的状态变更请求一律拒绝：
    浏览器对 POST 一定发送 Origin，缺失通常说明是脚本 / 跨站代理。

本模块不记录 token 内容。
"""

from __future__ import annotations

import hmac
import json
import secrets
from hashlib import sha256
from typing import Any
from urllib.parse import urlsplit

from fastapi import Request

from app.core.config import Settings
from app.core.errors import CODE_FORBIDDEN, ApiError

CSRF_HEADER = "X-CSRF-Token"
CSRF_FIELD = "csrf_token"

# 会话里保存的是 `csrf_secret`，对外发出的 token 由它派生（HMAC）。
# 这样即使会话表被读走，也拿不到客户端正在使用的 token。
CSRF_CONTEXT = b"phantom-log-csrf-v1"

# 只在体积很小、且确实是 JSON 时才为了取 token 去解析请求体。
_MAX_CSRF_BODY_BYTES = 4096

JSON_CONTENT_TYPE = "application/json"
MULTIPART_CONTENT_TYPE = "multipart/form-data"
FORM_URLENCODED_CONTENT_TYPE = "application/x-www-form-urlencoded"


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_token_for(secret: str) -> str:
    """由会话的 `csrf_secret` 派生出对外 token（库中不保存派生结果）。

    放在 core 而不是 auth 模块：它只依赖一个字符串，属于通用原语；
    放在这里也避免 core 的共用件反向依赖业务模块。
    """
    return hmac.new(secret.encode("utf-8"), CSRF_CONTEXT, sha256).hexdigest()


def tokens_match(provided: str | None, expected: str | None) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided, expected)


def _forbidden(message: str) -> ApiError:
    return ApiError(CODE_FORBIDDEN, message, status_code=403)


def _normalized_origin(value: str) -> str:
    """把 Origin 归一成 `scheme://host[:port]`（小写、去尾斜杠）。"""
    parts = urlsplit(value.strip())
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}"


def origin_allowed(origin: str, request: Request, settings: Settings) -> bool:
    """同源（与 Host 比对）或命中显式白名单即通过。"""
    normalized = _normalized_origin(origin)
    if not normalized:
        return False

    allowed = {_normalized_origin(item) for item in settings.cors_origin_list()}
    if normalized in allowed:
        return True

    # 同源比对只比 host[:port]，scheme 交给网关的 TLS 与转发头决定：
    # 反代终止 TLS 时后端看到的是 http，用 scheme 比对会误拒所有生产请求。
    host = request.headers.get("host", "").strip().lower()
    if not host:
        return False
    origin_netloc = urlsplit(normalized).netloc.lower()
    return origin_netloc == host


def verify_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get("origin", "")
    if not origin:
        raise _forbidden("缺少 Origin，拒绝状态变更请求")
    if not origin_allowed(origin, request, settings):
        raise _forbidden("请求来源不被信任")


async def csrf_token_from_request(request: Request, *, read_body: bool = True) -> str | None:
    """按 头 → JSON body → multipart 表单 的顺序取 CSRF token。

    `read_body=False` 用于明确不想解析表单的调用方（例如大文件上传前的轻量检查）。
    """
    header_token = request.headers.get(CSRF_HEADER)
    if header_token:
        return header_token.strip()
    if not read_body:
        return None

    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type == JSON_CONTENT_TYPE:
        raw_length = request.headers.get("content-length", "")
        if raw_length.isdigit() and int(raw_length) > _MAX_CSRF_BODY_BYTES:
            return None
        try:
            body: Any = json.loads(await request.body() or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None
        if isinstance(body, dict):
            value = body.get(CSRF_FIELD)
            if isinstance(value, str) and value:
                return value.strip()
        return None

    if content_type in (MULTIPART_CONTENT_TYPE, FORM_URLENCODED_CONTENT_TYPE):
        # FastAPI 只有在端点声明了 Form/File 时才会解析表单；这里主动解析一次，
        # Starlette 会缓存结果（request._form），端点不会因此重复解析。
        try:
            form = await request.form()
        except Exception:
            return None
        value = form.get(CSRF_FIELD)
        if isinstance(value, str) and value:
            return value.strip()
    return None


async def verify_write_request(
    request: Request,
    settings: Settings,
    *,
    expected_token: str | None,
    read_body: bool = True,
) -> None:
    """状态变更请求的统一闸门：Origin 校验 + CSRF 校验。失败一律 403。"""
    verify_origin(request, settings)
    provided = await csrf_token_from_request(request, read_body=read_body)
    if not tokens_match(provided, expected_token):
        raise _forbidden("CSRF 校验失败")
