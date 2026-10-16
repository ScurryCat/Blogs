"""角色消息的对外 DTO（08 §2 信息结构 + §6 数据概念）。

约定继承自 SHARED-CONTRACTS §5：字段 snake_case、UUID 为业务 ID、
时间是 UTC ISO 8601、错误用统一信封。

两条与「不要泄漏」有关的设计：

1. **公开 DTO 里没有会话凭证、没有访客 ID、没有原始模型输出。**
   `generation_request_id` 是会话内的一次生成请求 ID，不是上游请求 ID，
   也不是凭证 —— 它只用于让客户端把「一次生成」和「它产生的气泡」关联起来。
2. **AI 状态是独立字段而不是错误码。** `ai.status` 取值稳定、可断言，
   前端据此显示「自由聊天今日已暂停 / 模型暂时不可用」，
   而 HTTP 状态码描述的是**这次 API 操作**是否成立（见 router 的说明）。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# --- 输出 -----------------------------------------------------------------


class CardOut(BaseModel):
    """服务端验证过的站内内容引用。`url` 由服务端生成，前端只用它渲染 SiteLink。"""

    kind: str
    id: str
    title: str
    summary: str
    url: str


class MessageOut(BaseModel):
    id: str
    seq: int
    origin: str
    """user / script / ai / system（08 §6）。"""
    text: str
    node_id: str | None = None
    choice_id: str | None = None
    cards: list[CardOut] = Field(default_factory=list)
    created_at: datetime
    generation_request_id: str | None = None
    is_ai: bool = False
    """便捷布尔：`origin == "ai"`。前端必须在气泡上显示 AI 标记（08 §1）。"""
    attribution: str = ""
    """该条消息的来源说明（同人剧情 / AI 生成 / 由你发送），直接显示，不做隐晦暗示。"""


class ChoiceOut(BaseModel):
    id: str
    label: str


class NodeOut(BaseModel):
    """当前剧情节点的**可交互部分**。

    台词不在这里重复下发 —— 它们已经作为消息存在于 `messages` 里，
    再次下发会让「恢复后不重复插入已经展示过的开场」变得无法断言（08 §3）。
    """

    id: str
    ending: bool
    resumable: bool
    choices: list[ChoiceOut] = Field(default_factory=list)
    resume_text: str | None = None
    """仅在 `status = "free"` 时有值：回到话题后会出现的那句衔接文案。"""


class ConversationStateOut(BaseModel):
    id: str
    character_id: str
    status: str
    """script（等待选择）/ free（剧情暂停，自由聊天中）/ finished（这段剧情结束）。"""
    story_id: str
    story_version: str
    node_id: str
    node_version: int
    paused_node_id: str | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    can_send: bool
    """现在能不能发自由输入（结束态不能）。"""
    can_resume: bool
    can_restart: bool


class ConversationSummaryOut(BaseModel):
    """角色列表里的会话摘要。**只属于当前访客**；没有会话时为 null。"""

    id: str
    status: str
    node_id: str
    node_version: int
    message_count: int
    last_message_at: datetime | None = None
    preview: str = ""
    expires_at: datetime


class CharacterOut(BaseModel):
    id: str
    name: str
    handle: str
    tagline: str
    avatar: str
    avatar_alt: str
    story_id: str
    story_version: str
    conversation: ConversationSummaryOut | None = None


class AiStateOut(BaseModel):
    """AI 侧的状态。`status` 是稳定机器码；`message` 是给人看的原因。"""

    status: str
    """ok / in_flight / replayed / disabled / not_configured / timeout / transport /
    upstream / invalid_output / site_daily_budget / visitor_daily_limit / internal"""
    message: str
    provider: str
    retryable: bool = False


class UsageOut(BaseModel):
    """用量。**不隐藏成本**：即使额度没用完，也如实给出已结算单位。"""

    requests_today: int | None = None
    daily_limit: int
    remaining: int | None = None
    site_settled_units: int = 0
    site_daily_units: int = 0
    inflight: int = 0


class ConversationOut(BaseModel):
    conversation: ConversationStateOut
    node: NodeOut | None = None
    messages: list[MessageOut] = Field(default_factory=list)
    ai: AiStateOut
    usage: UsageOut


class VisitorOut(BaseModel):
    id: str
    expires_at: datetime
    absolute_expires_at: datetime


class SessionOut(BaseModel):
    visitor: VisitorOut
    csrf_token: str
    characters: list[CharacterOut] = Field(default_factory=list)
    ai: AiStateOut
    usage: UsageOut
    disclosure: str


class LimitsOut(BaseModel):
    input_max_codepoints: int
    max_bubbles: int
    visitor_daily_requests: int
    site_daily_units: int
    site_max_concurrency: int
    conversation_max_inflight: int
    visitor_session_idle_seconds: int
    conversation_idle_seconds: int


class StatusOut(BaseModel):
    """公开的运行状态：**不含**任何密钥，也不含访客身份。"""

    ai: AiStateOut
    limits: LimitsOut
    provider_notes: list[str] = Field(default_factory=list)
    disclosure: str


# --- 输入 -----------------------------------------------------------------


CLIENT_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,64}$"


class ClientIdMixin(BaseModel):
    csrf_token: str | None = Field(default=None, max_length=200)


class ConversationCreateIn(ClientIdMixin):
    character_id: str = Field(min_length=1, max_length=32)


class MessageIn(ClientIdMixin):
    text: str = Field(min_length=1, max_length=4000)
    # 客户端生成的幂等 ID，作用域限定到当前访客会话（08 §7）。
    client_request_id: str = Field(pattern=CLIENT_ID_PATTERN)


class ChoiceIn(ClientIdMixin):
    choice_id: str = Field(min_length=1, max_length=64)
    # 剧情节点与版本：不匹配一律拒绝，不重复消费一次选项（08 §3）。
    node_id: str = Field(min_length=1, max_length=64)
    node_version: int = Field(ge=0, le=1_000_000)
    client_message_id: str = Field(pattern=CLIENT_ID_PATTERN)


class NodeVersionIn(ClientIdMixin):
    node_version: int = Field(ge=0, le=1_000_000)


__all__ = [
    "AiStateOut",
    "CardOut",
    "CharacterOut",
    "ChoiceIn",
    "ChoiceOut",
    "ConversationCreateIn",
    "ConversationOut",
    "ConversationStateOut",
    "ConversationSummaryOut",
    "LimitsOut",
    "MessageIn",
    "MessageOut",
    "NodeOut",
    "NodeVersionIn",
    "SessionOut",
    "StatusOut",
    "UsageOut",
    "VisitorOut",
]
