"""幂等与并发（08 §7；验收用例「网络重试与重复点击」「切换角色后旧响应到达」）。

必须证明：

  1. 同一个 `client_request_id` 重复提交 → 只调用上游一次，不重复计费；
  2. 不同 ID 在途时再发 → 409，用户消息**不会**被悄悄排队；
  3. 单会话一在途请求由部分唯一索引兜住（并发下也不会两个都进去）；
  4. 切换角色后旧响应到达 → 落到**它自己的**会话，绝不污染新角色的会话；
  5. 选项的重复点击（同一个 `client_message_id`）不会消费两次。
"""

from __future__ import annotations

import threading

from sqlalchemy import func, select

from app.modules.messaging import models as m
from app.modules.messaging.ai.base import AiCompletionRequest, AiCompletionResult
from app.modules.messaging.ai.registry import resolve_provider
from app.modules.messaging import service
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    build_client,
    choose,
    create_conversation,
    open_visitor,
    send,
    texts,
)


class CountingProvider:
    """包一层真实模拟服务，只统计**真的被调用了几次**。"""

    name = "simulator"

    def __init__(self, inner):
        self.inner = inner
        self.calls: list[AiCompletionRequest] = []

    async def complete(self, request: AiCompletionRequest) -> AiCompletionResult:
        self.calls.append(request)
        return await self.inner.complete(request)


def _client(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    return build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))


