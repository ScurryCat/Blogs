"""边界与「刻意不做的事」（验收 2 / 3 / 5 / 6、07 §4）。

这一组用例是**反向断言**：它们钉住「本站不做什么」，避免以后有人顺手加回
访问次数、好感度等级、在线状态、朋友的最新动态或匿名自动发布的申请库。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.modules.coop import service
from app.modules.coop.models import FriendLink, FriendLinkTag
from tests.coop.helpers import (
    admin_login,
    assert_error,
    create_payload,
    make_published_link,
    unique_name,
    write_headers,
)

# 公开 DTO 的完整字段集合。多一个字段就要在这里显式改一次 —— 防止将来悄悄加统计字段。
PUBLIC_SUMMARY_KEYS = {
    "id",
    "name",
    "url",
    "summary",
    "arcana",
    "tags",
    "avatar",
    "has_story",
}
PUBLIC_DETAIL_KEYS = PUBLIC_SUMMARY_KEYS | {"story"}

ADMIN_KEYS = {
    "id",
    "name",
    "url",
    "summary",
    "story",
    "arcana",
    "avatar_media_id",
    "avatar",
    "tags",
    "position",
    "status",
    "published_at",
    "created_at",
    "updated_at",
    "deleted_at",
    "version",
}

# 本站不存、也不返回的字段（07 §4：不根据点击量生成好感度或 RANK，不伪造在线状态）。
FORBIDDEN_KEYS = {
    "rank",
    "rank_level",
    "coop_rank",
    "level",
    "affection",
    "favor",
    "friendship",
    "visits",
    "clicks",
    "view_count",
    "hit_count",
    "popularity",
    "online",
    "is_online",
    "last_seen",
    "latest_post",
    "latest_post_title",
    "feed_url",
    "unread",
    "unread_count",
    "message_count",
    "points",
}


def test_public_dto_exposes_exactly_the_documented_fields(public_client, t07_session):
    link = make_published_link(
        t07_session,
        name=unique_name(),
        story="故事",
        arcana="I · MAGICIAN",
        tags=("前端",),
    )

    summary = public_client.get("/api/v1/coop/links").json()["items"][0]
    detail = public_client.get(f"/api/v1/coop/links/{link.id}").json()

    assert set(summary) == PUBLIC_SUMMARY_KEYS
    assert set(detail) == PUBLIC_DETAIL_KEYS
    assert not (set(summary) | set(detail)) & FORBIDDEN_KEYS


def test_admin_dto_has_no_statistics_fields_either(coop_client, t07_session):
    admin_login(coop_client, t07_session)
    link = make_published_link(t07_session, name=unique_name())

    detail = coop_client.get(f"/api/v1/admin/friends/{link.id}").json()

    assert set(detail) == ADMIN_KEYS
    assert not set(detail) & FORBIDDEN_KEYS


def test_model_has_no_rank_counter_or_presence_columns():
    columns = {column.name for column in FriendLink.__table__.columns}
    tag_columns = {column.name for column in FriendLinkTag.__table__.columns}

    assert not columns & FORBIDDEN_KEYS
    assert not tag_columns & FORBIDDEN_KEYS
    # 反向确认：我们确实存了这些（避免上面的断言因为「字段名全写错」而永远通过）。
    assert {"name", "url", "summary", "story", "arcana", "avatar_media_id", "position"} <= columns


def test_there_is_no_anonymous_application_endpoint(public_client, t07_session):
    """申请入口指向已有联系方式 / 留言板，不新建匿名自动发布的申请库（验收第 6 条）。"""
    response = public_client.post("/api/v1/coop/links", json={"name": "自荐友链"})

    assert_error(response, status=405, code="METHOD_NOT_ALLOWED")


def test_summary_and_story_are_plain_text_round_trip(coop_client, t07_session):
    """纯文本字段原样往返；服务端不解析、不转义、也不生成 HTML（验收第 2 条）。"""
    session_state = admin_login(coop_client, t07_session)
    payload = create_payload(
        name=unique_name(),
        summary='<script>alert("x")</script> 与 <b>加粗</b>',
        story="<img src=x onerror=alert(1)>",
    )

    created = coop_client.post(
        "/api/v1/admin/friends",
        json={**payload, "csrf_token": session_state["csrf_token"]},
        headers=write_headers(session_state["csrf_token"]),
    ).json()

    assert created["summary"] == '<script>alert("x")</script> 与 <b>加粗</b>'
    assert created["story"] == "<img src=x onerror=alert(1)>"
    # 没有 html / rendered / safe_html 之类字段：渲染方式由前端用文本节点决定。
    assert not [key for key in created if "html" in key.lower()]


def test_database_rejects_executable_scheme_even_without_service(t07_session):
    """数据库 CHECK 是第二道锁：绕过服务层也写不进 `javascript:` 地址。"""
    link = FriendLink(name=unique_name(), url="javascript:alert(1)", position=0)

    with pytest.raises(IntegrityError):
        with t07_session.begin_nested():
            t07_session.add(link)
            t07_session.flush()


def test_database_rejects_blank_name(t07_session):
    link = FriendLink(name="   ", url="https://example.com/", position=0)

    with pytest.raises(IntegrityError):
        with t07_session.begin_nested():
            t07_session.add(link)
            t07_session.flush()


def test_database_rejects_out_of_range_position(t07_session):
    link = FriendLink(name=unique_name(), url="https://example.com/", position=-1)

    with pytest.raises(IntegrityError):
        with t07_session.begin_nested():
            t07_session.add(link)
            t07_session.flush()


def test_publish_guard_rejects_a_legacy_row_with_unsafe_url(t07_session):
    """发布前复检：历史数据里的非 http(s) 地址不能借发布变成公开外链。"""

    class Stub:
        url = "javascript:alert(1)"

    with pytest.raises(ApiError) as error:
        service.assert_publishable(Stub())  # type: ignore[arg-type]

    assert error.value.status_code == 409
    assert error.value.code == "CONFLICT"


def test_tags_endpoint_has_no_counts(coop_client, t07_session):
    make_published_link(t07_session, name=unique_name(), tags=("前端",))

    payload = coop_client.get("/api/v1/coop/tags").json()

    assert set(payload) == {"items"}
    for item in payload["items"]:
        assert set(item) == {"name", "normalized"}


def test_public_listing_is_not_rate_limited_or_counted(public_client, t07_session):
    """公开列表是普通读取：不做访问计数，也不引入会误伤正常访客的限流。"""
    make_published_link(t07_session, name=unique_name())

    for _ in range(25):
        assert public_client.get("/api/v1/coop/links").status_code == 200


def test_no_counter_table_exists(t07_session):
    """没有「友链访问 / 点击」表 —— 不统计、不排名。"""
    names = {
        row[0]
        for row in t07_session.execute(
            text("select table_name from information_schema.tables where table_schema = current_schema()")
        ).all()
    }
    assert "friend_link_visits" not in names
    assert "friend_link_clicks" not in names
    # 但我们的两张表确实存在（避免上面的断言因为「表都没建」而通过）。
    assert {"friend_links", "friend_link_tags"} <= names


def test_detail_for_random_uuid_is_not_a_leak(public_client):
    response = public_client.get(f"/api/v1/coop/links/{uuid.uuid4()}")

    assert_error(response, status=404, code="NOT_FOUND")
