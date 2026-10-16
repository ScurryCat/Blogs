"""运行日志。

契约（06 §7）：运行时结构化日志包含 request ID、路径模板、耗时、状态；
**不记录 Cookie、密码或原始搜索条件**。

这里只做最小可用实现：日志行带 request_id，便于与错误响应的 request_id 对应。
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

LOGGER_NAME = "phantom_log"

# 这些字段名一律不入日志，避免把凭据写进磁盘或被采集。
REDACTED_KEYS = frozenset(
    {"password", "passwd", "secret", "secret_key", "token", "csrf", "cookie", "authorization", "session"}
)


class JsonFormatter(logging.Formatter):
    """单行 JSON 日志。额外字段通过 `extra={"event": ...}` 传入。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        event = getattr(record, "event", None)
        if event:
            payload["event"] = event
        for key, value in getattr(record, "context", {}).items():
            payload[key] = "<redacted>" if key.lower() in REDACTED_KEYS else value
        if record.exc_info:
            # 堆栈只进日志，不进 HTTP 响应。
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """配置根 logger。重复调用安全，测试可反复使用。"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level.upper())


def get_logger(name: str | None = None) -> logging.Logger:
    return logging.getLogger(LOGGER_NAME if name is None else f"{LOGGER_NAME}.{name}")