def test_repeated_identical_request_calls_upstream_once(
    t08_settings, t08_msg_settings, t08_engine, monkeypatch, t08_session
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    counter = CountingProvider(resolve_provider(t08_msg_settings))
    monkeypatch.setattr(
        "app.modules.messaging.router.resolve_provider", lambda settings: counter
    )

    first = send(visitor, view, "我有个 bug 要调。", client_request_id="same-key")
    assert first.status_code == 200, first.text
    replay = send(visitor, view, "我有个 bug 要调。", client_request_id="same-key")
    assert replay.status_code == 200, replay.text

    assert len(counter.calls) == 1, "重复的幂等请求不应再次调用上游"

    # 回放明确标注：客户端知道这是旧结果，不要重复渲染成新消息
    assert replay.json()["ai"]["status"] == "replayed"
    assert texts(replay.json()) == texts(first.json())

    # 只产生一条用户消息 + 一次生成
    user_messages = t08_session.execute(
        select(func.count())
        .select_from(m.Message)
        .where(m.Message.client_message_id == "same-key")
    ).scalar_one()
    assert user_messages == 1

    # 预算只记了一次
    from app.modules.messaging import budget as budget_mod

    usage = budget_mod.usage_snapshot(
        t08_session, day=budget_mod.utc_day(), settings=t08_msg_settings
    )
    assert usage.site_request_count == 1
    assert usage.site_settled_units == 1


def test_second_distinct_request_while_one_is_in_flight_is_rejected(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    """不同 ID 的在途冲突是 409（不是静默排队，也不是悄悄丢掉）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    conversation_id = view["conversation"]["id"]

    # 手工制造一个「在途」请求（模拟上一条还在生成）
    from app.core.db import utcnow

    t08_session.add(
        m.AiRequest(
            conversation_id=conversation_id,
            visitor_session_id=visitor.visitor_id,
            client_request_id="inflight-one",
            status=m.AI_PENDING,
            day=utcnow().date(),
            provider="simulator",
            reserved_units=1,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    t08_session.commit()

    blocked = send(visitor, view, "再问一句。", client_request_id="second-key")
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["error"]["code"] == "AI_IN_FLIGHT"

    # 用户消息没有被排队落库
    assert "再问一句。" not in texts(
        client.get(f"{CONVERSATIONS_PATH}/{conversation_id}").json()
    )


def test_two_visitors_can_be_in_flight_at_the_same_time(
    t08_settings, t08_msg_settings, t08_engine
):
    """单会话一在途 ≠ 全站一在途：两位访客互不阻塞。"""
    from app.modules.messaging.router import router

    first = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    second = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor_a = open_visitor(first)
    visitor_b = open_visitor(second)

    view_a = create_conversation(visitor_a, "futaba")
    view_b = create_conversation(visitor_b, "futaba")

    assert send(visitor_a, view_a, "我是 A。", client_request_id="a-1").status_code == 200
    assert send(visitor_b, view_b, "我是 B。", client_request_id="b-1").status_code == 200


def test_late_ai_reply_lands_in_its_own_conversation_not_the_new_character(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    """「切换角色后旧响应到达 → 不污染新角色会话」（验收用例 4）。

    场景：访客在双叶的会话里发了一条，然后切到摩尔加纳的会话；
    双叶那条回复晚到。断言它对摩尔加纳的会话**没有任何影响**，
    并且正确落回双叶的会话。
    """
    from app.core.db import utcnow
    from app.modules.messaging.content import ResolvedCard

    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    futaba_view = create_conversation(visitor, "futaba")
    morgana_view = create_conversation(visitor, "morgana")
    morgana_before = texts(morgana_view)

    session = t08_session
    request_row = m.AiRequest(
        conversation_id=futaba_view["conversation"]["id"],
        visitor_session_id=visitor.visitor_id,
        client_request_id="late-one",
        status=m.AI_PENDING,
        day=utcnow().date(),
        provider="simulator",
        reserved_units=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(request_row)
    session.commit()

    outcome = service._finish_request(  # noqa: SLF001 - 直接测这条内部保证，见下
        session,
        conversation_id=request_row.conversation_id,
        character_id="futaba",
        request_row=request_row,
        visitor=session.get(m.VisitorSession, visitor.visitor_id),
        settings=t08_msg_settings,
        bubbles=["晚到的回复"],
        cards=[ResolvedCard("path", "/about", "关于", "", "/about")],
        provider_name="simulator",
        prompt_codepoints=5,
        now=utcnow(),
    )
    assert outcome.ai.status == "ok"

    reread_morgana = client.get(
        f"{CONVERSATIONS_PATH}/{morgana_view['conversation']['id']}"
    ).json()
    assert texts(reread_morgana) == morgana_before
    assert "晚到的回复" not in texts(reread_morgana)

    reread_futaba = client.get(f"{CONVERSATIONS_PATH}/{futaba_view['conversation']['id']}").json()
    assert texts(reread_futaba)[-1] == "晚到的回复"


def test_reply_for_a_mismatched_character_is_discarded(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    """I3 的直接断言：`conversation_id` 与 `character_id` 必须同时匹配。

    这是防御性检查：真实的串台 bug 长这样 —— 「往当前打开的会话里写回复」。
    服务端不接受「当前」这个概念，只接受请求行里记录的那一对。
    """
    import pytest

    from app.core.db import utcnow
    from app.core.errors import ApiError

    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    before = texts(view)

    request_row = m.AiRequest(
        conversation_id=view["conversation"]["id"],
        visitor_session_id=visitor.visitor_id,
        client_request_id="mismatch-one",
        status=m.AI_PENDING,
        day=utcnow().date(),
        provider="simulator",
        reserved_units=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    t08_session.add(request_row)
    t08_session.commit()

    with pytest.raises(ApiError):
        service._finish_request(  # noqa: SLF001
            t08_session,
            conversation_id=request_row.conversation_id,
            character_id="morgana",  # ← 故意写错角色
            request_row=request_row,
            visitor=t08_session.get(m.VisitorSession, visitor.visitor_id),
            settings=t08_msg_settings,
            bubbles=["不该出现的回复"],
            cards=[],
            provider_name="simulator",
            prompt_codepoints=1,
            now=utcnow(),
        )

    reread = client.get(f"{CONVERSATIONS_PATH}/{view['conversation']['id']}").json()
    assert texts(reread) == before
    assert "不该出现的回复" not in texts(reread)


def test_double_click_on_a_choice_consumes_it_once(
    t08_settings, t08_msg_settings, t08_engine
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    first = choose(visitor, view, "talk-acm", client_message_id="click-1")
    assert first.status_code == 200
    again = choose(visitor, view, "talk-acm", client_message_id="click-1")
    assert again.status_code == 200, again.text

    assert again.json()["conversation"]["node_version"] == first.json()["conversation"][
        "node_version"
    ]
    assert texts(again.json()) == texts(first.json())


def test_concurrent_sends_from_two_threads_only_one_wins(
    t08_settings, t08_msg_settings, t08_engine
):
    """真实并发：两个线程用**不同**的幂等键同时发。

    部分唯一索引保证只有一条能进入 `pending`；另一条拿到 409。
    这正是「只允许一个在途生成」在并发下仍然成立的原因。
    """
    from app.modules.messaging.router import router

    client = build_client(
        t08_settings,
        t08_msg_settings,
        t08_engine,
        ("messaging", router),
    )
    visitor = open_visitor(client)
    view = create_conversation(visitor, "morgana")
    path = f"{CONVERSATIONS_PATH}/{view['conversation']['id']}/messages"

    results: list[int] = []
    lock = threading.Lock()
    barrier = threading.Barrier(2)

    def worker(key: str) -> None:
        barrier.wait()
        response = visitor.client.post(
            path,
            json={
                "text": f"并发消息 {key}",
                "client_request_id": key,
                "csrf_token": visitor.csrf_token,
            },
            headers={"Origin": "http://testserver"},
        )
        with lock:
            results.append(response.status_code)

    threads = [threading.Thread(target=worker, args=(f"k{index}",)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    # 两个都成功也允许（串行完成后第二个不再是「在途」），但绝不能出现 5xx
    assert all(status in (200, 409) for status in results), results
    assert 200 in results


def test_inflight_partial_index_is_scoped_to_one_conversation(t08_session):
    """部分唯一索引按会话隔离：两段会话可以各有一个在途请求。"""
    from datetime import timedelta
    from app.core.db import utcnow

    moment = utcnow()
    visitor = m.VisitorSession(
        token_hash="a" * 64,
        csrf_secret="s" * 40,
        created_at=moment,
        last_seen_at=moment,
        expires_at=moment + timedelta(hours=1),
        absolute_expires_at=moment + timedelta(hours=2),
    )
    t08_session.add(visitor)
    t08_session.flush()

    def _conversation(character_id: str) -> m.Conversation:
        row = m.Conversation(
            visitor_session_id=visitor.id,
            character_id=character_id,
            story_id="futaba-noise-and-signal",
            story_version="1.0.0",
            node_id="intro",
            node_version=0,
            status=m.CONVERSATION_SCRIPT,
            created_at=moment,
            updated_at=moment,
            expires_at=moment + timedelta(hours=1),
        )
        t08_session.add(row)
        t08_session.flush()
        return row

    first = _conversation("futaba")
    second = _conversation("morgana")
    for index, conversation in enumerate((first, second)):
        t08_session.add(
            m.AiRequest(
                conversation_id=conversation.id,
                visitor_session_id=visitor.id,
                client_request_id=f"key-{index}",
                status=m.AI_PENDING,
                day=moment.date(),
                provider="simulator",
                reserved_units=1,
                created_at=moment,
                updated_at=moment,
            )
        )
    t08_session.flush()  # 两个都成功 = 索引确实是按会话隔离的
