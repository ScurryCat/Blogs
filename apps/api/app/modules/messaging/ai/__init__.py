"""AI 适配层（08 §6）。默认供应商是本地模拟服务，不会产生任何外部调用与费用。"""

from __future__ import annotations

from app.modules.messaging.ai.base import (
    AI_ERROR_INTERNAL,
    AI_ERROR_INVALID_OUTPUT,
    AI_ERROR_NOT_CONFIGURED,
    AI_ERROR_TIMEOUT,
    AI_ERROR_TRANSPORT,
    AI_ERROR_UPSTREAM,
    RETRYABLE_CODES,
    AiCompletionRequest,
    AiCompletionResult,
    AiProvider,
    AiProviderError,
    AiTurn,
)
from app.modules.messaging.ai.output import normalize_bubbles, sanitize, split_bubbles
from app.modules.messaging.ai.registry import UnavailableProvider, resolve_provider
from app.modules.messaging.ai.simulator import PROVIDER_NOTE, SimulatorProvider

__all__ = [
    "AI_ERROR_INTERNAL",
    "AI_ERROR_INVALID_OUTPUT",
    "AI_ERROR_NOT_CONFIGURED",
    "AI_ERROR_TIMEOUT",
    "AI_ERROR_TRANSPORT",
    "AI_ERROR_UPSTREAM",
    "PROVIDER_NOTE",
    "RETRYABLE_CODES",
    "AiCompletionRequest",
    "AiCompletionResult",
    "AiProvider",
    "AiProviderError",
    "AiTurn",
    "SimulatorProvider",
    "UnavailableProvider",
    "normalize_bubbles",
    "resolve_provider",
    "sanitize",
    "split_bubbles",
]
