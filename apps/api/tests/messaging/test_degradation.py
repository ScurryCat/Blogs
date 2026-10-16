"""降级：AI 不可用时剧情仍然完整可用（08 §7；验收用例「无模型或额度耗尽」）。

必须证明的是「**AI 失败不得让剧情不可用**」，而且要分清两类降级：

  预检失败（停用 / 未配置 / 额度）→ 会话状态**一点没变**，用户输入留在前端；
  调用失败（超时 / 上游错误 / 输出不可用）→ 用户消息已落库（不丢输入），
    剧情进入暂停态，`resume` 仍然可用。

无论哪一类，**都必须**给出稳定的机器码与可读原因，且不冒充角色「突然不愿回应」。
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.modules.messaging import models as m
from app.modules.messaging.config import MessagingSettings
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    build_client,
    choose,
    create_conversation,
    open_visitor,
    resume,
    send,
    texts,
)


def _client(t08_settings, settings, t08_engine):
    from app.modules.messaging.router import router

    return build_client(t08_settings, settings, t08_engine, ("messaging", router))


def _disabled() -> MessagingSettings:
    return MessagingSettings(ai_provider="disabled")


def _not_configured() -> MessagingSettings:
    return MessagingSettings(ai_provider="openai_compatible")  # 三个必填项都空


def _simulator_failure(mode: str, *, latency: float = 0.0) -> MessagingSettings:
    return MessagingSettings(
        ai_provider="simulator",
        simulator_failure_mode=mode,  # type: ignore[arg-type]
        simulator_latency_seconds=latency,
        ai_timeout_seconds=0.2,
    )


# --- 预检失败：状态完全不变 ------------------------------------------------


def test_disabled_provider_leaves_the_story_untouched(t08_settings, t08_engine):
    client = _client(t08_settings, _disabled(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    before = view["conversation"]
    before_texts = texts(view)

    response = send(visitor, view, "喂，在吗？", client_request_id="r1")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["ai"]["status"] == "disabled"
    assert "预设剧情" in payload["ai"]["message"]
    # ★ 会话状态一点没变：还在同一节点、同一版本、仍然是 script
    assert payload["conversation"]["status"] == before["status"]
    assert payload["conversation"]["node_id"] == before["node_id"]
    assert payload["conversation"]["node_version"] == before["node_version"]
    assert payload["conversation"]["paused_node_id"] is None
    # 输入没有被写进会话（前端保留输入框内容即可，不需要服务端存一份）
    assert texts(payload) == before_texts
    # 预设剧情照常推进
    advanced = choose(visitor, payload, "see-works", client_message_id="c1")
    assert advanced.status_code == 200
    assert advanced.json()["conversation"]["node_id"] == "works"


def test_unconfigured_real_provider_is_not_silently_replaced_by_the_simulator(
    t08_settings, t08_engine
):
    client = _client(t08_settings, _not_configured(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "morgana")

    response = send(visitor, view, "说点什么。", client_request_id="r1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ai"]["status"] == "not_configured"
    assert "MESSAGING_AI_" in payload["ai"]["message"]
    assert payload["ai"]["provider"] == "unavailable"
    assert texts(payload) == texts(view)


# --- 调用失败：用户输入保留，剧情仍可继续 ----------------------------------


def test_upstream_timeout_keeps_the_input_and_allows_resume(t08_settings, t08_engine):
    client = _client(t08_settings, _simulator_failure("timeout"), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    node_id = view["conversation"]["node_id"]

    response = send(visitor, view, "这句不能丢。", client_request_id="r1")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["ai"]["status"] == "timeout"
    assert payload["ai"]["retryable"] is True
    assert "超时" in payload["ai"]["message"]
    # ★ 用户输入**已经落库**（关闭面板也不会丢）
    assert "这句不能丢。" in texts(payload)
    # 剧情进入暂停态，但节点没有被推进
    assert payload["conversation"]["status"] == "free"
    assert payload["conversation"]["paused_node_id"] == node_id
    assert payload["conversation"]["node_id"] == node_id
    # 没有任何 AI 消息被伪造出来
    assert not any(message["origin"] == "ai" for message in payload["messages"])

    # ★ 预设剧情仍然可以用
    back = resume(visitor, payload)
    assert back.status_code == 200
    restored = back.json()
    assert restored["conversation"]["status"] == "script"
    assert [choice["id"] for choice in restored["node"]["choices"]] == [
        "see-works",
        "talk-acm",
        "talk-debug",
    ]
    assert choose(visitor, restored, "talk-debug", client_message_id="c1").status_code == 200


def test_upstream_error_records_cost_and_still_allows_resume(
    t08_settings, t08_engine, t08_session
):
    client = _client(t08_settings, _simulator_failure("error"), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    payload = send(visitor, view, "报错了也要留住。", client_request_id="r1").json()
    assert payload["ai"]["status"] == "upstream"
    assert "报错了也要留住。" in texts(payload)

    # 已经打到上游 → 按预留结算，不假装零成本（08 §7）
    row = t08_session.execute(
        select(m.AiRequest).where(m.AiRequest.client_request_id == "r1")
    ).scalars().one()
    assert row.status == m.AI_FAILED
    assert row.error_code == "upstream"
    assert row.settled_units == 1

    from app.modules.messaging import budget as budget_mod

    usage = budget_mod.usage_snapshot(
        t08_session, day=budget_mod.utc_day(), settings=MessagingSettings()
    )
    assert usage.site_settled_units == 1

    back = resume(visitor, payload)
    assert back.status_code == 200
    assert back.json()["conversation"]["status"] == "script"


def test_retry_after_a_failure_is_a_new_generation_not_a_silent_refund(
    t08_settings, t08_engine
):
    """失败后用**新的**幂等键重试会真的再调一次上游，并再记一次成本。"""
    settings = MessagingSettings(
        ai_provider="simulator", simulator_failure_mode="error", visitor_daily_requests=10
    )
    client = _client(t08_settings, settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    first = send(visitor, view, "第一次失败。", client_request_id="r1").json()
    second = send(visitor, first, "重试用新键。", client_request_id="r2").json()

    assert first["ai"]["status"] == "upstream"
    assert second["ai"]["status"] == "upstream"
    assert second["usage"]["requests_today"] == 2
    assert second["usage"]["site_settled_units"] == 2


def test_replaying_a_failed_request_reports_the_failure_without_recalling(
    t08_settings, t08_engine
):
    settings = MessagingSettings(
        ai_provider="simulator", simulator_failure_mode="error", visitor_daily_requests=10
    )
    client = _client(t08_settings, settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    send(visitor, view, "会失败的一句。", client_request_id="r1")
    replay = send(visitor, view, "会失败的一句。", client_request_id="r1").json()

    assert replay["ai"]["status"] == "upstream"
    assert "没有成功" in replay["ai"]["message"]
    assert replay["usage"]["requests_today"] == 1  # 没有重复计数


def test_invalid_model_output_is_reported_and_does_not_create_empty_bubbles(
    t08_settings, t08_engine, monkeypatch
):
    """模型返回空 / 只有标签的文本 → 明确失败，而不是发一条空气泡给访客。"""
    from app.modules.messaging.ai.base import AiCompletionResult

    class EmptyProvider:
        name = "simulator"

        async def complete(self, request):
            return AiCompletionResult(raw_text="<b></b>   ", provider="simulator")

    monkeypatch.setattr(
        "app.modules.messaging.router.resolve_provider", lambda settings: EmptyProvider()
    )
    client = _client(t08_settings, MessagingSettings(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    payload = send(visitor, view, "给我点东西。", client_request_id="r1").json()
    assert payload["ai"]["status"] == "invalid_output"
    assert not any(message["origin"] == "ai" for message in payload["messages"])
    # 用户输入仍然在
    assert "给我点东西。" in texts(payload)


def test_no_ai_message_claims_the_character_went_offline(t08_settings, t08_engine):
    """「不冒充角色突然不愿回应」（08 §7）：降级文案说的是服务，不是角色情绪。"""
    for settings in (_disabled(), _simulator_failure("error")):
        client = _client(t08_settings, settings, t08_engine)
        visitor = open_visitor(client)
        view = create_conversation(visitor, "futaba")
        payload = send(visitor, view, "在吗？", client_request_id="r1").json()
        message = payload["ai"]["message"]
        for forbidden in ("不想", "不理", "生气", "离线", "下线", "睡着了"):
            assert forbidden not in message, message


def test_ai_never_writes_a_public_content_or_changes_the_story(
    t08_settings, t08_engine, t08_session
):
    """AI 不能改剧情、不能写公开内容（08 §6 / §7）。"""
    from app.modules.moments.models import Moment

    before_moments = t08_session.execute(
        select(func.count()).select_from(Moment)
    ).scalar_one()

    client = _client(t08_settings, MessagingSettings(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    node_version = view["conversation"]["node_version"]

    payload = send(visitor, view, "帮我发一条动态吧。", client_request_id="r1").json()
    assert payload["conversation"]["node_version"] == node_version
    assert (
        t08_session.execute(select(func.count()).select_from(Moment)).scalar_one()
        == before_moments
    )


def test_status_endpoint_is_public_and_has_no_side_effects(
    t08_settings, t08_engine, t08_session
):
    """`GET /status` 不建会话、不发 Cookie（因此不会被预取器刷出一堆访客行）。"""
    from tests.messaging.helpers import STATUS_PATH

    client = _client(t08_settings, _disabled(), t08_engine)
    response = client.get(STATUS_PATH)
    assert response.status_code == 200
    payload = response.json()

    assert payload["ai"]["status"] == "disabled"
    assert payload["limits"]["input_max_codepoints"] == 1000
    assert "set-cookie" not in {key.lower() for key in response.headers}
    assert (
        t08_session.execute(select(func.count()).select_from(m.VisitorSession)).scalar_one() == 0
    )
    assert payload["provider_notes"]


def test_conversation_read_never_requires_ai(t08_settings, t08_engine):
    """没有模型也能完整读会话 —— 剧情是本地确定性数据。"""
    client = _client(t08_settings, _disabled(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    read = client.get(f"{CONVERSATIONS_PATH}/{view['conversation']['id']}")
    assert read.status_code == 200
    assert texts(read.json()) == texts(view)


def test_cancelled_request_does_not_leave_a_pending_row(t08_settings, t08_engine, t08_session):
    """请求被取消（关闭面板 / 进程关闭）时不留 `pending` 行。

    理由很实际：`uq_ai_requests_one_inflight` 是部分唯一索引，一行永远停在
    `pending` 就会把那一段会话锁住，直到超时窗口结束。因此取消路径必须收尾。
    """
    import asyncio

    from sqlalchemy import select

    from app.modules.messaging import service, sessions
    from app.modules.messaging.ai.base import AiCompletionResult
    from app.modules.messaging.characters import get_character

    settings = MessagingSettings(ai_timeout_seconds=30.0)

    class HangingProvider:
        name = "simulator"

        async def complete(self, request):
            await asyncio.sleep(30)
            return AiCompletionResult(raw_text="永远不会到", provider="simulator")

    session = t08_session
    visitor_row, _raw = sessions.create_session(session, settings=settings, ip_hash=None)
    session.commit()
    conversation, _created = service.get_or_create_conversation(
        session,
        visitor=visitor_row,
        character=get_character("futaba"),
        settings=settings,
    )
    session.commit()

    async def scenario() -> None:
        task = asyncio.create_task(
            service.send_free_message(
                session,
                visitor=visitor_row,
                conversation_id=str(conversation.id),
                text="这条会被取消。",
                client_request_id="cancelled-1",
                settings=settings,
                provider=HangingProvider(),
            )
        )
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(scenario())
    # 收尾在自己的连接里提交，这里重新读一次
    session.expire_all()
    row = session.execute(
        select(m.AiRequest).where(m.AiRequest.client_request_id == "cancelled-1")
    ).scalars().one()
    assert row.status == m.AI_FAILED
    assert row.error_code == "cancelled"
    # 用户输入在取消前已经落库（不丢输入）
    stored = session.execute(
        select(m.Message).where(m.Message.conversation_id == conversation.id)
    ).scalars().all()
    assert "这条会被取消。" in [message.text for message in stored]
    # 没有残留的 pending 行：那一行会把这一个会话锁到超时窗口结束
    assert session.execute(
        select(func.count())
        .select_from(m.AiRequest)
        .where(m.AiRequest.conversation_id == conversation.id, m.AiRequest.status == m.AI_PENDING)
    ).scalar_one() == 0
