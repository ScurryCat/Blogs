"""剧情 → 自由输入 → 回到剧情：同一段会话（08 §3；验收用例「自由聊后回到话题」）。

这是本包最核心的一组用例。它必须证明的东西，逐条对应任务卡：

  - 预设选项与自由输入**在同一段会话**里交错；
  - 自由聊天**不推进**剧情节点（`node_id` 与 `node_version` 都不变）；
  - 回到话题后**原来的选项还在**，且**不重复插入已经展示过的开场**；
  - 从剧情继续走下去，分支与第一次一致（确定性）。
"""

from __future__ import annotations

from app.modules.messaging import models as m
from tests.messaging.helpers import (
    CONVERSATIONS_PATH,
    build_client,
    choose,
    create_conversation,
    delete,
    open_visitor,
    origins,
    post,
    restart,
    resume,
    send,
    texts,
)


def _client(t08_settings, t08_msg_settings, t08_engine):
    from app.modules.messaging.router import router

    return build_client(t08_settings, t08_msg_settings, t08_engine, ("messaging", router))


def test_story_then_free_chat_then_resume_keeps_node_and_choices(
    t08_settings, t08_msg_settings, t08_engine
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)

    view = create_conversation(visitor, "futaba")
    opening = texts(view)
    node_id = view["conversation"]["node_id"]
    node_version = view["conversation"]["node_version"]
    choice_ids = [choice["id"] for choice in view["node"]["choices"]]

    assert node_id == "intro"
    assert node_version == 0
    assert choice_ids == ["see-works", "talk-acm", "talk-debug"]
    assert view["conversation"]["status"] == "script"

    # 自由输入 → AI 回复
    response = send(visitor, view, "算法题卡了一晚上。", client_request_id="req-1")
    assert response.status_code == 200, response.text
    after_send = response.json()

    assert after_send["ai"]["status"] == "ok", after_send["ai"]
    assert after_send["conversation"]["status"] == "free"
    assert after_send["conversation"]["paused_node_id"] == node_id
    # ★ 剧情没有被模型推进
    assert after_send["conversation"]["node_id"] == node_id
    assert after_send["conversation"]["node_version"] == node_version
    # ★ 暂停时不下发任何选项，界面不能“偷偷”继续分支
    assert after_send["node"]["choices"] == []
    paused_resume_text = after_send["node"]["resume_text"]
    assert paused_resume_text

    new_messages = after_send["messages"][len(opening) :]
    # 一条用户消息 + 一到三条 AI 短气泡（08 §7：每次最多 3 个短气泡）
    assert new_messages[0]["origin"] == "user"
    assert 1 <= len(new_messages) - 1 <= 3
    assert {message["origin"] for message in new_messages[1:]} == {"ai"}
    assert new_messages[0]["text"] == "算法题卡了一晚上。"
    assert all(message["is_ai"] for message in new_messages[1:])
    assert all(
        message["attribution"].startswith("AI 生成") for message in new_messages[1:]
    )
    # 一次生成产生的多条气泡共用一个生成请求 ID
    assert len({message["generation_request_id"] for message in new_messages[1:]}) == 1

    # 回到话题
    back = resume(visitor, after_send)
    assert back.status_code == 200, back.text
    restored = back.json()

    assert restored["conversation"]["status"] == "script"
    assert restored["conversation"]["node_id"] == node_id
    assert restored["conversation"]["node_version"] == node_version
    assert [choice["id"] for choice in restored["node"]["choices"]] == choice_ids

    # ★ 开场没有重复插入：每一句开场台词在整段会话里只出现一次
    all_texts = texts(restored)
    for line in opening:
        assert all_texts.count(line) == 1, f"开场被重复插入了：{line}"

    # 恢复只插入一句衔接文案（origin=script）
    tail = restored["messages"][len(after_send["messages"]) :]
    assert [message["origin"] for message in tail] == ["script"]
    assert tail[0]["text"] == paused_resume_text
    # 恢复之后 `resume_text` 不再下发（选项已经回来了）
    assert restored["node"]["resume_text"] is None

    # ★ 恢复之后原选项真的可以继续用，并且走的是同一条确定分支
    advanced = choose(visitor, restored, "talk-acm", client_message_id="choice-1")
    assert advanced.status_code == 200, advanced.text
    branch = advanced.json()
    assert branch["conversation"]["node_id"] == "acm"
    assert branch["conversation"]["node_version"] == node_version + 1
    assert [choice["id"] for choice in branch["node"]["choices"]] == ["acm-idea", "acm-impl"]


