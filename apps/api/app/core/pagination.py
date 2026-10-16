"""不透明游标分页（05 §2 / §6）。

约定：
  - 列表统一返回 `{items, next_cursor}`；`next_cursor` 为不透明字符串或 null。
  - 排序稳定：`(published_at DESC, id DESC)`；同时间戳也不会漏项或重复。
  - 游标里带**筛选指纹**：切换 category / tag 后继续用旧游标 → 400，
    由客户端从第一页重新开始（05 §6）。
  - 游标格式不合法、版本不认识、时间或 ID 解析失败 → 400，不静默当成第一页。

游标不加密，但也不承载任何权限信息：能不能读到内容永远由服务端的公开条件决定。
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping

from app.core.errors import CODE_VALIDATION_FAILED, ApiError

CURSOR_VERSION = 1
DEFAULT_LIMIT = 12
MAX_LIMIT = 30

# 指纹只用于「游标是否属于当前筛选」，不需要保密；短摘要足够。
_FINGERPRINT_LENGTH = 12


def _bad_cursor(message: str) -> ApiError:
    return ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})


def filter_fingerprint(filters: Mapping[str, Any]) -> str:
    """把筛选条件归一成稳定指纹。None 与空字符串视为同一个「未筛选」。"""
    normalized = {
        str(key): ("" if value is None else str(value).strip())
        for key, value in sorted(filters.items(), key=lambda item: str(item[0]))
    }
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:_FINGERPRINT_LENGTH]


def encode_cursor(*, sort_value: datetime, entity_id: uuid.UUID, fingerprint: str) -> str:
    payload = {
        "v": CURSOR_VERSION,
        "s": sort_value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "i": str(entity_id),
        "f": fingerprint,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, *, fingerprint: str) -> tuple[datetime, uuid.UUID]:
    """解析游标。任何不一致都返回 400，不降级成「第一页」。"""
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
        sort_value = datetime.fromisoformat(str(payload["s"]).replace("Z", "+00:00"))
        entity_id = uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError, TypeError):
        raise _bad_cursor("游标无效，请从第一页重新开始") from None
    if sort_value.tzinfo is None:
        raise _bad_cursor("游标无效，请从第一页重新开始")
    return sort_value.astimezone(timezone.utc), entity_id
