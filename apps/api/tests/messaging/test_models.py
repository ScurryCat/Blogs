"""数据库约束（真实 PostgreSQL 执行，不是「服务层也校验了一遍」）。

这些断言对应 08 §6 / §7 里那些**必须由数据库兜住**的东西：
唯一性、部分唯一索引、状态取值、跨表一致性。服务层的校验会随代码演进，
数据库约束是最后一道；如果只测服务层，某天有人绕过 service 直接写库就没人拦。

同时证明 FK 级联真的生效：清除访客会话时，会话与消息**真的一起没了**。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.modules.messaging import models as m


def _visitor(session, **overrides) -> m.VisitorSession:
    from datetime import timedelta

    from app.core.db import utcnow

    moment = utcnow()
    row = m.VisitorSession(
        token_hash=overrides.pop("token_hash", uuid.uuid4().hex + uuid.uuid4().hex[:32]),
        csrf_secret=overrides.pop("csrf_secret", "s" * 40),
        ip_hash=overrides.pop("ip_hash", None),
        created_at=moment,
        last_seen_at=moment,
        expires_at=overrides.pop("expires_at", moment + timedelta(hours=1)),
        absolute_expires_at=overrides.pop("absolute_expires_at", moment + timedelta(hours=2)),
        **overrides,
    )
    session.add(row)
    session.flush()
    return row


def _conversation(session, visitor, **overrides) -> m.Conversation:
    from datetime import timedelta

    from app.core.db import utcnow

    moment = utcnow()
    row = m.Conversation(
        visitor_session_id=visitor.id,
        character_id=overrides.pop("character_id", "futaba"),
        story_id=overrides.pop("story_id", "futaba-noise-and-signal"),
        story_version="1.0.0",
        node_id=overrides.pop("node_id", "intro"),
        node_version=overrides.pop("node_version", 0),
        status=overrides.pop("status", m.CONVERSATION_SCRIPT),
        paused_node_id=overrides.pop("paused_node_id", None),
        created_at=moment,
        updated_at=moment,
        expires_at=moment + timedelta(hours=1),
        **overrides,
    )
    session.add(row)
    session.flush()
    return row


def _message(session, conversation, **overrides) -> m.Message:
    from app.core.db import utcnow

    row = m.Message(
        conversation_id=conversation.id,
        character_id=overrides.pop("character_id", conversation.character_id),
        seq=overrides.pop("seq", 1),
        origin=overrides.pop("origin", m.ORIGIN_SCRIPT),
        text=overrides.pop("text", "第一句"),
        cards=overrides.pop("cards", []),
        created_at=utcnow(),
        **overrides,
    )
    session.add(row)
    session.flush()
    return row


def test_message_origin_is_constrained(t08_session):
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        _message(t08_session, conversation, origin="robot")
    t08_session.rollback()


def test_message_seq_is_unique_per_conversation(t08_session):
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    _message(t08_session, conversation, seq=1)
    with pytest.raises(IntegrityError):
        _message(t08_session, conversation, seq=1, text="重复序号")
    t08_session.rollback()


def test_client_message_id_is_unique_per_conversation(t08_session):
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    _message(t08_session, conversation, seq=1, client_message_id="same")
    with pytest.raises(IntegrityError):
        _message(t08_session, conversation, seq=2, client_message_id="same")
    t08_session.rollback()


def test_client_message_id_may_be_null_many_times(t08_session):
    """PostgreSQL 唯一约束里 NULL 互不相等 —— 没带幂等键的消息不该互相冲突。"""
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    _message(t08_session, conversation, seq=1)
    _message(t08_session, conversation, seq=2)
    assert (
        t08_session.execute(
            select(func.count())
            .select_from(m.Message)
            .where(m.Message.conversation_id == conversation.id)
        ).scalar_one()
        == 2
    )


def test_conversation_is_unique_per_visitor_and_character(t08_session):
    visitor = _visitor(t08_session)
    _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        _conversation(t08_session, visitor)
    t08_session.rollback()


def test_two_visitors_may_both_talk_to_the_same_character(t08_session):
    first = _visitor(t08_session)
    second = _visitor(t08_session)
    _conversation(t08_session, first)
    _conversation(t08_session, second)
    assert (
        t08_session.execute(select(func.count()).select_from(m.Conversation)).scalar_one() == 2
    )


def test_paused_node_must_match_status(t08_session):
    visitor = _visitor(t08_session)
    with pytest.raises(IntegrityError):
        # status=free 却没有 paused_node_id
        _conversation(t08_session, visitor, status=m.CONVERSATION_FREE)
    t08_session.rollback()

    visitor = _visitor(t08_session)
    with pytest.raises(IntegrityError):
        # status=script 却带着 paused_node_id
        _conversation(t08_session, visitor, paused_node_id="intro")
    t08_session.rollback()

    visitor = _visitor(t08_session)
    row = _conversation(
        t08_session, visitor, status=m.CONVERSATION_FREE, paused_node_id="intro"
    )
    assert row.status == m.CONVERSATION_FREE


def test_conversation_status_and_version_are_constrained(t08_session):
    visitor = _visitor(t08_session)
    with pytest.raises(IntegrityError):
        _conversation(t08_session, visitor, status="idle")
    t08_session.rollback()

    visitor = _visitor(t08_session)
    with pytest.raises(IntegrityError):
        _conversation(t08_session, visitor, node_version=-1)
    t08_session.rollback()


def test_message_text_length_is_bounded(t08_session):
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        _message(t08_session, conversation, text="x" * (m.TEXT_MAX_CODEPOINTS + 1))
    t08_session.rollback()

    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        _message(t08_session, conversation, text="")
    t08_session.rollback()


def test_cards_must_be_a_json_array(t08_session):
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        _message(t08_session, conversation, cards={"kind": "post"})
    t08_session.rollback()


def test_one_conversation_can_only_have_one_pending_ai_request(t08_session):
    """`uq_ai_requests_one_inflight`：单会话一在途请求的**数据库级**保证（08 §7）。"""
    from app.core.db import utcnow

    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)

    def _request(client_request_id: str, status: str) -> m.AiRequest:
        row = m.AiRequest(
            conversation_id=conversation.id,
            visitor_session_id=visitor.id,
            client_request_id=client_request_id,
            status=status,
            day=utcnow().date(),
            provider="simulator",
            reserved_units=1,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        t08_session.add(row)
        t08_session.flush()
        return row

    first = _request("r1", m.AI_PENDING)
    first.status = m.AI_SUCCEEDED
    t08_session.flush()
    # 已经结算的那条不占在途名额
    _request("r2", m.AI_PENDING)
    with pytest.raises(IntegrityError):
        _request("r3", m.AI_PENDING)
    t08_session.rollback()


def test_ai_request_client_request_id_is_unique_per_visitor(t08_session):
    from app.core.db import utcnow

    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    for index in range(2):
        t08_session.add(
            m.AiRequest(
                conversation_id=conversation.id,
                visitor_session_id=visitor.id,
                client_request_id="same-key",
                status=m.AI_SUCCEEDED if index == 0 else m.AI_PENDING,
                day=utcnow().date(),
                provider="simulator",
                reserved_units=1,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )
        if index == 0:
            t08_session.flush()
            continue
        with pytest.raises(IntegrityError):
            t08_session.flush()
    t08_session.rollback()


def test_ai_request_status_and_units_are_constrained(t08_session):
    from app.core.db import utcnow

    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        t08_session.add(
            m.AiRequest(
                conversation_id=conversation.id,
                visitor_session_id=visitor.id,
                client_request_id="bad",
                status="thinking",
                day=utcnow().date(),
                provider="simulator",
                reserved_units=1,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )
        t08_session.flush()
    t08_session.rollback()

    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    with pytest.raises(IntegrityError):
        t08_session.add(
            m.AiRequest(
                conversation_id=conversation.id,
                visitor_session_id=visitor.id,
                client_request_id="negative",
                status=m.AI_PENDING,
                day=utcnow().date(),
                provider="simulator",
                reserved_units=-1,
                created_at=utcnow(),
                updated_at=utcnow(),
            )
        )
        t08_session.flush()
    t08_session.rollback()


def test_deleting_a_visitor_removes_conversations_messages_and_requests(t08_session):
    """清除访客 → 会话与消息**真的删除**（08 §7「访客可以立即清除聊天」）。"""
    from app.core.db import utcnow

    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    _message(t08_session, conversation, seq=1)
    _message(t08_session, conversation, seq=2)
    t08_session.add(
        m.AiRequest(
            conversation_id=conversation.id,
            visitor_session_id=visitor.id,
            client_request_id="r1",
            status=m.AI_SUCCEEDED,
            day=utcnow().date(),
            provider="simulator",
            reserved_units=1,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    t08_session.flush()

    t08_session.delete(visitor)
    t08_session.flush()

    for model in (m.Conversation, m.Message, m.AiRequest):
        assert (
            t08_session.execute(select(func.count()).select_from(model)).scalar_one() == 0
        ), model.__name__


def test_deleting_a_conversation_removes_its_messages(t08_session):
    visitor = _visitor(t08_session)
    conversation = _conversation(t08_session, visitor)
    _message(t08_session, conversation, seq=1)

    t08_session.delete(conversation)
    t08_session.flush()
    assert t08_session.execute(select(func.count()).select_from(m.Message)).scalar_one() == 0


def test_public_listing_partial_index_exists_on_ai_requests(t08_session):
    """在 `pg_indexes` 里确认部分唯一索引的**真实定义**含 `WHERE status = 'pending'`。

    只断言「有个索引叫这个名字」不足以说明它是部分索引 ——
    那样它就会把同一会话的历史成功请求也算成冲突。
    """
    definition = t08_session.execute(
        text("select indexdef from pg_indexes where indexname = 'uq_ai_requests_one_inflight'")
    ).scalar_one()
    assert "UNIQUE" in definition.upper()
    assert "status" in definition and "pending" in definition


def test_visitor_session_token_hash_is_unique(t08_session):
    visitor = _visitor(t08_session)
    with pytest.raises(IntegrityError):
        _visitor(t08_session, token_hash=visitor.token_hash)
    t08_session.rollback()


def test_schema_report_reports_fallback_tables(t08_schema_report):
    """集成迁移落地后该列表应为空；现在如实报告哪些表是夹具补的。"""
    fallback = t08_schema_report["created_by_fallback"]
    assert isinstance(fallback, list)
    assert set(fallback) <= set(
        (
            "visitor_sessions",
            "conversations",
            "messages",
            "ai_requests",
            "ai_budget_days",
            "ai_visitor_days",
        )
    )