def test_free_chat_can_continue_across_multiple_turns_in_one_conversation(
    t08_settings, t08_msg_settings, t08_engine
):
    """连续自由聊天共用一个暂停节点，回到话题仍然回到它。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "morgana")
    node_id = view["conversation"]["node_id"]

    first = send(visitor, view, "我是第一次来。", client_request_id="req-a").json()
    second = send(visitor, first, "有什么推荐吗？", client_request_id="req-b").json()

    assert second["conversation"]["status"] == "free"
    assert second["conversation"]["paused_node_id"] == node_id
    assert second["conversation"]["node_id"] == node_id
    # 自由聊天里的 AI 消息都带生成请求 ID，客户端可以把一次生成归组
    generations = {
        message["generation_request_id"]
        for message in second["messages"]
        if message["origin"] == "ai"
    }
    assert len(generations) == 2
    assert None not in generations

    resumed = resume(visitor, second).json()
    assert resumed["conversation"]["node_id"] == node_id
    assert resumed["conversation"]["status"] == "script"


def test_resume_is_idempotent(t08_settings, t08_msg_settings, t08_engine):
    """重复点「回到话题」不会刷屏（第二次是空操作）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    paused = send(visitor, view, "先说点别的。", client_request_id="req-1").json()

    first = resume(visitor, paused).json()
    second = resume(visitor, first).json()

    assert texts(second) == texts(first)
    assert second["conversation"]["node_version"] == first["conversation"]["node_version"]


def test_story_walk_is_deterministic(t08_settings, t08_msg_settings, t08_engine):
    """同一串选择永远得到同一条分支（剧情由确定性引擎持有，不是模型）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)

    def walk():
        view = create_conversation(visitor, "futaba")
        view = choose(visitor, view, "talk-debug", client_message_id="c1").json()
        view = choose(visitor, view, "debug-log", client_message_id="c2").json()
        view = choose(visitor, view, "debug-log-wrap", client_message_id="c3").json()
        return view

    first = walk()
    assert first["conversation"]["status"] == "finished"
    assert first["conversation"]["node_id"] == "wrap"
    assert first["node"]["ending"] is True
    assert first["node"]["choices"] == []

    # 清掉再走一遍：分支与结尾完全一致
    assert delete(
        visitor.client,
        f"{CONVERSATIONS_PATH}/{first['conversation']['id']}",
        csrf_token=visitor.csrf_token,
    ).status_code == 204
    second = walk()
    assert second["conversation"]["node_id"] == "wrap"


def test_restart_keeps_transcript_and_returns_to_opening(
    t08_settings, t08_msg_settings, t08_engine
):
    """重开是**明确操作**：只重置剧情指针，不静默删除聊天（08 §3）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "morgana")
    opening = texts(view)

    moved = choose(visitor, view, "how-to-navigate", client_message_id="c1").json()
    assert moved["conversation"]["node_id"] == "navigate"

    fresh = restart(visitor, moved)
    assert fresh.status_code == 200, fresh.text
    payload = fresh.json()

    assert payload["conversation"]["node_id"] == "intro"
    assert payload["conversation"]["status"] == "script"
    assert payload["conversation"]["node_version"] == moved["conversation"]["node_version"] + 1
    # 旧记录还在，只是多了一条系统提示与一段新的开场
    assert "navigate" in [message["node_id"] for message in payload["messages"]]
    system = [message for message in payload["messages"] if message["origin"] == "system"]
    assert len(system) == 1
    assert "重新开始" in system[0]["text"]
    for line in opening:
        assert texts(payload).count(line) == 2  # 第一次 + 重开这一次

    # 重开之后选项重新可用
    again = choose(visitor, payload, "what-to-see", client_message_id="c2")
    assert again.status_code == 200, again.text


