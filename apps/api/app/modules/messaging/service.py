"""会话服务：归属校验、剧情状态机、幂等、预算与 AI 编排（08 §3 / §6 / §7）。

这个文件是「剧情引擎 + 会话服务 + AI 适配层」的汇合点，因此先把几条不变量写在这里：

**不变量**
  I1  任何按 ID 取会话的查询都在 SQL 的 WHERE 里带 `visitor_session_id`。
      不在 Python 里「先查出来再比较」—— 那是最容易漏掉一处的地方。
  I2  `node_id` / `node_version` 只由**成功的剧情推进**修改（选项、重开）。
      自由聊天不推进节点，也不改版本，所以「回到话题」一定回到原节点（08 §3）。
  I3  AI 回复写回时同时匹配 `conversation_id` **和** `character_id`；
      不匹配就丢弃，绝不写进另一段会话。
  I4  一次自由输入的幂等键是 `(visitor_session_id, client_request_id)`；
      命中已存在的行时**不再调用上游**，直接回放已有状态（08 §7）。
  I5  上游调用期间不持有数据库事务：先提交「用户消息 + 预留 + pending」，
      再打网络，最后开新事务写回复。这样关闭面板 / 进程重启都不会丢用户输入。
  I6  AI 失败只影响 `ai.status`，会话本身永远保留可用的剧情状态（08 §7）。

**降级分两类**（都被测试覆盖）：

  预检失败（供应商不可用 / 额度耗尽 / 并发或频率超限）
      → **不改动任何会话状态**，用户输入留在前端输入框里，返回明确原因。
      「保留剧本功能并显示『自由聊天今日已暂停』，不冒充角色突然不愿回应」（08 §7）。

  调用失败（超时 / 传输错误 / 上游 5xx / 输出不可用）
      → 用户消息**已经落库**（I5），剧情进入暂停态，返回明确原因；
      预设剧情通过 `resume` 继续可用（验收用例「AI 超时 / 额度耗尽 / 重试」）。
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import (
    CODE_NOT_FOUND,
    CODE_RATE_LIMITED,
    CODE_UNPROCESSABLE,
    CODE_VALIDATION_FAILED,
    ApiError,
)
from app.modules.messaging import budget as budget_mod
from app.modules.messaging import content as content_mod
from app.modules.messaging import models as m
from app.modules.messaging import stories as stories_mod
from app.modules.messaging.ai.base import (
    AI_ERROR_INTERNAL,
    AI_ERROR_TIMEOUT,
    AiCompletionRequest,
    AiProvider,
    AiProviderError,
    AiTurn,
)
from app.modules.messaging.ai.output import normalize_bubbles
from app.modules.messaging.ai.simulator import PROVIDER_NOTE
from app.modules.messaging.characters import CharacterCard, get_character
from app.modules.messaging.config import MessagingSettings
from app.modules.messaging.content import ResolvedCard, resolve_refs
from app.modules.messaging.schemas import (
    AiStateOut,
    CardOut,
    CharacterOut,
    ChoiceOut,
    ConversationOut,
    ConversationStateOut,
    ConversationSummaryOut,
    LimitsOut,
    MessageOut,
    NodeOut,
    UsageOut,
)

# 对外 AI 状态码（稳定、可断言）。
AI_OK = "ok"
AI_IN_FLIGHT = "in_flight"
AI_REPLAYED = "replayed"

# 「剧情已暂停，不能选选项」等会话级冲突的错误码（HTTP 409）。
CODE_STORY_STALE = "STORY_STATE_STALE"
CODE_STORY_PAUSED = "STORY_PAUSED"
CODE_STORY_FINISHED = "STORY_FINISHED"
CODE_AI_IN_FLIGHT = "AI_IN_FLIGHT"

ATTRIBUTION = {
    m.ORIGIN_USER: "由你发送",
    m.ORIGIN_SCRIPT: "预设剧情（本站原创同人，不是游戏原文）",
    m.ORIGIN_AI: "AI 生成的同人回复",
    m.ORIGIN_SYSTEM: "系统提示",
}

DISCLOSURE = (
    "这是一段非官方同人互动，台词不是游戏原文。预设选项与剧情由本站写死，不会发送给模型；"
    "只有你主动发送的自由输入，以及最近几条会话上下文，会发送给模型服务。"
    "本站最多保留 24 小时会话记录，你可以随时清除；模型供应商自己有独立的处理与保留政策，"
    "本站无法替它承诺。角色消息不会进入公开动态、搜索或站主的其他内容。"
)


# --- 错误 ------------------------------------------------------------------


def not_found(message: str = "这段会话不存在或不可访问") -> ApiError:
    """**统一 404**：不存在、不属于当前访客、已过期三种情况完全同形。

    不给 UUID 探测任何信号（08 §7「知道 conversation UUID 不足以读取会话」）。
    """
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def _conflict(code: str, message: str, fields: dict | None = None) -> ApiError:
    return ApiError(code, message, status_code=409, fields=fields or {})


def _rate_limited(message: str, *, retry_after: int) -> ApiError:
    return ApiError(
        CODE_RATE_LIMITED,
        message,
        status_code=429,
        fields={"retry_after_seconds": [str(retry_after)]},
    )


# --- 查询 ------------------------------------------------------------------


def list_conversations(session: Session, visitor_id: uuid.UUID) -> dict[str, m.Conversation]:
    """当前访客**未过期**的会话，按角色 id 索引。"""
    rows = session.execute(
        select(m.Conversation).where(
            m.Conversation.visitor_session_id == visitor_id,
            m.Conversation.expires_at > utcnow(),
        )
    ).scalars()
    return {row.character_id: row for row in rows}


def load_owned_conversation(
    session: Session, visitor_id: uuid.UUID, conversation_id: str
) -> m.Conversation:
    """按 ID 取会话，**归属写在 WHERE 里**（I1）。任何不匹配都是同一个 404。"""
    try:
        parsed = uuid.UUID(conversation_id)
    except (ValueError, AttributeError, TypeError):
        raise not_found() from None
    row = session.execute(
        select(m.Conversation).where(
            m.Conversation.id == parsed,
            m.Conversation.visitor_session_id == visitor_id,
            m.Conversation.expires_at > utcnow(),
        )
    ).scalars().first()
    if row is None:
        raise not_found()
    return row


def lock_conversation(session: Session, conversation_id: uuid.UUID) -> m.Conversation | None:
    """带行锁读取会话。`seq` 分配与状态迁移都必须在这个锁内进行。"""
    return session.execute(
        select(m.Conversation).where(m.Conversation.id == conversation_id).with_for_update()
    ).scalars().first()


def transcript(session: Session, conversation_id: uuid.UUID) -> list[m.Message]:
    return list(
        session.execute(
            select(m.Message)
            .where(m.Message.conversation_id == conversation_id)
            .order_by(m.Message.seq.asc())
        ).scalars()
    )


def _next_seq(session: Session, conversation_id: uuid.UUID) -> int:
    current = session.execute(
        select(func.max(m.Message.seq)).where(m.Message.conversation_id == conversation_id)
    ).scalar()
    return int(current or 0) + 1


def _append(
    session: Session,
    conversation: m.Conversation,
    *,
    origin: str,
    text: str,
    node_id: str | None = None,
    choice_id: str | None = None,
    cards: list[ResolvedCard] | None = None,
    generation_request_id: uuid.UUID | None = None,
    client_message_id: str | None = None,
    now: datetime | None = None,
) -> m.Message:
    moment = now or utcnow()
    message = m.Message(
        conversation_id=conversation.id,
        # 冗余角色 ID：AI 写回时的匹配条件之一（I3）。
        character_id=conversation.character_id,
        seq=_next_seq(session, conversation.id),
        origin=origin,
        text=text,
        node_id=node_id,
        choice_id=choice_id,
        cards=[card.as_payload() for card in (cards or [])],
        generation_request_id=generation_request_id,
        client_message_id=client_message_id,
        created_at=moment,
    )
    session.add(message)
    conversation.last_message_at = moment
    conversation.updated_at = moment
    session.flush()
    return message


def _extend_lifetime(
    conversation: m.Conversation, settings: MessagingSettings, *, now: datetime
) -> None:
    conversation.expires_at = now + timedelta(seconds=settings.conversation_idle_seconds)


# --- 会话创建与视图 --------------------------------------------------------


@dataclass(frozen=True)
class ViewContext:
    """构建对外视图需要的只读上下文（避免每次重新算一遍用量）。"""

    provider_name: str
    ai: AiStateOut
    usage: UsageOut


def get_or_create_conversation(
    session: Session,
    *,
    visitor: m.VisitorSession,
    character: CharacterCard,
    settings: MessagingSettings,
    now: datetime | None = None,
) -> tuple[m.Conversation, bool]:
    """取得（或创建）这位访客与这个角色之间**唯一**的那段会话。

    「同一角色同时从两处打开时共用会话顺序」（08 §3）靠
    `uq_conversations_visitor_session_character` 保证。并发的两次打开里，
    只有一次能插入成功，另一次拿到唯一冲突后重新读取 —— 不会出现两段会话。

    已过期的会话在这里被**物理删除**（连同消息），然后新建一段：
    「到期删除」不是只把行标一下，正文真的没了（验收用例「清除 / 过期」）。
    """
    moment = now or utcnow()
    story = stories_mod.story_for_character(character.id)
    if story is None:  # pragma: no cover - 剧本仓库校验会在导入时拦住
        raise ApiError(CODE_INTERNAL, "角色没有对应剧本", status_code=500)

    existing = session.execute(
        select(m.Conversation).where(
            m.Conversation.visitor_session_id == visitor.id,
            m.Conversation.character_id == character.id,
        )
    ).scalars().first()

    if existing is not None:
        if existing.expires_at <= moment:
            # 过期即删除正文，再新建一段全新的。
            session.delete(existing)
            session.flush()
            existing = None

    if existing is not None:
        return existing, False

    conversation = m.Conversation(
        visitor_session_id=visitor.id,
        character_id=character.id,
        story_id=story.id,
        story_version=story.version,
        node_id=story.start_node,
        node_version=0,
        status=m.CONVERSATION_SCRIPT,
        created_at=moment,
        updated_at=moment,
        expires_at=moment,
    )
    _extend_lifetime(conversation, settings, now=moment)
    session.add(conversation)
    try:
        session.flush()
    except IntegrityError:
        # 并发创建：回滚这一段，读回另一个请求建好的那段。
        session.rollback()
        raced = session.execute(
            select(m.Conversation).where(
                m.Conversation.visitor_session_id == visitor.id,
                m.Conversation.character_id == character.id,
            )
        ).scalars().first()
        if raced is None:  # pragma: no cover - 唯一冲突后必然能读到
            raise
        return raced, False

    # 开场只插入一次。恢复（resume）与刷新都不会再插一遍（08 §3）。
    start = story.require_node(story.start_node)
    _append_node_lines(session, conversation, start, now=moment)
    session.flush()
    return conversation, True


def _append_node_lines(
    session: Session,
    conversation: m.Conversation,
    node,
    *,
    now: datetime,
) -> list[m.Message]:
    """把节点的台词写成 script 消息；节点卡片挂在**最后一条**台词上。"""
    cards = resolve_refs(session, node.cards)
    created: list[m.Message] = []
    last_index = len(node.lines) - 1
    for index, line in enumerate(node.lines):
        created.append(
            _append(
                session,
                conversation,
                origin=m.ORIGIN_SCRIPT,
                text=line,
                node_id=node.id,
                cards=cards if index == last_index else None,
                now=now,
            )
        )
    return created


def node_payload(conversation: m.Conversation, story) -> NodeOut | None:
    """当前节点的**可交互部分**。台词不重复下发（它们已经在 messages 里）。"""
    if story is None:
        return None
    node_id = conversation.paused_node_id if conversation.status == m.CONVERSATION_FREE else conversation.node_id
    if node_id is None:
        return None
    node = story.node(node_id)
    if node is None:
        # 剧本改过、节点没了：如实返回空节点，让界面提示「这段剧情已不可用」，
        # 而不是抛 500 或者假装还能继续。
        return None
    if conversation.status == m.CONVERSATION_FREE:
        return NodeOut(
            id=node.id,
            ending=node.ending,
            resumable=node.resumable,
            choices=[],
            resume_text=node.resume_text,
        )
    return NodeOut(
        id=node.id,
        ending=node.ending,
        resumable=node.resumable,
        choices=[ChoiceOut(id=choice.id, label=choice.label) for choice in node.choices],
        resume_text=None,
    )


def conversation_state(conversation: m.Conversation) -> ConversationStateOut:
    return ConversationStateOut(
        id=str(conversation.id),
        character_id=conversation.character_id,
        status=conversation.status,
        story_id=conversation.story_id,
        story_version=conversation.story_version,
        node_id=conversation.node_id,
        node_version=conversation.node_version,
        paused_node_id=conversation.paused_node_id,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        expires_at=conversation.expires_at,
        can_send=conversation.status in (m.CONVERSATION_SCRIPT, m.CONVERSATION_FREE),
        can_resume=conversation.status == m.CONVERSATION_FREE,
        can_restart=True,
    )


def message_out(message: m.Message) -> MessageOut:
    return MessageOut(
        id=str(message.id),
        seq=message.seq,
        origin=message.origin,
        text=message.text,
        node_id=message.node_id,
        choice_id=message.choice_id,
        cards=[CardOut(**card) for card in (message.cards or [])],
        created_at=message.created_at,
        generation_request_id=(
            str(message.generation_request_id) if message.generation_request_id else None
        ),
        is_ai=message.origin == m.ORIGIN_AI,
        attribution=ATTRIBUTION.get(message.origin, ""),
    )


def build_view(
    session: Session,
    conversation: m.Conversation,
    *,
    ai: AiStateOut,
    usage: UsageOut,
) -> ConversationOut:
    story = stories_mod.get_story(conversation.story_id)
    return ConversationOut(
        conversation=conversation_state(conversation),
        node=node_payload(conversation, story),
        messages=[message_out(message) for message in transcript(session, conversation.id)],
        ai=ai,
        usage=usage,
    )


def summary_for(conversation: m.Conversation, *, message_count: int, preview: str) -> ConversationSummaryOut:
    return ConversationSummaryOut(
        id=str(conversation.id),
        status=conversation.status,
        node_id=conversation.node_id,
        node_version=conversation.node_version,
        message_count=message_count,
        last_message_at=conversation.last_message_at,
        preview=preview,
        expires_at=conversation.expires_at,
    )


def build_character_list(
    session: Session, *, visitor_id: uuid.UUID | None
) -> list[CharacterOut]:
    """角色目录。带会话摘要时**只带当前访客自己的**；没有会话就是 null。"""
    from app.modules.messaging.characters import CHARACTERS

    conversations = list_conversations(session, visitor_id) if visitor_id else {}
    counts: dict[uuid.UUID, int] = {}
    previews: dict[uuid.UUID, str] = {}
    if conversations:
        ids = [row.id for row in conversations.values()]
        for conversation_id, total in session.execute(
            select(m.Message.conversation_id, func.count())
            .where(m.Message.conversation_id.in_(ids))
            .group_by(m.Message.conversation_id)
        ):
            counts[conversation_id] = int(total)
        # 预览：每段会话最后一条消息的短摘要。
        for row in conversations.values():
            last = session.execute(
                select(m.Message.text)
                .where(m.Message.conversation_id == row.id)
                .order_by(m.Message.seq.desc())
                .limit(1)
            ).scalar()
            previews[row.id] = " ".join((last or "").split())[:40]

    result: list[CharacterOut] = []
    for card in CHARACTERS:
        conversation = conversations.get(card.id)
        story = stories_mod.story_for_character(card.id)
        result.append(
            CharacterOut(
                id=card.id,
                name=card.name,
                handle=card.handle,
                tagline=card.tagline,
                avatar=card.avatar,
                avatar_alt=card.avatar_alt,
                story_id=story.id if story else "",
                story_version=story.version if story else "",
                conversation=(
                    summary_for(
                        conversation,
                        message_count=counts.get(conversation.id, 0),
                        preview=previews.get(conversation.id, ""),
                    )
                    if conversation is not None
                    else None
                ),
            )
        )
    return result


# --- 状态迁移（同步，纯事务）----------------------------------------------


def choose(
    session: Session,
    *,
    visitor: m.VisitorSession,
    conversation_id: str,
    choice_id: str,
    node_id: str,
    node_version: int,
    client_message_id: str,
    settings: MessagingSettings,
    now: datetime | None = None,
) -> m.Conversation:
    """消费一个预设选项。非法 / 过期的选项**不推进剧情**（验收用例 1）。"""
    moment = now or utcnow()
    conversation = load_owned_conversation(session, visitor.id, conversation_id)
    conversation = lock_conversation(session, conversation.id) or conversation

    story = stories_mod.get_story(conversation.story_id)
    if story is None:
        raise _conflict(CODE_STORY_STALE, "这段剧情已经不可用，请重新开始")

    # 幂等：同一个客户端消息 ID 已经处理过 → 直接返回当前状态，不重复消费。
    replay = session.execute(
        select(m.Message.id).where(
            m.Message.conversation_id == conversation.id,
            m.Message.client_message_id == client_message_id,
        )
    ).first()
    if replay is not None:
        return conversation

    if conversation.status == m.CONVERSATION_FREE:
        raise _conflict(
            CODE_STORY_PAUSED,
            "剧情正暂停在自由聊天里，先回到话题再选选项。",
        )
    if conversation.status == m.CONVERSATION_FINISHED:
        raise _conflict(CODE_STORY_FINISHED, "这段剧情已经结束，可以重新开始。")

    if node_id != conversation.node_id or int(node_version) != int(conversation.node_version):
        # 版本不匹配只报告，不消费，也不静默跳到"最新"（08 §3）。
        raise _conflict(
            CODE_STORY_STALE,
            "剧情已经在别处推进了，请读取最新状态后再选。",
            {
                "node_id": [f"当前节点是 {conversation.node_id}"],
                "node_version": [f"当前版本是 {conversation.node_version}"],
            },
        )

    node = story.node(conversation.node_id)
    if node is None:
        raise _conflict(CODE_STORY_STALE, "当前剧情节点已经不存在，请重新开始")

    choice = next((item for item in node.choices if item.id == choice_id), None)
    if choice is None:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "这个选项不在这段剧情里",
            status_code=422,
            fields={"choice_id": ["不是当前节点的合法选项"]},
        )

    _append(
        session,
        conversation,
        origin=m.ORIGIN_USER,
        text=choice.label,
        node_id=node.id,
        choice_id=choice.id,
        client_message_id=client_message_id,
        now=moment,
    )
    next_node = story.require_node(choice.next_node)
    _append_node_lines(session, conversation, next_node, now=moment)
    conversation.node_id = next_node.id
    conversation.node_version = int(conversation.node_version) + 1
    conversation.status = (
        m.CONVERSATION_FINISHED if next_node.ending else m.CONVERSATION_SCRIPT
    )
    conversation.paused_node_id = None
    _extend_lifetime(conversation, settings, now=moment)
    session.flush()
    return conversation


def resume(
    session: Session,
    *,
    visitor: m.VisitorSession,
    conversation_id: str,
    node_version: int,
    settings: MessagingSettings,
    now: datetime | None = None,
) -> tuple[m.Conversation, bool]:
    """回到话题：恢复被暂停节点与它的选项，**不重复插入已展示过的开场**（08 §3）。

    返回 (会话, 是否真的插入了衔接文案)。已经不在暂停态时是幂等的空操作，
    因此重复点击「回到话题」不会刷屏。
    """
    moment = now or utcnow()
    conversation = load_owned_conversation(session, visitor.id, conversation_id)
    conversation = lock_conversation(session, conversation.id) or conversation

    if conversation.status != m.CONVERSATION_FREE:
        return conversation, False
    if int(node_version) != int(conversation.node_version):
        raise _conflict(
            CODE_STORY_STALE,
            "剧情已经在别处推进了，请读取最新状态。",
            {"node_version": [f"当前版本是 {conversation.node_version}"]},
        )

    story = stories_mod.get_story(conversation.story_id)
    paused_id = conversation.paused_node_id
    node = story.node(paused_id) if (story and paused_id) else None
    if node is None or not node.resume_text:
        raise _conflict(CODE_STORY_STALE, "被暂停的剧情节点已经不存在，请重新开始")

    # 只插入衔接文案；节点的台词与卡片不再重复出现。
    _append(
        session,
        conversation,
        origin=m.ORIGIN_SCRIPT,
        text=node.resume_text,
        node_id=node.id,
        now=moment,
    )
    conversation.status = m.CONVERSATION_SCRIPT
    conversation.paused_node_id = None
    _extend_lifetime(conversation, settings, now=moment)
    session.flush()
    return conversation, True


def restart(
    session: Session,
    *,
    visitor: m.VisitorSession,
    conversation_id: str,
    node_version: int,
    settings: MessagingSettings,
    now: datetime | None = None,
) -> m.Conversation:
    """明确重开这段剧情：**保留聊天记录**，只把剧情指针放回起始节点（08 §3）。"""
    moment = now or utcnow()
    conversation = load_owned_conversation(session, visitor.id, conversation_id)
    conversation = lock_conversation(session, conversation.id) or conversation

    if int(node_version) != int(conversation.node_version):
        raise _conflict(
            CODE_STORY_STALE,
            "剧情已经在别处推进了，请读取最新状态。",
            {"node_version": [f"当前版本是 {conversation.node_version}"]},
        )

    story = stories_mod.get_story(conversation.story_id)
    if story is None:
        raise _conflict(CODE_STORY_STALE, "这段剧情已经不可用")

    conversation.status = m.CONVERSATION_SCRIPT
    conversation.paused_node_id = None
    conversation.node_id = story.start_node
    conversation.node_version = int(conversation.node_version) + 1
    _extend_lifetime(conversation, settings, now=moment)

    _append(
        session,
        conversation,
        origin=m.ORIGIN_SYSTEM,
        text="已重新开始这段剧情（之前的聊天记录仍然保留）。",
        node_id=story.start_node,
        now=moment,
    )
    start = story.require_node(story.start_node)
    _append_node_lines(session, conversation, start, now=moment)
    session.flush()
    return conversation


def clear_conversation(
    session: Session, *, visitor: m.VisitorSession, conversation_id: str
) -> None:
    """清除这段会话（消息随之删除）。归属校验走同一条 404 路径。"""
    conversation = load_owned_conversation(session, visitor.id, conversation_id)
    session.execute(
        delete(m.Conversation).where(
            m.Conversation.id == conversation.id,
            m.Conversation.visitor_session_id == visitor.id,
        )
    )
    session.flush()


# --- 自由输入（异步：包含一次上游调用）------------------------------------


@dataclass
class SendOutcome:
    """一次自由输入的结果。`view` 一定可以渲染；`ai` 说明 AI 那一侧发生了什么。"""

    view: ConversationOut
    ai: AiStateOut


def _provider_ai_state(settings: MessagingSettings, provider_name: str) -> AiStateOut | None:
    """预检：供应商是否具备运行条件。不满足时返回明确的降级状态，**不改任何状态**。"""
    ready, reason = settings.provider_ready()
    if ready:
        return None
    status = "disabled" if settings.ai_provider == "disabled" else "not_configured"
    return AiStateOut(
        status=status,
        message=f"自由聊天暂时不可用：{reason}。预设剧情仍然可以继续。",
        provider=provider_name,
        retryable=False,
    )


async def send_free_message(
    session: Session,
    *,
    visitor: m.VisitorSession,
    conversation_id: str,
    text: str,
    client_request_id: str,
    settings: MessagingSettings,
    provider: AiProvider,
    ip_hash: str | None = None,
    now: datetime | None = None,
) -> SendOutcome:
    """自由输入 → AI 回复。整个流程见文件头的**不变量**说明。"""
    moment = now or utcnow()
    conversation = load_owned_conversation(session, visitor.id, conversation_id)
    conversation = lock_conversation(session, conversation.id) or conversation

    normalized = " ".join((text or "").split())
    if not normalized:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "消息不能为空",
            status_code=422,
            fields={"text": ["请输入内容"]},
        )
    if len(normalized) > settings.input_max_codepoints:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            f"消息最多 {settings.input_max_codepoints} 个字符",
            status_code=422,
            fields={"text": [f"当前 {len(normalized)} 个字符"]},
        )

    if conversation.status == m.CONVERSATION_FINISHED:
        raise _conflict(
            CODE_STORY_FINISHED,
            "这段剧情已经结束 —— 自由聊天只在剧情进行中可用，可以先重新开始。",
        )

    # I4：幂等回放。命中就不再打上游，也不新增任何消息。
    existing = session.execute(
        select(m.AiRequest).where(
            m.AiRequest.visitor_session_id == visitor.id,
            m.AiRequest.client_request_id == client_request_id,
        )
    ).scalars().first()
    if existing is not None:
        return SendOutcome(
            view=build_view(
                session,
                conversation,
                ai=_replay_state(existing, settings),
                usage=_usage_view(session, visitor, settings, now=moment),
            ),
            ai=_replay_state(existing, settings),
        )

    state = conversation_state(conversation)
    if not state.can_send:
        raise _conflict(CODE_STORY_FINISHED, "这段剧情已经结束，可以先重新开始。")

    # --- 预检（不改状态）--------------------------------------------------
    provider_state = _provider_ai_state(settings, provider.name)
    if provider_state is not None:
        return SendOutcome(
            view=build_view(
                session,
                conversation,
                ai=provider_state,
                usage=_usage_view(session, visitor, settings, now=moment),
            ),
            ai=provider_state,
        )

    card = get_character(conversation.character_id)
    if card is None:
        # 角色卡被删掉而会话还在：明确降级，不去编一张假卡继续扮演。
        missing_card = AiStateOut(
            status="not_configured",
            message="这个角色的角色卡已经不可用，自由聊天暂时关闭。预设剧情仍然可以继续。",
            provider=provider.name,
            retryable=False,
        )
        return SendOutcome(
            view=build_view(
                session,
                conversation,
                ai=missing_card,
                usage=_usage_view(session, visitor, settings, now=moment),
            ),
            ai=missing_card,
        )

    if budget_mod.conversation_has_inflight(session, conversation.id):
        raise _conflict(
            CODE_AI_IN_FLIGHT,
            "上一条还在生成中，等它出来再发下一条。",
            {"client_request_id": ["同一段会话只允许一个在途请求"]},
        )

    day = budget_mod.utc_day(moment)
    if budget_mod.inflight_count(session, now=moment, settings=settings) >= settings.site_max_concurrency:
        raise _rate_limited(
            "现在同时在生成的请求太多，稍后再试。",
            retry_after=max(1, int(settings.ai_timeout_seconds)),
        )
    if (
        budget_mod.ip_requests_in_window(session, ip_hash=ip_hash, now=moment)
        >= settings.ip_rate_limit_per_minute
    ):
        raise _rate_limited("发送太频繁了，等一分钟再试。", retry_after=60)

    reservation = budget_mod.reserve(
        session,
        visitor_session_id=visitor.id,
        day=day,
        units=settings.units_per_request,
        settings=settings,
    )
    if isinstance(reservation, budget_mod.BudgetRefusal):
        refusal = AiStateOut(
            status=reservation.reason,
            message=f"{reservation.message}预设剧情仍然可以继续。",
            provider=provider.name,
            retryable=False,
        )
        return SendOutcome(
            view=build_view(
                session,
                conversation,
                ai=refusal,
                usage=_usage_view(session, visitor, settings, now=moment),
            ),
            ai=refusal,
        )

    request_row = m.AiRequest(
        conversation_id=conversation.id,
        visitor_session_id=visitor.id,
        client_request_id=client_request_id,
        status=m.AI_PENDING,
        day=day,
        provider=provider.name,
        reserved_units=settings.units_per_request,
        prompt_codepoints=len(normalized),
        created_at=moment,
        updated_at=moment,
    )
    session.add(request_row)
    try:
        session.flush()
    except IntegrityError:
        # 并发重试：多半是同一个幂等键或「单会话一在途」的部分唯一索引。
        session.rollback()
        conversation = load_owned_conversation(session, visitor.id, conversation_id)
        replay = session.execute(
            select(m.AiRequest).where(
                m.AiRequest.visitor_session_id == visitor.id,
                m.AiRequest.client_request_id == client_request_id,
            )
        ).scalars().first()
        if replay is not None:
            state = _replay_state(replay, settings)
            return SendOutcome(
                view=build_view(
                    session,
                    conversation,
                    ai=state,
                    usage=_usage_view(session, visitor, settings, now=moment),
                ),
                ai=state,
            )
        raise _conflict(CODE_AI_IN_FLIGHT, "上一条还在生成中，等它出来再发下一条。") from None

    # 用户消息**在调用上游之前**落库：关闭面板 / 请求取消都不会丢输入（I5）。
    _append(
        session,
        conversation,
        origin=m.ORIGIN_USER,
        text=normalized,
        node_id=conversation.node_id,
        client_message_id=client_request_id,
        now=moment,
    )
    if conversation.status == m.CONVERSATION_SCRIPT:
        # 暂停剧情：记下节点，自由聊天不推进它（I2）。
        conversation.status = m.CONVERSATION_FREE
        conversation.paused_node_id = conversation.node_id
    _extend_lifetime(conversation, settings, now=moment)

    # 模型需要的一切都在**提交之前**取好：上游调用期间不持有任何数据库事务（I5）。
    # 候选内容只包含当前公开的文章 / 动态（草稿与他人的会话根本不在这里）。
    candidates = content_mod.candidate_contents(session, settings.content_candidate_limit)
    history = _history_for_model(session, conversation, settings)
    request = AiCompletionRequest(
        character=card,
        history=history,
        user_text=normalized,
        candidates=tuple(candidates),
        max_bubbles=settings.max_bubbles,
        bubble_max_codepoints=settings.bubble_max_codepoints,
        max_output_codepoints=settings.ai_output_max_codepoints,
        timeout_seconds=settings.ai_timeout_seconds,
        max_attempts=settings.ai_max_attempts,
        retry_backoff_seconds=settings.ai_retry_backoff_seconds,
    )
    session.commit()

    # --- 上游调用（不持有事务）--------------------------------------------
    # 截止时间由**服务**掌握，不依赖任何供应商自觉：供应商自己的超时是第二道防线。
    # 这样即使某个实现挂了，访客也不会无限等待，预算也不会被一个卡住的请求占死。
    try:
        result = await asyncio.wait_for(
            provider.complete(request), timeout=settings.ai_timeout_seconds
        )
        bubbles = normalize_bubbles(
            result.raw_text,
            max_bubbles=settings.max_bubbles,
            bubble_max_codepoints=settings.bubble_max_codepoints,
        )
    except asyncio.TimeoutError:
        return _fail_request(
            session,
            conversation=conversation,
            request_row=request_row,
            visitor=visitor,
            settings=settings,
            provider_name=provider.name,
            code=AI_ERROR_TIMEOUT,
            message="模型响应超时",
            now=moment,
        )
    except asyncio.CancelledError:
        # 请求被取消（进程关闭 / 连接断开触发）：不要把 pending 行留在库里，
        # 否则「单会话一在途」会把这一个会话锁住到超时窗口结束。
        _abandon_request(
            session,
            request_row=request_row,
            provider_name=provider.name,
            code="cancelled",
        )
        raise
    except AiProviderError as error:
        return _fail_request(
            session,
            conversation=conversation,
            request_row=request_row,
            visitor=visitor,
            settings=settings,
            provider_name=provider.name,
            code=error.code,
            message=error.message,
            now=moment,
        )
    except Exception as error:  # pragma: no cover - 兜底，避免任何异常变成 500
        return _fail_request(
            session,
            conversation=conversation,
            request_row=request_row,
            visitor=visitor,
            settings=settings,
            provider_name=provider.name,
            code=AI_ERROR_INTERNAL,
            message="生成回复时出现未预期的问题",
            now=moment,
        )

    cleaned_text, cards = content_mod.extract_cards(result.raw_text, candidates)

    return _finish_request(
        session,
        conversation_id=conversation.id,
        character_id=conversation.character_id,
        request_row=request_row,
        visitor=visitor,
        settings=settings,
        bubbles=bubbles,
        cards=cards,
        provider_name=provider.name,
        prompt_codepoints=request.prompt_codepoints(),
        now=moment,
    )


def _history_for_model(
    session: Session, conversation: m.Conversation, settings: MessagingSettings
) -> tuple[AiTurn, ...]:
    """只取最近几条纯文本（08 §6「按角色组织上下文」）。

    只传 user / script / ai 三种来源：`system` 是本站自己的提示，不进上下文。
    """
    rows = list(
        session.execute(
            select(m.Message)
            .where(
                m.Message.conversation_id == conversation.id,
                m.Message.origin.in_((m.ORIGIN_USER, m.ORIGIN_SCRIPT, m.ORIGIN_AI)),
            )
            .order_by(m.Message.seq.desc())
            .limit(settings.transcript_context_messages)
        ).scalars()
    )
    rows.reverse()
    # 最后一条是刚写入的用户消息，它由 `user_text` 单独传，避免重复。
    if rows and rows[-1].origin == m.ORIGIN_USER:
        rows = rows[:-1]
    return tuple(
        AiTurn(role="user" if row.origin == m.ORIGIN_USER else "assistant", text=row.text)
        for row in rows
    )


def _replay_state(request_row: m.AiRequest, settings: MessagingSettings) -> AiStateOut:
    if request_row.status == m.AI_PENDING:
        return AiStateOut(
            status=AI_IN_FLIGHT,
            message="这条还在生成中，稍等一下。",
            provider=request_row.provider,
            retryable=True,
        )
    if request_row.status == m.AI_SUCCEEDED:
        return AiStateOut(
            status=AI_REPLAYED,
            message="这是之前那次生成的回复，没有重复调用模型，也没有重复计费。",
            provider=request_row.provider,
            retryable=False,
        )
    return AiStateOut(
        status=request_row.error_code or AI_ERROR_INTERNAL,
        message="上次生成没有成功。输入还在，可以再发一次，也可以回到剧情。",
        provider=request_row.provider,
        retryable=True,
    )


def _usage_view(
    session: Session,
    visitor: m.VisitorSession,
    settings: MessagingSettings,
    *,
    now: datetime,
) -> UsageOut:
    snapshot = budget_mod.usage_snapshot(
        session, day=budget_mod.utc_day(now), settings=settings, visitor_session_id=visitor.id, now=now
    )
    remaining = (
        None
        if snapshot.visitor_requests is None
        else max(0, snapshot.visitor_daily_requests - snapshot.visitor_requests)
    )
    return UsageOut(
        requests_today=snapshot.visitor_requests,
        daily_limit=snapshot.visitor_daily_requests,
        remaining=remaining,
        site_settled_units=snapshot.site_settled_units,
        site_daily_units=snapshot.site_daily_units,
        inflight=snapshot.inflight,
    )


def _fail_request(
    session: Session,
    *,
    conversation: m.Conversation,
    request_row: m.AiRequest,
    visitor: m.VisitorSession,
    settings: MessagingSettings,
    provider_name: str,
    code: str,
    message: str,
    now: datetime,
) -> SendOutcome:
    """上游失败的收尾：标记失败、按是否真的打到上游来结算或退还，然后照常返回视图。"""
    conversation = lock_conversation(session, conversation.id) or conversation
    request_row = session.get(m.AiRequest, request_row.id) or request_row
    request_row.status = m.AI_FAILED
    request_row.error_code = code[:32]
    request_row.updated_at = now
    if code in budget_mod.REFUNDABLE_CODES:
        # 根本没打到上游（例如供应商未配置）：退还额度，不记账。
        budget_mod.release(session, request_row)
    else:
        # 已经打到上游：按预留量结算。网络异常不能承诺零成本，但必须如实记录。
        budget_mod.settle(session, request_row)
    session.commit()

    state = AiStateOut(
        status=code,
        message=f"{_friendly(code, message)}预设剧情仍然可以继续（点「回到话题」）。",
        provider=provider_name,
        retryable=True,
    )
    return SendOutcome(
        view=build_view(
            session,
            conversation,
            ai=state,
            usage=_usage_view(session, visitor, settings, now=now),
        ),
        ai=state,
    )


def _abandon_request(
    session: Session,
    *,
    request_row: m.AiRequest,
    provider_name: str,
    code: str,
) -> None:
    """请求被取消时的收尾：标记失败并结算（可能已经打到上游，成本不假装撤销）。"""
    try:
        row = session.get(m.AiRequest, request_row.id) or request_row
        row.status = m.AI_FAILED
        row.error_code = code[:32]
        row.provider = provider_name
        budget_mod.settle(session, row)
        session.commit()
    except Exception:  # pragma: no cover - 收尾本身失败时不再掩盖原始异常
        session.rollback()


def _friendly(code: str, message: str) -> str:
    """给访客看的原因。技术细节留在服务端日志，不把上游原文丢给访客。"""
    mapping = {
        "timeout": "模型响应超时，这次没有拿到回复。",
        "transport": "连不上模型服务，这次没有拿到回复。",
        "upstream": "模型服务返回了错误，这次没有拿到回复。",
        "invalid_output": "模型这次没有给出可用的回复。",
        "not_configured": message or "模型还没有配置好。",
        "internal": "生成回复时出现未预期的问题。",
    }
    return mapping.get(code, message or "模型暂时不可用。")


def _finish_request(
    session: Session,
    *,
    conversation_id: uuid.UUID,
    character_id: str,
    request_row: m.AiRequest,
    visitor: m.VisitorSession,
    settings: MessagingSettings,
    bubbles: list[str],
    cards: list[ResolvedCard],
    provider_name: str,
    prompt_codepoints: int,
    now: datetime,
) -> SendOutcome:
    """把回复写回会话。**I3**：会话 id 与角色 id 必须同时匹配。"""
    conversation = lock_conversation(session, conversation_id)
    request_row = session.get(m.AiRequest, request_row.id) or request_row

    if conversation is None or conversation.character_id != character_id:
        # 旧响应 / 串台的响应：丢弃，绝不写进任何会话。
        request_row.status = m.AI_FAILED
        request_row.error_code = "conversation_mismatch"
        request_row.updated_at = now
        budget_mod.settle(session, request_row)
        session.commit()
        raise not_found("这段会话已经不可用")

    # 每个气泡一条消息，但共享同一个生成请求 ID（客户端据此把一次生成归组）。
    last_index = len(bubbles) - 1
    for index, bubble in enumerate(bubbles):
        _append(
            session,
            conversation,
            origin=m.ORIGIN_AI,
            text=bubble,
            node_id=conversation.paused_node_id or conversation.node_id,
            cards=cards if index == last_index else None,
            generation_request_id=request_row.id,
            now=now,
        )

    request_row.status = m.AI_SUCCEEDED
    request_row.provider = provider_name
    request_row.prompt_codepoints = prompt_codepoints
    request_row.output_codepoints = sum(len(bubble) for bubble in bubbles)
    request_row.error_code = None
    request_row.updated_at = now
    budget_mod.settle(session, request_row)
    _extend_lifetime(conversation, settings, now=now)
    session.commit()

    state = AiStateOut(
        status=AI_OK,
        message="",
        provider=provider_name,
        retryable=False,
    )
    return SendOutcome(
        view=build_view(
            session,
            conversation,
            ai=state,
            usage=_usage_view(session, visitor, settings, now=now),
        ),
        ai=state,
    )


def limits_out(settings: MessagingSettings) -> LimitsOut:
    return LimitsOut(
        input_max_codepoints=settings.input_max_codepoints,
        max_bubbles=settings.max_bubbles,
        visitor_daily_requests=settings.visitor_daily_requests,
        site_daily_units=settings.site_daily_units,
        site_max_concurrency=settings.site_max_concurrency,
        conversation_max_inflight=settings.conversation_max_inflight,
        visitor_session_idle_seconds=settings.visitor_session_idle_seconds,
        conversation_idle_seconds=settings.conversation_idle_seconds,
    )


def provider_notes(settings: MessagingSettings) -> list[str]:
    notes = [PROVIDER_NOTE] if settings.ai_provider == "simulator" else []
    ready, reason = settings.provider_ready()
    notes.append(("可用：" if ready else "不可用：") + reason)
    notes.append(
        "内容卡片只使用服务端当前公开的文章与动态；草稿、私密内容与其他访客的会话"
        "不会进入模型上下文。"
    )
    notes.append("AI 不能修改剧情节点、不能自动跳转页面、不能写入任何公开内容。")
    return notes


__all__ = [
    "AI_IN_FLIGHT",
    "AI_OK",
    "AI_REPLAYED",
    "ATTRIBUTION",
    "CODE_AI_IN_FLIGHT",
    "CODE_STORY_FINISHED",
    "CODE_STORY_PAUSED",
    "CODE_STORY_STALE",
    "DISCLOSURE",
    "SendOutcome",
    "build_character_list",
    "build_view",
    "choose",
    "clear_conversation",
    "conversation_state",
    "get_or_create_conversation",
    "limits_out",
    "list_conversations",
    "load_owned_conversation",
    "lock_conversation",
    "message_out",
    "node_payload",
    "not_found",
    "provider_notes",
    "restart",
    "resume",
    "send_free_message",
    "transcript",
]
