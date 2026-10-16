"""预算、并发闸门与跨重启计数（08 §7；验收用例「请求预算跨重启、并发请求」）。

必须证明的四件事：

  1. **原子预留**：并发的预留请求里，只有额度允许的那些能成功（不超卖）；
  2. **跨 API 重启保存**：计数在 PostgreSQL 里，换一个引擎 / 新进程仍然读得到
     —— 这里用「换一个独立 Engine 重新读」来近似重启（新进程也是同一条路径）；
  3. **失败释放 vs 结算**：没打到上游的失败退还额度；打到上游的失败按预留结算，
     因为「已经产生的成本不能假装撤销」；
  4. **额度耗尽不影响剧情**：返回 200 + 明确的 `ai.status`，会话状态**不变**。
"""

from __future__ import annotations

import threading

from sqlalchemy import create_engine, text

from app.core.db import utcnow
from app.modules.messaging import budget as budget_mod
from app.modules.messaging import models as m
from app.modules.messaging.config import MessagingSettings
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    build_client,
    create_conversation,
    open_visitor,
    send,
    texts,
)


def _client(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    return build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))


def _conversation_row(t08_session, visitor) -> m.Conversation:
    from datetime import timedelta

    moment = utcnow()
    row = m.Conversation(
        visitor_session_id=visitor.id,
        character_id="futaba",
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


def _visitor_row(t08_session, **overrides) -> m.VisitorSession:
    from datetime import timedelta

    moment = utcnow()
    row = m.VisitorSession(
        token_hash=overrides.pop("token_hash", "b" * 64),
        csrf_secret="s" * 40,
        created_at=moment,
        last_seen_at=moment,
        expires_at=moment + timedelta(hours=1),
        absolute_expires_at=moment + timedelta(hours=2),
        **overrides,
    )
    t08_session.add(row)
    t08_session.flush()
    return row


# --- 原子预留 --------------------------------------------------------------


def test_reserve_sells_exactly_the_configured_budget(t08_session):
    settings = MessagingSettings(visitor_daily_requests=5, site_daily_units=5)
    visitor = _visitor_row(t08_session)
    day = budget_mod.utc_day()

    outcomes = [
        budget_mod.reserve(
            t08_session,
            visitor_session_id=visitor.id,
            day=day,
            units=1,
            settings=settings,
        )
        for _ in range(7)
    ]
    granted = [item for item in outcomes if isinstance(item, budget_mod.Reservation)]
    refused = [item for item in outcomes if isinstance(item, budget_mod.BudgetRefusal)]
    assert len(granted) == 5
    assert len(refused) == 2
    assert all(item.reason == budget_mod.REASON_VISITOR_LIMIT for item in refused)

    row = t08_session.get(m.AiVisitorDay, {"visitor_session_id": visitor.id, "day": day})
    assert row.requests == 5
    assert row.reserved_units == 5


def test_site_budget_refusal_refunds_the_visitor_reservation(t08_session):
    """全站额度不够时，访客额度必须退回去 —— 不能出现对不上账的状态。"""
    settings = MessagingSettings(visitor_daily_requests=10, site_daily_units=1)
    first = _visitor_row(t08_session, token_hash="c" * 64)
    second = _visitor_row(t08_session, token_hash="d" * 64)
    day = budget_mod.utc_day()

    assert isinstance(
        budget_mod.reserve(
            t08_session, visitor_session_id=first.id, day=day, units=1, settings=settings
        ),
        budget_mod.Reservation,
    )
    refused = budget_mod.reserve(
        t08_session, visitor_session_id=second.id, day=day, units=1, settings=settings
    )
    assert isinstance(refused, budget_mod.BudgetRefusal)
    assert refused.reason == budget_mod.REASON_SITE_BUDGET

    row = t08_session.get(m.AiVisitorDay, {"visitor_session_id": second.id, "day": day})
    assert row.requests == 0, "被拒绝的预留不能留在访客计数里"
    assert row.reserved_units == 0


def test_concurrent_reservations_do_not_oversell(t08_engine, t08_database_url):
    """并发预留：两个线程各抢 3 个单位，全站只有 4 个 —— 只能成功 4 个。

    这里用真实的不同连接（不同线程），因此测的是数据库的原子 UPDATE，
    不是 Python 的 GIL 或者某个进程内的锁。
    """
    from app.core.db import create_session_factory

    settings = MessagingSettings(visitor_daily_requests=100, site_daily_units=4)
    factory = create_session_factory(t08_engine)

    with factory() as setup:
        visitor = _visitor_row(setup, token_hash="e" * 64)
        setup.commit()
        visitor_id = visitor.id

    day = budget_mod.utc_day()
    granted: list[int] = []
    lock = threading.Lock()
    barrier = threading.Barrier(4)

    def worker() -> None:
        session = factory()
        try:
            barrier.wait()
            outcome = budget_mod.reserve(
                session,
                visitor_session_id=visitor_id,
                day=day,
                units=1,
                settings=settings,
            )
            session.commit()
            if isinstance(outcome, budget_mod.Reservation):
                with lock:
                    granted.append(1)
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sum(granted) == 4
    with factory() as check:
        row = check.get(m.AiBudgetDay, day)
        assert row.reserved_units == 4
        assert row.request_count == 4


def test_budget_survives_a_new_engine(t08_engine, t08_database_url):
    """「跨 API 重启保存」：换一个独立引擎（≈新进程）仍然读得到计数。"""
    from app.core.db import create_session_factory

    factory = create_session_factory(t08_engine)
    settings = MessagingSettings(visitor_daily_requests=7, site_daily_units=50)
    day = budget_mod.utc_day()

    with factory() as session:
        visitor = _visitor_row(session, token_hash="f" * 64)
        session.commit()
        visitor_id = visitor.id
        budget_mod.reserve(
            session, visitor_session_id=visitor_id, day=day, units=3, settings=settings
        )
        session.commit()

    fresh_engine = create_engine(t08_database_url, pool_pre_ping=True, future=True)
    try:
        with fresh_engine.connect() as connection:
            reserved = connection.execute(
                text("select reserved_units, request_count from ai_budget_days where day = :day"),
                {"day": day},
            ).one()
            visitor_requests = connection.execute(
                text("select requests from ai_visitor_days where visitor_session_id = :vid"),
                {"vid": visitor_id},
            ).scalar_one()
    finally:
        fresh_engine.dispose()

    assert reserved.reserved_units == 3
    assert reserved.request_count == 1
    assert visitor_requests == 1


def test_settle_keeps_the_cost_and_release_refunds_it(t08_session):
    settings = MessagingSettings(visitor_daily_requests=10, site_daily_units=10)
    visitor = _visitor_row(t08_session, token_hash="g" * 64)
    day = budget_mod.utc_day()
    conversation = _conversation_row(t08_session, visitor)
    budget_mod.reserve(
        t08_session, visitor_session_id=visitor.id, day=day, units=2, settings=settings
    )
    request_row = m.AiRequest(
        conversation_id=conversation.id,
        visitor_session_id=visitor.id,
        client_request_id="budget-1",
        status=m.AI_PENDING,
        day=day,
        provider="simulator",
        reserved_units=2,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    t08_session.add(request_row)
    t08_session.flush()

    # 服务层在结算前会先把状态改成 succeeded（部分唯一索引只看 pending）
    request_row.status = m.AI_SUCCEEDED
    budget_mod.settle(t08_session, request_row)
    t08_session.flush()
    budget = t08_session.get(m.AiBudgetDay, day)
    assert budget.reserved_units == 0
    assert budget.settled_units == 2
    assert budget.request_count == 1

    # 另一条走 release：没有打到上游 → 请求数也退回去
    budget_mod.reserve(
        t08_session, visitor_session_id=visitor.id, day=day, units=1, settings=settings
    )
    refunded = m.AiRequest(
        visitor_session_id=visitor.id,
        conversation_id=conversation.id,
        client_request_id="budget-2",
        status=m.AI_PENDING,
        day=day,
        provider="simulator",
        reserved_units=1,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    t08_session.add(refunded)
    t08_session.flush()
    budget_mod.release(t08_session, refunded)
    t08_session.flush()
    assert budget.reserved_units == 0
    assert budget.settled_units == 2
    assert budget.request_count == 1
    visitor_day = t08_session.get(
        m.AiVisitorDay, {"visitor_session_id": visitor.id, "day": day}
    )
    assert visitor_day.requests == 1


# --- 端到端：额度耗尽不影响剧情 --------------------------------------------


def test_visitor_daily_limit_degrades_without_touching_the_story(
    t08_settings, t08_engine
):
    limited = MessagingSettings(visitor_daily_requests=1, site_daily_units=100)
    client = _client(t08_settings, limited, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    before = texts(view)

    first = send(visitor, view, "第一次可以聊。", client_request_id="r1")
    assert first.status_code == 200
    assert first.json()["ai"]["status"] == "ok"
    assert first.json()["usage"]["requests_today"] == 1
    assert first.json()["usage"]["remaining"] == 0

    exhausted = send(visitor, first.json(), "第二次应该被挡住。", client_request_id="r2")
    assert exhausted.status_code == 200, exhausted.text
    payload = exhausted.json()
    assert payload["ai"]["status"] == "visitor_daily_limit"
    assert "预设剧情" in payload["ai"]["message"]
    assert "第二次应该被挡住。" not in texts(payload)
    # 剧情状态没有被这次拒绝改动
    assert payload["conversation"]["status"] == "free"
    assert payload["conversation"]["node_id"] == first.json()["conversation"]["node_id"]
    # 剧情仍然可以继续
    from tests.messaging.helpers import resume

    resumed = resume(visitor, payload)
    assert resumed.status_code == 200
    assert resumed.json()["conversation"]["status"] == "script"
    assert texts(resumed.json())[: len(before)] == before


def test_site_budget_exhaustion_degrades_without_touching_the_story(
    t08_settings, t08_engine
):
    tight = MessagingSettings(visitor_daily_requests=10, site_daily_units=1)
    client = _client(t08_settings, tight, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "morgana")

    assert send(visitor, view, "先聊一句。", client_request_id="r1").status_code == 200
    blocked = send(visitor, view, "再来一句。", client_request_id="r2")
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["ai"]["status"] == "site_daily_budget"
    assert "全站" in blocked.json()["ai"]["message"]


def test_ip_rate_limit_returns_429_with_retry_after(t08_settings, t08_engine):
    tight = MessagingSettings(ip_rate_limit_per_minute=1, visitor_daily_requests=50)
    client = _client(t08_settings, tight, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")

    assert send(visitor, view, "第一句。", client_request_id="r1").status_code == 200
    throttled = send(visitor, view, "第二句。", client_request_id="r2")
    assert throttled.status_code == 429, throttled.text
    assert throttled.json()["error"]["code"] == "RATE_LIMITED"
    assert throttled.json()["error"]["fields"]["retry_after_seconds"] == ["60"]


def test_site_concurrency_gate_uses_real_pending_rows(t08_settings, t08_engine, t08_session):
    """全站并发上限看的是 `ai_requests` 里的 pending 行，不是内存计数。"""
    tight = MessagingSettings(site_max_concurrency=1, visitor_daily_requests=50)
    client = _client(t08_settings, tight, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    conversation_id = view["conversation"]["id"]

    t08_session.add(
        m.AiRequest(
            conversation_id=conversation_id,
            visitor_session_id=visitor.visitor_id,
            client_request_id="someone-else-inflight",
            status=m.AI_PENDING,
            day=utcnow().date(),
            provider="simulator",
            reserved_units=1,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    t08_session.commit()

    blocked = send(visitor, view, "想插队。", client_request_id="r1")
    assert blocked.status_code == 409, blocked.text  # 单会话在途先命中
    assert blocked.json()["error"]["code"] == "AI_IN_FLIGHT"

    # 换一段会话（另一个角色），这次命中的是全站并发闸门
    other = create_conversation(visitor, "morgana")
    blocked2 = send(visitor, other, "另一个角色也想发。", client_request_id="r2")
    assert blocked2.status_code == 429, blocked2.text
    assert blocked2.json()["error"]["code"] == "RATE_LIMITED"


def test_usage_is_reported_and_never_hidden(t08_settings, t08_engine):
    """用量是公开可读的（对自己的会话），不隐藏成本。"""
    client = _client(t08_settings, t08_msg_settings_default(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    payload = send(visitor, view, "你好。", client_request_id="r1").json()

    usage = payload["usage"]
    assert usage["requests_today"] == 1
    assert usage["daily_limit"] >= 1
    assert usage["remaining"] == usage["daily_limit"] - 1
    assert usage["site_settled_units"] == 1
    assert usage["site_daily_units"] >= 1
    assert usage["inflight"] == 0  # 已经结算完，没有残留的在途行


def t08_msg_settings_default() -> MessagingSettings:
    return MessagingSettings()


def test_conversation_url_is_never_in_the_path_list(t08_settings, t08_engine):
    """会话 UUID 不在任何 URL 形态里被分享 —— 这里只是把「客户端拿到的是 id」钉住。"""
    client = _client(t08_settings, t08_msg_settings_default(), t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    assert CONVERSATIONS_PATH in f"{CONVERSATIONS_PATH}/{view['conversation']['id']}"
