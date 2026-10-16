"""友链列表的游标（按站主排序 `(position ASC, id ASC)`）。

为什么不用 `core.pagination`：那份游标固定为 `(published_at DESC, id DESC)` 的
**时间戳 + UUID** 二元组，表达不了「站主手动排序」的整型键。这里沿用 nav 搜索游标的
先例，做一个**同形游标**：同样的 base64 JSON、同样的版本号、同样复用
`core.pagination.filter_fingerprint` 做筛选指纹（切换标签后继续用旧游标 → 400）。

字段：`v` 版本 / `p` position / `i` UUID / `f` 指纹。格式不合法、版本不认识、
指纹与当前 `tag` 不符一律 400 `VALIDATION_FAILED`，不静默当成第一页。
"""

from __future__ import annotations

import base64
import binascii
import json
import uuid

from app.core.errors import CODE_VALIDATION_FAILED, ApiError
from app.core.pagination import filter_fingerprint

CURSOR_VERSION = 1

__all__ = ["CURSOR_VERSION", "decode_cursor", "encode_cursor", "filter_fingerprint"]


def _bad_cursor(message: str) -> ApiError:
    return ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})


def encode_cursor(*, position: int, entity_id: uuid.UUID, fingerprint: str) -> str:
    payload = {
        "v": CURSOR_VERSION,
        "p": int(position),
        "i": str(entity_id),
        "f": fingerprint,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, *, fingerprint: str) -> tuple[int, uuid.UUID]:
    """解析游标；任何不一致都返回 400，不降级成「第一页」。"""
    candidate = (cursor or "").strip()
    if not candidate or len(candidate) > 512:
        raise _bad_cursor("游标无效，请从第一页重新开始")
    padding = "=" * (-len(candidate) % 4)
    try:
        raw = base64.urlsafe_b64decode(candidate + padding)
        payload = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise _bad_cursor("游标无效，请从第一页重新开始") from None
    if not isinstance(payload, dict):
        raise _bad_cursor("游标无效，请从第一页重新开始")
    if payload.get("v") != CURSOR_VERSION:
        raise _bad_cursor("游标版本不受支持，请从第一页重新开始")
    if payload.get("f") != fingerprint:
        raise _bad_cursor("游标与当前筛选条件不一致，请从第一页重新开始")
    try:
        position = int(payload["p"])
        entity_id = uuid.UUID(str(payload["i"]))
    except (KeyError, TypeError, ValueError):
        raise _bad_cursor("游标无效，请从第一页重新开始") from None
    return position, entity_id
