"""会话隔离：A 浏览器拿不到、改不了 B 的会话（验收用例 2；08 §7）。

要求原文：「知道 conversation UUID 不足以读取会话，每次读取、发送、选项选择、
清除都校验归属」。因此这里**每一个**按 ID 寻址的端点都单独测一遍，
并且断言 B 的数据在攻击前后**逐字节不变**。

关键实现约束：归属条件写在 SQL 的 `WHERE` 里（`visitor_session_id = ?`），
因此「不存在」与「不是你的」返回**同一个 404**，不给 UUID 探测任何信号。
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.modules.messaging import models as m
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    build_client,
    choose,
    create_conversation,
    delete,
    open_visitor,
    post,
    resume,
    restart,
    send,
    texts,
)


def _two_visitors(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    app_client = build_client(
        t08_settings, t08_msg_settings, t08_engine, ("messaging", router)
    )
    # 两个**独立的 Cookie jar**：就是两台浏览器，不是同一客户端的两次调用。
    other_client = build_client(
        t08_settings, t08_msg_settings, t08_engine, ("messaging", router)
    )
    visitor_a = open_visitor(app_client)
    visitor_b = open_visitor(other_client)
    assert visitor_a.visitor_id != visitor_b.visitor_id
    return visitor_a, visitor_b


def test_second_visitor_cannot_read_choose_send_resume_restart_or_clear(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    visitor_a, visitor_b = _two_visitors(t08_settings, t08_msg_settings, t08_engine)

    victim = create_conversation(visitor_b, "futaba")
    victim_id = victim["conversation"]["id"]
    victim_before = texts(victim)
    state = victim["conversation"]

    # --- 读 ---------------------------------------------------------------
    read = visitor_a.client.get(f"{CONVERSATIONS_PATH}/{victim_id}")
    assert read.status_code == 404, read.text
    assert read.json()["error"]["code"] == "NOT_FOUND"

    # --- 选选项 -----------------------------------------------------------
    picked = post(
        visitor_a.client,
        f"{CONVERSATIONS_PATH}/{victim_id}/choice",
        {
            "choice_id": "talk-acm",
            "node_id": state["node_id"],
            "node_version": state["node_version"],
            "client_message_id": "attack-1",
        },
        csrf_token=visitor_a.csrf_token,
    )
    assert picked.status_code == 404, picked.text

    # --- 自由输入 ---------------------------------------------------------
    wrote = send(
        visitor_a,
        {"conversation": {"id": victim_id}},
        "我是别人的浏览器。",
        client_request_id="attack-2",
    )
    assert wrote.status_code == 404, wrote.text

    # --- 回到话题 / 重开 --------------------------------------------------
    assert resume(
        visitor_a, {"conversation": {"id": victim_id, "node_version": state["node_version"]}}
    ).status_code == 404
    assert restart(
        visitor_a, {"conversation": {"id": victim_id, "node_version": state["node_version"]}}
    ).status_code == 404

    # --- 清除 -------------------------------------------------------------
    cleared = delete(
        visitor_a.client,
        f"{CONVERSATIONS_PATH}/{victim_id}",
        csrf_token=visitor_a.csrf_token,
    )
    assert cleared.status_code == 404, cleared.text

    # --- B 的数据完全没变 -------------------------------------------------
    reread = visitor_b.client.get(f"{CONVERSATIONS_PATH}/{victim_id}")
    assert reread.status_code == 200
    after = reread.json()
    assert texts(after) == victim_before
    assert after["conversation"]["node_id"] == state["node_id"]
    assert after["conversation"]["node_version"] == state["node_version"]
    assert (
        t08_session.execute(
            select(func.count())
            .select_from(m.Message)
            .where(m.Message.conversation_id == victim_id)
        ).scalar_one()
        == len(victim_before)
    )


def test_random_uuid_probing_is_always_404(t08_settings, t08_msg_settings, t08_engine):
    """UUID 难猜不构成授权：随便猜一个也是 404，且不泄漏「存在与否」。"""
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor = open_visitor(client)

    for candidate in (
        "00000000-0000-4000-8000-000000000000",
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
        "not-a-uuid",
        "1",
    ):
        response = client.get(f"{CONVERSATIONS_PATH}/{candidate}")
        assert response.status_code == 404, candidate
        assert response.json()["error"]["code"] == "NOT_FOUND"


def test_conversations_are_isolated_per_visitor_for_the_same_character(
    t08_settings, t08_msg_settings, t08_engine
):
    """同一个角色，两位访客各有各的会话与进度，互不可见。"""
    visitor_a, visitor_b = _two_visitors(t08_settings, t08_msg_settings, t08_engine)

    a_view = create_conversation(visitor_a, "futaba")
    b_view = create_conversation(visitor_b, "futaba")
    assert a_view["conversation"]["id"] != b_view["conversation"]["id"]

    moved = choose(visitor_a, a_view, "talk-acm", client_message_id="a-1")
    assert moved.status_code == 200

    reread_b = visitor_b.client.get(f"{CONVERSATIONS_PATH}/{b_view['conversation']['id']}").json()
    assert reread_b["conversation"]["node_id"] == "intro"
    assert reread_b["conversation"]["node_version"] == 0


def test_character_list_only_shows_your_own_summaries(
    t08_settings, t08_msg_settings, t08_engine
):
    """角色列表里的会话摘要是**当前访客自己的**，不是全局最新。"""
    from tests.messaging.helpers import CHARACTERS_PATH

    visitor_a, visitor_b = _two_visitors(t08_settings, t08_msg_settings, t08_engine)
    b_view = create_conversation(visitor_b, "futaba")
    send(visitor_b, b_view, "只有 B 能看到这句", client_request_id="b-1")

    a_list = visitor_a.client.get(CHARACTERS_PATH).json()
    a_futaba = next(item for item in a_list if item["id"] == "futaba")
    assert a_futaba["conversation"] is None

    b_list = visitor_b.client.get(CHARACTERS_PATH).json()
    b_futaba = next(item for item in b_list if item["id"] == "futaba")
    assert b_futaba["conversation"] is not None
    assert b_futaba["conversation"]["id"] == b_view["conversation"]["id"]
    # 摘要是 B 自己的会话里最后一条消息（AI 回复），不含 A 的任何内容
    assert b_futaba["conversation"]["message_count"] == len(b_view["messages"]) + 2
    assert b_futaba["conversation"]["preview"]
    assert "只有 A" not in b_futaba["conversation"]["preview"]


def test_shared_character_url_does_not_leak_any_transcript(
    t08_settings, t08_msg_settings, t08_engine
):
    """分享角色入口不会分享访问者的聊天记录（08 §2）。

    canonical URL 里只有角色 id，没有 conversation UUID，因此「把链接给别人」
    不会带过去任何东西；别人打开时拿到的是**自己的**（空的）会话。
    """
    visitor_a, visitor_b = _two_visitors(t08_settings, t08_msg_settings, t08_engine)
    a_view = create_conversation(visitor_a, "morgana")
    secret = "这是我一个人的秘密输入"
    send(visitor_a, a_view, secret, client_request_id="a-1")

    # B 用同一个角色 id 打开
    b_view = create_conversation(visitor_b, "morgana")
    assert secret not in texts(b_view)
    assert b_view["conversation"]["id"] != a_view["conversation"]["id"]


def test_missing_or_expired_visitor_cookie_is_401_not_someone_elses_data(
    t08_settings, t08_msg_settings, t08_engine
):
    """没有访客 Cookie 时是 401（不是「给你别人的会话」，也不是空 200）。"""
    from app.modules.messaging.router import router

    client = build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    conversation_id = view["conversation"]["id"]

    # 同样的 Cookie jar，但把 Cookie 抹掉
    visitor.client.cookies.clear()
    read = visitor.client.get(f"{CONVERSATIONS_PATH}/{conversation_id}")
    assert read.status_code == 401
    assert read.json()["error"]["code"] == "UNAUTHORIZED"
