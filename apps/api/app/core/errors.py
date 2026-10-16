"""统一错误响应。

契约（SHARED-CONTRACTS §5）：
    {"error": {"code": ..., "message": ..., "fields": ...}, "request_id": ...}

状态码必须真实：不把 4xx 包成 200，也不把 5xx 伪装成「没有数据」。
本模块只提供结构、异常类型与处理器安装函数；具体业务错误由各模块抛出 ApiError 的子类或直接抛 ApiError。
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"

# 错误 code 使用 SCREAMING_SNAKE_CASE，供前端按 code 分支，不依赖 message 文案。
CODE_VALIDATION_FAILED = "VALIDATION_FAILED"
CODE_NOT_FOUND = "NOT_FOUND"
CODE_METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
CODE_UNAUTHORIZED = "UNAUTHORIZED"
CODE_FORBIDDEN = "FORBIDDEN"
CODE_PRECONDITION_REQUIRED = "PRECONDITION_REQUIRED"
# 412 的 code 由 05 §9 给定：内容已在别处更新。其余 code 名称文档未规定，属 T00 约定的新增项。
CODE_VERSION_CONFLICT = "VERSION_CONFLICT"
CODE_CONFLICT = "CONFLICT"
CODE_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
CODE_UNPROCESSABLE = "UNPROCESSABLE"
CODE_SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
CODE_INTERNAL = "INTERNAL"

# HTTP 状态码 → 默认 code。仅覆盖静态、无歧义的映射。
_STATUS_CODE_DEFAULTS: dict[int, str] = {
    400: CODE_VALIDATION_FAILED,
    401: CODE_UNAUTHORIZED,
    403: CODE_FORBIDDEN,
    404: CODE_NOT_FOUND,
    405: CODE_METHOD_NOT_ALLOWED,
    409: CODE_CONFLICT,
    412: CODE_VERSION_CONFLICT,
    413: CODE_PAYLOAD_TOO_LARGE,
    422: CODE_UNPROCESSABLE,
    428: CODE_PRECONDITION_REQUIRED,
    503: CODE_SERVICE_UNAVAILABLE,
}

# 这些状态码不带请求体细节，避免把内部信息回显给调用方。
_OPAQUE_STATUS_CODES = {500, 502, 503, 504}


class ApiError(Exception):
    """业务错误。code 决定前端分支，message 面向人，fields 定位字段级问题。"""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        fields: Mapping[str, Any] | None = None,
    ) -> None:
        if status_code < 400:
            raise ValueError("ApiError 的 status_code 必须是 4xx 或 5xx")
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.fields = dict(fields) if fields else None


def error_body(code: str, message: str, fields: Mapping[str, Any] | None, request_id: str) -> dict[str, Any]:
    """构造契约规定的错误响应体。fields 为空时保留键但值为空对象，便于前端稳定取值。"""
    return {
        "error": {"code": code, "message": message, "fields": dict(fields) if fields else {}},
        "request_id": request_id,
    }


def get_request_id(request: Request) -> str:
    """取当前请求的 request_id；中间件未跑时兜底生成，避免响应体缺字段。"""
    request_id = getattr(request.state, "request_id", None)
    if not request_id:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
    return request_id


async def request_id_middleware(request: Request, call_next):
    """为每个请求分配 request_id，并回显到响应头。调用方传入的 ID 原样沿用，便于跨服务串联。"""
    inbound = request.headers.get(REQUEST_ID_HEADER, "").strip()
    # 只接受可打印、长度受限的调用方 ID，防止头注入把日志搞乱。
    if inbound and len(inbound) <= 128 and inbound.isprintable():
        request.state.request_id = inbound
    else:
        request.state.request_id = uuid.uuid4().hex
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request.state.request_id
    return response


def _json_error(request: Request, status_code: int, code: str, message: str,
                fields: Mapping[str, Any] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=error_body(code, message, fields, get_request_id(request)),
    )


def install_error_handlers(app: FastAPI) -> None:
    """把契约错误结构挂到应用上。模块测试 app 工厂也调用这里，保证测试与生产同形。"""

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return _json_error(request, exc.status_code, exc.code, exc.message, exc.fields)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # 字段级错误：{"字段路径": ["说明", ...]}，路径用点号连接，前端可直接定位表单域。
        fields: dict[str, list[str]] = {}
        for item in exc.errors():
            location = ".".join(str(part) for part in item.get("loc", ()) if part != "body")
            fields.setdefault(location or "body", []).append(item.get("msg", "无效取值"))
        return _json_error(request, 422, CODE_UNPROCESSABLE, "请求参数校验失败", fields)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODE_DEFAULTS.get(exc.status_code, CODE_INTERNAL)
        if exc.status_code in _OPAQUE_STATUS_CODES:
            message = "服务暂时不可用" if exc.status_code != 500 else "服务器内部错误"
        else:
            message = str(exc.detail) if exc.detail else "请求失败"
        return _json_error(request, exc.status_code, code, message)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # 未预期异常：日志留全量，响应只给 request_id，不泄漏堆栈或内部路径。
        request_id = get_request_id(request)
        logger.exception("未处理异常 request_id=%s path=%s", request_id, request.url.path)
        return _json_error(request, 500, CODE_INTERNAL, "服务器内部错误")
