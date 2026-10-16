"""角色消息模块的配置（08 §7 的「运行限制」候选值）。

为什么**不**扩展 `app/core/config.py` 的 `Settings`：
  - 那个文件由 T01 拥有（SHARED-CONTRACTS §2），且 `model_config` 是 `extra="forbid"`；
  - 本模块的限额、预算与供应商选择在 08 §7 里被明确标为「实现前按真实费用调整」的候选值，
    属于本模块的运行参数，不是全站共享契约。

因此这里用独立的 `BaseSettings`，前缀 `MESSAGING_`，**每一项都有默认值**，
所以「不配置」不会让任何既有部署或测试启动失败。生产密钥（`MESSAGING_AI_API_KEY`）
没有默认值，也不会出现在 `safe_summary()` 里。

硬规则（08 §7 / 任务卡执行清单）：
  - 默认供应商是 **模拟服务**（`simulator`），不是真实模型；
  - `disabled` 时角色消息的剧情部分完全可用，只有自由聊天明确停用；
  - 任何限额都不得只靠「可重置的 Cookie 或内存计数」承诺 —— 落地实现见 `budget.py`。
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

AIProviderName = Literal["disabled", "simulator", "openai_compatible"]

# 08 §7 的候选默认值（可配置，未经真实费用校准）。
DEFAULT_INPUT_MAX_CODEPOINTS = 1000
DEFAULT_MAX_BUBBLES = 3
DEFAULT_VISITOR_DAILY_REQUESTS = 20
DEFAULT_SITE_DAILY_UNITS = 2000
DEFAULT_AI_TIMEOUT_SECONDS = 20.0
DEFAULT_SITE_MAX_CONCURRENCY = 4

# 保留期（08 §7）：建议「最近 24 小时」，到期删除。
DEFAULT_VISITOR_SESSION_IDLE_SECONDS = 24 * 60 * 60
DEFAULT_VISITOR_SESSION_ABSOLUTE_SECONDS = 72 * 60 * 60
DEFAULT_CONVERSATION_IDLE_SECONDS = 24 * 60 * 60


class MessagingSettings(BaseSettings):
    """`MESSAGING_*` 环境变量。全部有默认值；没有默认值的只有真实供应商密钥。"""

    model_config = SettingsConfigDict(
        env_prefix="MESSAGING_",
        extra="forbid",
        case_sensitive=False,
    )

    # --- AI 供应商（默认模拟服务；不擅自启用任何收费调用）-------------------
    ai_provider: AIProviderName = "simulator"
    """`disabled` / `simulator`（默认）/ `openai_compatible`。"""

    ai_base_url: str = ""
    """仅 `openai_compatible` 使用；必须由部署方显式配置成 OpenAI 兼容端点。"""

    ai_api_key: str = ""
    """仅 `openai_compatible` 使用。**不要**提交到仓库，也不会出现在任何响应或日志里。"""

    ai_model: str = ""
    """仅 `openai_compatible` 使用。留空即视为未配置，供应商会拒绝启动。"""

    ai_proxy_url: str = ""
    """显式代理地址（默认空 = **不读系统代理**，见 openai_compatible 的说明）。"""

    ai_timeout_seconds: float = Field(default=DEFAULT_AI_TIMEOUT_SECONDS, gt=0, le=120)
    """单次上游调用的墙钟超时（秒）。超时按 `timeout` 降级，不重试到无限。"""

    ai_max_attempts: int = Field(default=2, ge=1, le=3)
    """上游尝试次数上限（含首次）。只在**尚无输出**的传输错误 / 5xx 上重试一次。"""

    ai_retry_backoff_seconds: float = Field(default=0.25, ge=0, le=5)

    # --- 模拟服务的行为（**只影响 simulator**，真实供应商完全不看这两项）-----
    #
    # 为什么把「失败」做进配置而不是只写在单测里：验收用例「AI 超时 / 额度耗尽 /
    # 重试 → 预设剧情仍可用」必须在**真的 HTTP 端点**上跑一遍，而不是只在单元层面
    # 替换一个函数。有了这两个开关，degradation 可以在端到端测试里被真实触发。
    simulator_latency_seconds: float = Field(default=0.0, ge=0, le=60)
    simulator_failure_mode: Literal["none", "timeout", "error"] = "none"

    # --- 输入 / 输出限制（08 §7）-------------------------------------------
    input_max_codepoints: int = Field(default=DEFAULT_INPUT_MAX_CODEPOINTS, gt=0, le=4000)
    max_bubbles: int = Field(default=DEFAULT_MAX_BUBBLES, ge=1, le=6)
    bubble_max_codepoints: int = Field(default=240, gt=0, le=1000)
    ai_output_max_codepoints: int = Field(default=DEFAULT_MAX_BUBBLES * 240, gt=0, le=2000)

    # --- 预算与并发（服务端原子计数，跨重启保存）----------------------------
    visitor_daily_requests: int = Field(default=DEFAULT_VISITOR_DAILY_REQUESTS, ge=1)
    site_daily_units: int = Field(default=DEFAULT_SITE_DAILY_UNITS, ge=1)
    site_max_concurrency: int = Field(default=DEFAULT_SITE_MAX_CONCURRENCY, ge=1, le=32)
    """全站在途 AI 请求上限（`ai_requests` 里 `pending` 的行数），不是内存计数。"""

    conversation_max_inflight: int = Field(default=1, ge=1, le=1)
    """单会话在途请求上限。固定为 1（08 §7），保留字段是为了让约束可被断言。"""

    units_per_request: int = Field(default=1, ge=1)
    """一次请求的预留单位。真实供应商接上后按实际 token 结算，见 `budget.py`。"""

    ip_rate_limit_per_minute: int = Field(default=12, ge=1)
    """同一 IP 摘要每分钟允许的 AI 请求数（与访客日额度叠加，不能只靠 Cookie 限费）。"""

    # --- 保留期（08 §7）----------------------------------------------------
    visitor_session_idle_seconds: int = Field(default=DEFAULT_VISITOR_SESSION_IDLE_SECONDS, gt=0)
    visitor_session_absolute_seconds: int = Field(
        default=DEFAULT_VISITOR_SESSION_ABSOLUTE_SECONDS, gt=0
    )
    conversation_idle_seconds: int = Field(default=DEFAULT_CONVERSATION_IDLE_SECONDS, gt=0)

    # --- 内容推荐（08 §3：AI 只能建议已验证的公开内容 ID，且不假装看过图片）---
    content_candidate_limit: int = Field(default=12, ge=0, le=50)
    transcript_context_messages: int = Field(default=8, ge=0, le=40)
    """发给模型的历史消息条数上限（只传必要上下文）。"""

    def provider_ready(self) -> tuple[bool, str]:
        """供应商是否具备运行条件，以及不可用时的原因（可安全展示给管理员）。"""
        if self.ai_provider == "disabled":
            return False, "自由聊天已被站点停用（MESSAGING_AI_PROVIDER=disabled）"
        if self.ai_provider == "simulator":
            return True, "当前使用模拟服务，不会调用任何外部模型，也不产生真实费用"
        missing = [
            name
            for name, value in (
                ("MESSAGING_AI_BASE_URL", self.ai_base_url),
                ("MESSAGING_AI_API_KEY", self.ai_api_key),
                ("MESSAGING_AI_MODEL", self.ai_model),
            )
            if not value.strip()
        ]
        if missing:
            return False, f"真实模型未配置完整：缺少 {', '.join(missing)}"
        return True, f"已配置 OpenAI 兼容端点（模型 {self.ai_model}）"

    def safe_summary(self) -> dict[str, object]:
        """可安全写日志 / 交付单 / 管理页的配置摘要：密钥只以「是否设置」出现。"""
        return {
            "ai_provider": self.ai_provider,
            "ai_model": self.ai_model or None,
            "ai_base_url_set": bool(self.ai_base_url),
            "ai_api_key_set": bool(self.ai_api_key),
            "ai_timeout_seconds": self.ai_timeout_seconds,
            "ai_max_attempts": self.ai_max_attempts,
            "simulator_latency_seconds": self.simulator_latency_seconds,
            "simulator_failure_mode": self.simulator_failure_mode,
            "input_max_codepoints": self.input_max_codepoints,
            "max_bubbles": self.max_bubbles,
            "visitor_daily_requests": self.visitor_daily_requests,
            "site_daily_units": self.site_daily_units,
            "site_max_concurrency": self.site_max_concurrency,
            "ip_rate_limit_per_minute": self.ip_rate_limit_per_minute,
            "visitor_session_idle_seconds": self.visitor_session_idle_seconds,
            "conversation_idle_seconds": self.conversation_idle_seconds,
        }


@lru_cache(maxsize=1)
def get_messaging_settings() -> MessagingSettings:
    """进程级单例。测试用 `get_messaging_settings.cache_clear()` 重建。"""
    return MessagingSettings()


def messaging_settings_dep() -> MessagingSettings:
    """FastAPI 依赖形式；测试可 `app.dependency_overrides[get_settings_dep]` 覆盖。"""
    return get_messaging_settings()


__all__ = [
    "AIProviderName",
    "MessagingSettings",
    "get_messaging_settings",
    "messaging_settings_dep",
]
