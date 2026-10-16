"""供应商解析（08 §6：模型供应商和型号通过服务端配置选择）。

`resolve_provider(settings)` 是唯一的入口。它**不缓存**、**不联网**、
**不读除 `MessagingSettings` 之外的任何东西** —— 集中在一处是为了让
「现在到底会不会产生真实费用」这个问题只有一个答案。

`unavailable_provider()` 是给降级路径用的：当配置不完整时，
调用方拿到一个「一调用就明确失败」的实现，而不是 `None` 满天飞。
"""

from __future__ import annotations

from app.modules.messaging.ai.base import (
    AI_ERROR_NOT_CONFIGURED,
    AiCompletionRequest,
    AiCompletionResult,
    AiProvider,
    AiProviderError,
)
from app.modules.messaging.ai.openai_compatible import OpenAiCompatibleProvider
from app.modules.messaging.ai.simulator import SimulatorProvider
from app.modules.messaging.config import MessagingSettings


class UnavailableProvider:
    """配置不可用时的占位实现：明确失败，绝不静默换一个能跑的东西。"""

    name = "unavailable"

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def complete(self, request: AiCompletionRequest) -> AiCompletionResult:
        raise AiProviderError(AI_ERROR_NOT_CONFIGURED, self.reason)


def resolve_provider(settings: MessagingSettings) -> AiProvider:
    """按配置返回供应商。默认是模拟服务（`ai_provider="simulator"`）。"""
    if settings.ai_provider == "disabled":
        return UnavailableProvider("自由聊天已被站点停用")
    if settings.ai_provider == "simulator":
        return SimulatorProvider(
            latency_seconds=settings.simulator_latency_seconds,
            failure_mode=settings.simulator_failure_mode,
        )
    try:
        return OpenAiCompatibleProvider(
            base_url=settings.ai_base_url,
            api_key=settings.ai_api_key,
            model=settings.ai_model,
            max_attempts=settings.ai_max_attempts,
            retry_backoff_seconds=settings.ai_retry_backoff_seconds,
            proxy_url=settings.ai_proxy_url,
        )
    except AiProviderError as error:
        # 配置不全：不抛给请求路径，而是变成一个「调用就明确失败」的实现，
        # 这样剧情仍然可用，界面能显示真正的原因（08 §7）。
        return UnavailableProvider(error.message)


__all__ = ["UnavailableProvider", "resolve_provider"]