def test_clear_removes_the_conversation_and_its_messages(
    t08_settings, t08_msg_settings, t08_engine, t08_session
):
    from sqlalchemy import func, select

    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    conversation_id = view["conversation"]["id"]

    response = delete(
        visitor.client, f"{CONVERSATIONS_PATH}/{conversation_id}", csrf_token=visitor.csrf_token
    )
    assert response.status_code == 204

    # 读不到了
    read = visitor.client.get(f"{CONVERSATIONS_PATH}/{conversation_id}")
    assert read.status_code == 404
    # 正文真的没了（不是只把行标一下）
    assert (
        t08_session.execute(
            select(func.count())
            .select_from(m.Message)
            .where(m.Message.conversation_id == conversation_id)
        ).scalar_one()
        == 0
    )

    # 再打开同一个角色 → 一段全新的会话（开场重新给一次）
    fresh = create_conversation(visitor, "futaba")
    assert fresh["conversation"]["id"] != conversation_id
    assert fresh["conversation"]["node_version"] == 0


def test_reopening_the_same_character_reuses_the_same_conversation(
    t08_settings, t08_msg_settings, t08_engine
):
    """「同一角色同时从两处打开时共用会话顺序」（08 §3）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    first = create_conversation(visitor, "futaba")
    second = create_conversation(visitor, "futaba")

    assert first["conversation"]["id"] == second["conversation"]["id"]
    # 第二次打开不会重复插入开场
    assert texts(second).count(texts(first)[0]) == 1


def test_two_tabs_share_order_and_a_stale_choice_is_rejected(
    t08_settings, t08_msg_settings, t08_engine
):
    """过期版本不能覆盖新的分支（08 §3）。"""
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    tab_a = create_conversation(visitor, "futaba")
    tab_b = create_conversation(visitor, "futaba")

    moved = choose(visitor, tab_a, "talk-acm", client_message_id="tab-a-1")
    assert moved.status_code == 200

    # 标签页 B 手上还是旧版本
    stale = choose(visitor, tab_b, "see-works", client_message_id="tab-b-1")
    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "STORY_STATE_STALE"

    # 旧分支没有被消费，也没有额外消息
    reread = client.get(f"{CONVERSATIONS_PATH}/{tab_a['conversation']['id']}").json()
    assert reread["conversation"]["node_id"] == "acm"
    assert origins(reread).count("user") == 1


def test_ended_story_blocks_free_chat_but_allows_restart(
    t08_settings, t08_msg_settings, t08_engine
):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "morgana")
    view = choose(visitor, view, "where-am-i", client_message_id="c1").json()
    view = choose(visitor, view, "map-wrap", client_message_id="c2").json()
    assert view["conversation"]["status"] == "finished"
    assert view["conversation"]["can_send"] is False

    blocked = send(visitor, view, "喂，还在吗？", client_request_id="req-1")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "STORY_FINISHED"

    # 剧情仍然可读，并且可以重开
    assert restart(visitor, view).status_code == 200


def test_unknown_character_is_422(t08_settings, t08_msg_settings, t08_engine):
    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    response = post(
        client, CONVERSATIONS_PATH, {"character_id": "joker"}, csrf_token=visitor.csrf_token
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_conversation_expiry_deletes_the_transcript_and_starts_fresh(
    t08_settings, t08_msg_settings, t08_engine, t08_session, monkeypatch
):
    """到期即**物理删除正文**，不是只拒绝读取（08 §7 / 验收用例「清除 / 过期」）。"""
    from sqlalchemy import func, select

    from app.core import db as core_db
    from app.modules.messaging import service

    client = _client(t08_settings, t08_msg_settings, t08_engine)
    visitor = open_visitor(client)
    view = create_conversation(visitor, "futaba")
    conversation_id = view["conversation"]["id"]

    # 让「现在」跳到保留期之后
    later = service.utcnow() + __import__("datetime").timedelta(
        seconds=t08_msg_settings.conversation_idle_seconds + 60
    )
    monkeypatch.setattr(core_db, "utcnow", lambda: later)
    monkeypatch.setattr(service, "utcnow", lambda: later)

    fresh = create_conversation(visitor, "futaba")
    assert fresh["conversation"]["id"] != conversation_id
    assert (
        t08_session.execute(
            select(func.count())
            .select_from(m.Message)
            .where(m.Message.conversation_id == conversation_id)
        ).scalar_one()
        == 0
    )
