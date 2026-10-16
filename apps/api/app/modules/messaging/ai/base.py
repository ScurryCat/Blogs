"""AI 适配层的公开契约（08 §6「AI 适配层」）。

边界（08 §6 表格）：适配层负责「按角色组织上下文、调用模型、验证输出」，
**不**负责执行任意工具、**不**直接操作站点数据、**不**决定剧情节点。

供应商与型号通过服务端配置选择（`config.MessagingSettings.ai_provider`）：
  - `disabled`            自由聊天明确停用，剧情完全可用；
  - `simulator`（默认）    本地模拟服务：不联网、不计费、输出可复现；
  - `openai_compatible`   真实模型的 OpenAI 兼容端点，**必须由部署方显式配置**。

本模块不 import 任何第三方 HTTP 客户端：`httpx` 目前只是 `apps/api` 的 dev 依赖，
把它用进生产代码会让 `uv sync --no-dev` 的部署直接崩掉。真实适配层用标准库
`urllib.request` 在工作线程里发请求（见 `openai_compatible.py`）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol, runtime_checkable

from app.modules.messaging.characters import CharacterCard
from app.modules.messaging.content import CandidateContent

AiRole = Literal["user", "assistant"]

# 失败分类。它们会变成对外的 `ai.status`，因此必须是稳定、可断言的机器码。
AI_ERROR_TIMEOUT = "timeout"
AI_ERROR_TRANSPORT = "transport"
AI_ERROR_UPSTREAM = "upstream"
AI_ERROR_INVALID_OUTPUT = "invalid_output"
AI_ERROR_NOT_CONFIGURED = "not_configured"
AI_ERROR_INTERNAL = "internal"

# 上游重试策略只在**尚无输出**的失败上生效（08 §7：不能承诺网络异常绝无上游成本，
# 但必须限制并记录重复请求）。因此这里只列出可以安全重试的两类。
RETRYABLE_CODES = (AI_ERROR_TRANSPORT, AI_ERROR_UPSTREAM)


@dataclass(frozen=True)
class AiTurn:
    """发给模型的一条历史消息。只包含**文本**，不包含任何内部标识。"""

    role: AiRole
    text: str


@dataclass(frozen=True)
class AiCompletionRequest:
    character: CharacterCard
    history: tuple[AiTurn, ...]
    user_text: str
    candidates: tuple[CandidateContent, ...] = ()
    max_bubbles: int = 3
    bubble_max_codepoints: int = 240
    max_output_codepoints: int = 720
    timeout_seconds: float = 20.0
    max_attempts: int = 2
    retry_backoff_seconds: float = 0.25

    def prompt_codepoints(self) -> int:
        """送入上游的文本规模（用于预算记录与费用解释，不含提示词模板本身）。"""
        return sum(len(turn.text) for turn in self.history) + len(self.user_text)


@dataclass(frozen=True)
class AiCompletionResult:
    """供应商返回的**原始**文本。切分气泡与提取内容 ID 由 `output.py` 负责 —
    这样「怎么切」这件事对所有供应商是同一套，不会被某个供应商的实现带偏。"""

    raw_text: str
    provider: str
    model: str | None = None
    attempts: int = 1
    notes: tuple[str, ...] = field(default=())


class AiProviderError(Exception):
    """适配层的统一失败类型。`code` 会原样出现在对外的降级信息里。"""

    def __init__(self, code: str, message: str, *, detail: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        # detail 只用于服务端日志与测试断言，**不**返回给访客（可能含上游原文）。
        self.detail = detail

    @property
    def retryable(self) -> bool:
        return self.code in RETRYABLE_CODES


@runtime_checkable
class AiProvider(Protocol):
    """所有供应商实现这一个方法。名字用于日志、管理页与测试断言。"""

    name: str

    async def complete(self, request: AiCompletionRequest) -> AiCompletionResult: ...


__all__ = [
    "AI_ERROR_INTERNAL",
    "AI_ERROR_INVALID_OUTPUT",
    "AI_ERROR_NOT_CONFIGURED",
    "AI_ERROR_TIMEOUT",
    "AI_ERROR_TRANSPORT",
    "AI_ERROR_UPSTREAM",
    "RETRYABLE_CODES",
    "AiCompletionRequest",
    "AiCompletionResult",
    "AiProvider",
    "AiProviderError",
    "AiRole",
    "AiTurn",
]
