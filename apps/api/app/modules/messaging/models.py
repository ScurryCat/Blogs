"""角色消息的持久化模型（08 §6 的契约增量：visitor_sessions / conversations / messages）。

设计要点，逐条对应设计与任务卡：

1. **访客身份与站主会话分开**（08 §7、05 §11、T01 交付单 §9 第 6 条）：
   本模块**不碰** `sessions` / `admin_users`，新建 `visitor_sessions`。
   两张表混用会让「匿名访客」与「已登录站主」的权限判断纠缠在一起，
   而访客会话的唯一能力就是访问**自己那一份**角色消息。

2. **库中只保存凭证摘要**（08 §7）：`visitor_sessions.token_hash` 是
   SHA-256(token) 的十六进制；原始 token 只存在于 HttpOnly Cookie 里。
   因此即使整张表被读走，也不能拿去冒充访客。

3. **UUID 不是授权**（08 §7 / 验收用例 2）：`conversations` 与 `messages` 都带
   `visitor_session_id`（消息通过会话间接持有），每次读取 / 发送 / 选择 / 清除
   都在 SQL 的 WHERE 里带上它，而不是「先按 id 查出来再在 Python 里比较」。

4. **单会话一在途请求**（08 §7）落在数据库上：
   `uq_ai_requests_one_inflight` 是 `WHERE status = 'pending'` 的**部分唯一索引**。
   两个并发的自由输入只有一个能插入成功，另一个拿到真实的唯一冲突 ——
   这比在应用层「查一下有没有在途」可靠，因为后者在并发下必然漏。

5. **原子预算计数跨重启保存**（08 §7）：`ai_budget_days`（全站）与
   `ai_visitor_days`（每访客每天）是两张计数器表。预留 / 结算 / 释放都是
   `UPDATE ... SET n = n + ? WHERE n + ? <= limit` 形式的原子语句（见 `budget.py`），
   不使用任何内存计数，也不依赖 Cookie。

6. **消息顺序**：`(conversation_id, seq)` 唯一。`seq` 在会话行锁（`SELECT … FOR UPDATE`）
   内分配，因此并发写入不会出现两条相同 `seq`（见 `service.py`）。

7. **幂等**：`messages(conversation_id, client_message_id)` 唯一（PostgreSQL 里
   NULL 互不相等，所以未提供幂等键的行不受影响）；
   `ai_requests(visitor_session_id, client_request_id)` 唯一。重试先查已生成结果，
   不重复调用上游（08 §7、验收用例 3）。

8. **`origin` 与角色**（08 §6）：每条消息都带 `origin`（user / script / ai / system）、
   冗余的 `character_id`（让「切换角色后旧响应到达」可以在数据库层直接断言）
   与可选 `generation_request_id`。

9. **内容卡片只存服务端验证过的公开内容**（08 §3 / §7）：
   `messages.cards` 是 JSONB 列表 `[{kind, id, title, summary, url}]`，
   由 `content.py` 在写入时从**当前公开**的文章 / 动态重新解析，模型输出的原始
   文本与 URL **不**入库。前端只用 `kind` + `id` 自己构造站内链接。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text as sql_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

# --- 枚举常量 --------------------------------------------------------------

ORIGIN_USER = "user"
ORIGIN_SCRIPT = "script"
ORIGIN_AI = "ai"
ORIGIN_SYSTEM = "system"
MESSAGE_ORIGINS = (ORIGIN_USER, ORIGIN_SCRIPT, ORIGIN_AI, ORIGIN_SYSTEM)

CONVERSATION_SCRIPT = "script"
CONVERSATION_FREE = "free"
CONVERSATION_FINISHED = "finished"
CONVERSATION_STATUSES = (CONVERSATION_SCRIPT, CONVERSATION_FREE, CONVERSATION_FINISHED)

AI_PENDING = "pending"
AI_SUCCEEDED = "succeeded"
AI_FAILED = "failed"
AI_RELEASED = "released"
AI_REQUEST_STATUSES = (AI_PENDING, AI_SUCCEEDED, AI_FAILED, AI_RELEASED)

# --- 长度上限（数据库级兜底；对外限制见 config.py 与 schemas.py）----------

TEXT_MAX_CODEPOINTS = 2000
CHARACTER_ID_MAX = 32
STORY_ID_MAX = 64
STORY_VERSION_MAX = 16
NODE_ID_MAX = 64
CHOICE_ID_MAX = 64
CLIENT_ID_MAX = 64
PROVIDER_MAX = 32
ERROR_CODE_MAX = 32
TOKEN_HASH_MAX = 64

# 生成请求 ID 在消息里是普通 UUID 列（可为空），指向 ai_requests。
# 用 SET NULL 而不是 CASCADE：预算行被清理时不应该连带删掉聊天正文。
MESSAGING_TABLES = (
    "visitor_sessions",
    "conversations",
    "messages",
    "ai_requests",
    "ai_budget_days",
    "ai_visitor_days",
)


class VisitorSession(Base):
    """匿名访客会话（08 §7）。**不是**站主 `sessions` 表，两者不共用任何行。"""

    __tablename__ = "visitor_sessions"
    __table_args__ = (
        CheckConstraint(f"char_length(token_hash) = {TOKEN_HASH_MAX}", name="token_hash_length"),
        CheckConstraint("char_length(csrf_secret) >= 32", name="csrf_secret_length"),
        Index("ix_visitor_sessions_expires_at", "expires_at"),
        Index("ix_visitor_sessions_ip_hash", "ip_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 凭证摘要（SHA-256 十六进制，64 字符）。原始 token 只在 Cookie 里。
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_MAX), nullable=False, unique=True)
    # 访客版 CSRF 的密钥；对外 token 由 `app.core.csrf.csrf_token_for` 派生，库里不存派生结果。
    csrf_secret: Mapped[str] = mapped_column(String(64), nullable=False)
    # 只保存 IP 的 HMAC 摘要（日志与库都不落原始 IP），用于每分钟频率限制。
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    # 滑动过期（每次活动顺延）与绝对上限（防「一直访问就永不过期」）。
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 到期判断一律用「请求时刻」在 SQL 的 WHERE 里做（见 sessions.resolve_visitor），
    # 不提供 `is_expired` 这类属性 —— 它会让调用方用行加载时刻来猜。


class Conversation(Base):
    """一对一角色会话（08 §6）。`unique(visitor_session_id, character_id)` 表达
    「同一角色同时从两处打开时共用会话顺序」（08 §3）。"""

    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint(
            "visitor_session_id", "character_id", name="uq_conversations_visitor_session_character"
        ),
        CheckConstraint(
            "status in ('script', 'free', 'finished')", name="status_valid"
        ),
        CheckConstraint("node_version >= 0", name="node_version_non_negative"),
        CheckConstraint(f"char_length(character_id) between 1 and {CHARACTER_ID_MAX}",
                        name="character_id_length"),
        CheckConstraint(
            f"char_length(story_id) between 1 and {STORY_ID_MAX}", name="story_id_length"
        ),
        CheckConstraint(f"char_length(node_id) between 1 and {NODE_ID_MAX}", name="node_id_length"),
        # 暂停中的会话必须有 paused_node_id；不在暂停状态时它必须为空 ——
        # 否则「回到话题」会恢复到错误的节点。
        CheckConstraint(
            "(status = 'free' and paused_node_id is not null) "
            "or (status <> 'free' and paused_node_id is null)",
            name="paused_node_consistent",
        ),
        Index("ix_conversations_expires_at", "expires_at"),
        Index("ix_conversations_visitor_updated", "visitor_session_id", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visitor_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("visitor_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    character_id: Mapped[str] = mapped_column(String(CHARACTER_ID_MAX), nullable=False)
    # 剧本坐标：T08 的剧本是仓库里版本化的文件，落在会话上以便审计与回放。
    story_id: Mapped[str] = mapped_column(String(STORY_ID_MAX), nullable=False)
    story_version: Mapped[str] = mapped_column(String(STORY_VERSION_MAX), nullable=False)
    node_id: Mapped[str] = mapped_column(String(NODE_ID_MAX), nullable=False)
    # 每次成功消费一个选项就 +1；客户端提交的旧版本一律拒绝（08 §3）。
    node_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=CONVERSATION_SCRIPT)
    paused_node_id: Mapped[str | None] = mapped_column(String(NODE_ID_MAX), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Message(Base):
    """一段会话里的一条消息（08 §6）。"""

    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_messages_conversation_seq"),
        # 幂等：同一会话里同一个客户端消息 ID 只能出现一次。
        # PostgreSQL 的唯一约束里 NULL 互不相等，因此未带幂等键的行不受影响。
        UniqueConstraint(
            "conversation_id", "client_message_id", name="uq_messages_conversation_client_message"
        ),
        CheckConstraint(
            "origin in ('user', 'script', 'ai', 'system')", name="origin_valid"
        ),
        CheckConstraint("seq >= 1", name="seq_positive"),
        CheckConstraint(
            f"char_length(text) between 1 and {TEXT_MAX_CODEPOINTS}", name="text_length"
        ),
        CheckConstraint("jsonb_typeof(cards) = 'array'", name="cards_is_array"),
        Index("ix_messages_conversation_seq", "conversation_id", "seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 冗余但**不许为空**：AI 响应写回时必须连 character_id 一起匹配，
    # 「切换角色后旧响应到达」在数据库层就写不进新角色的会话。
    character_id: Mapped[str] = mapped_column(String(CHARACTER_ID_MAX), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    origin: Mapped[str] = mapped_column(String(8), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    node_id: Mapped[str | None] = mapped_column(String(NODE_ID_MAX), nullable=True)
    choice_id: Mapped[str | None] = mapped_column(String(CHOICE_ID_MAX), nullable=True)
    generation_request_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ai_requests.id", ondelete="SET NULL"),
        nullable=True,
    )
    client_message_id: Mapped[str | None] = mapped_column(String(CLIENT_ID_MAX), nullable=True)
    # 只存服务端验证过的公开内容引用；模型给的原始 URL 不入库（08 §3）。
    cards: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class AiRequest(Base):
    """一次自由输入的生成请求：幂等 + 预算 + 上游调用记录（08 §7）。"""

    __tablename__ = "ai_requests"
    __table_args__ = (
        UniqueConstraint(
            "visitor_session_id", "client_request_id", name="uq_ai_requests_visitor_client_request"
        ),
        # **单会话一在途请求**的数据库级保证（08 §7）。
        Index(
            "uq_ai_requests_one_inflight",
            "conversation_id",
            unique=True,
            postgresql_where=sql_text("status = 'pending'"),
        ),
        CheckConstraint(
            "status in ('pending', 'succeeded', 'failed', 'released')", name="status_valid"
        ),
        CheckConstraint(
            "reserved_units >= 0 and settled_units >= 0", name="units_non_negative"
        ),
        CheckConstraint("prompt_codepoints >= 0 and output_codepoints >= 0",
                        name="codepoints_non_negative"),
        Index("ix_ai_requests_day", "day"),
        Index("ix_ai_requests_visitor_day", "visitor_session_id", "day"),
        Index("ix_ai_requests_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    visitor_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("visitor_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 客户端生成的幂等 ID，作用域限定到当前访客会话（08 §7）。
    client_request_id: Mapped[str] = mapped_column(String(CLIENT_ID_MAX), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=AI_PENDING)
    # UTC 日期桶，用于「每访客每天 N 次」与「全站日预算」。
    day: Mapped[date] = mapped_column(Date, nullable=False)
    provider: Mapped[str] = mapped_column(String(PROVIDER_MAX), nullable=False)
    reserved_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    settled_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prompt_codepoints: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_codepoints: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(ERROR_CODE_MAX), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class AiBudgetDay(Base):
    """全站日预算计数器（08 §7：跨 API 重启保存，不用纯内存计数承诺硬预算）。"""

    __tablename__ = "ai_budget_days"
    __table_args__ = (
        CheckConstraint(
            "reserved_units >= 0 and settled_units >= 0 and request_count >= 0",
            name="counters_non_negative",
        ),
    )

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    reserved_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    settled_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class AiVisitorDay(Base):
    """每访客每天的请求数计数器（08 §7：Cookie 可重置，不能只靠它限费）。"""

    __tablename__ = "ai_visitor_days"
    __table_args__ = (
        CheckConstraint("requests >= 0", name="requests_non_negative"),
        CheckConstraint(
            "reserved_units >= 0 and settled_units >= 0", name="units_non_negative"
        ),
    )

    visitor_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("visitor_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    settled_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


__all__ = [
    "AI_FAILED",
    "AI_PENDING",
    "AI_RELEASED",
    "AI_REQUEST_STATUSES",
    "AI_SUCCEEDED",
    "CONVERSATION_FINISHED",
    "CONVERSATION_FREE",
    "CONVERSATION_SCRIPT",
    "CONVERSATION_STATUSES",
    "MESSAGE_ORIGINS",
    "MESSAGING_TABLES",
    "ORIGIN_AI",
    "ORIGIN_SCRIPT",
    "ORIGIN_SYSTEM",
    "ORIGIN_USER",
    "AiBudgetDay",
    "AiRequest",
    "AiVisitorDay",
    "Conversation",
    "Message",
    "VisitorSession",
    "utcnow",
]
