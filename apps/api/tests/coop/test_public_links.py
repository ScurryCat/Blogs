"""公开读取：列表、标签筛选、分页游标、详情与「撤回后不可见」（验收 1 / 3 / 4）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.core.text import normalize_for_match
from tests.coop.helpers import (
    SAFE_URL,
    assert_error,
    make_link,
    make_published_link,
    unique_name,
    unique_tag,
)

UTC = timezone.utc

LINKS_PATH = "/api/v1/coop/links"
TAGS_PATH = "/api/v1/coop/tags"


def tag_names(payload: dict) -> list[str]:
    return [item["name"] for item in payload["items"]]


def test_list_returns_only_published_links(public_client, t07_session):
    published = make_published_link(t07_session, name=unique_name("已发布"), position=0)
    make_link(t07_session, name=unique_name("草稿"), position=1)
    make_link(
        t07_session,
        name=unique_name("未来发布"),
        status="published",
        published_at=datetime.now(UTC) + timedelta(days=1),
        position=2,
    )
    make_link(
        t07_session,
        name=unique_name("已删除"),
        status="published",
        published_at=datetime.now(UTC) - timedelta(hours=1),
        deleted_at=datetime.now(UTC),
        position=3,
    )

    response = public_client.get(LINKS_PATH)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["id"] for item in payload["items"]] == [str(published.id)]
    assert payload["next_cursor"] is None
    assert response.headers["Cache-Control"] == "no-store"


def test_list_is_ordered_by_manual_position_then_id(public_client, t07_session):
    third = make_published_link(t07_session, name=unique_name("第三"), position=30)
    first = make_published_link(t07_session, name=unique_name("第一"), position=10)
    second = make_published_link(t07_session, name=unique_name("第二"), position=20)

    payload = public_client.get(LINKS_PATH).json()

    assert [item["id"] for item in payload["items"]] == [str(first.id), str(second.id), str(third.id)]


def test_tag_filter_is_exact_after_normalization(public_client, t07_session):
    wanted = unique_tag("前端")
    matched = make_published_link(t07_session, name=unique_name("匹配"), tags=(wanted,))
    make_published_link(t07_session, name=unique_name("不匹配"), tags=(unique_tag("生活"),))

    # 全角空格 + 大小写差异都必须命中同一条（normalize_for_match 是唯一规则）。
    payload = public_client.get(LINKS_PATH, params={"tag": f"  {wanted.upper()}  "}).json()

    assert [item["id"] for item in payload["items"]] == [str(matched.id)]
    assert payload["items"][0]["tags"] == [wanted]


def test_unknown_tag_is_an_empty_result_not_an_error(public_client, t07_session):
    make_published_link(t07_session, name=unique_name(), tags=(unique_tag(),))

    response = public_client.get(LINKS_PATH, params={"tag": unique_tag("没有")})

    assert response.status_code == 200, response.text
    assert response.json() == {"items": [], "next_cursor": None}


def test_pagination_cursor_walks_without_gaps_or_repeats(public_client, t07_session):
    created = [
        make_published_link(t07_session, name=unique_name(f"第{index}"), position=index * 10)
        for index in range(5)
    ]

    first = public_client.get(LINKS_PATH, params={"limit": 2}).json()
    assert [item["id"] for item in first["items"]] == [str(item.id) for item in created[:2]]
    assert first["next_cursor"]

    second = public_client.get(
        LINKS_PATH, params={"limit": 2, "cursor": first["next_cursor"]}
    ).json()
    assert [item["id"] for item in second["items"]] == [str(item.id) for item in created[2:4]]

    third = public_client.get(LINKS_PATH, params={"limit": 2, "cursor": second["next_cursor"]}).json()
    assert [item["id"] for item in third["items"]] == [str(created[4].id)]
    assert third["next_cursor"] is None


def test_cursor_from_another_filter_is_rejected(public_client, t07_session):
    tag = unique_tag()
    make_published_link(t07_session, name=unique_name(), tags=(tag,), position=0)
    make_published_link(t07_session, name=unique_name(), tags=(tag,), position=1)
    cursor = public_client.get(LINKS_PATH, params={"limit": 1}).json()["next_cursor"]
    assert cursor

    response = public_client.get(LINKS_PATH, params={"cursor": cursor, "tag": tag})

    assert_error(response, status=400, code="VALIDATION_FAILED")
    assert "cursor" in response.json()["error"]["fields"]


def test_garbage_cursor_is_rejected_not_treated_as_first_page(public_client):
    response = public_client.get(LINKS_PATH, params={"cursor": "not-a-cursor"})

    assert_error(response, status=400, code="VALIDATION_FAILED")


def test_detail_returns_story_only_for_published_link(public_client, t07_session):
    link = make_published_link(
        t07_session,
        name=unique_name("有故事"),
        story="在算法竞赛的群里认识，后来互相读过对方的题解。",
        arcana="IX · HERMIT",
        tags=(unique_tag("竞赛"),),
    )

    response = public_client.get(f"{LINKS_PATH}/{link.id}")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["story"] == "在算法竞赛的群里认识，后来互相读过对方的题解。"
    assert payload["arcana"] == "IX · HERMIT"
    assert payload["tags"] == [tag.name for tag in link.tags]
    assert response.headers["Cache-Control"] == "no-store"


def test_list_has_no_story_text_but_reports_has_story(public_client, t07_session):
    make_published_link(t07_session, name=unique_name("有故事"), story="一段很长很长的相识故事")
    make_published_link(t07_session, name=unique_name("没故事"), story="   ")

    payload = public_client.get(LINKS_PATH).json()
    by_name = {item["name"]: item for item in payload["items"]}

    assert all("story" not in item for item in payload["items"])
    assert by_name[next(name for name in by_name if name.startswith("有故事"))]["has_story"] is True
    assert by_name[next(name for name in by_name if name.startswith("没故事"))]["has_story"] is False


def test_detail_uniformly_404_for_draft_deleted_and_unknown(public_client, t07_session):
    draft = make_link(t07_session, name=unique_name("草稿"))
    deleted = make_published_link(
        t07_session,
        name=unique_name("已删除"),
        deleted_at=datetime.now(UTC),
    )
    missing = uuid.uuid4()

    payloads = [
        assert_error(public_client.get(f"{LINKS_PATH}/{item}"), status=404, code="NOT_FOUND")
        for item in (draft.id, deleted.id, missing)
    ]

    # 「存在但没发布」与「根本不存在」不能通过响应区分出来。
    assert len({payload["error"]["message"] for payload in payloads}) == 1


def test_tags_endpoint_only_exposes_published_tags(public_client, t07_session):
    visible = unique_tag("可见")
    hidden = unique_tag("草稿专用")
    make_published_link(t07_session, name=unique_name(), tags=(visible,))
    make_link(t07_session, name=unique_name(), tags=(hidden,))

    payload = public_client.get(TAGS_PATH).json()

    names = tag_names(payload)
    assert visible in names
    assert hidden not in names
    # 没有计数、没有排名字段：标签筛选器只需要名字。
    assert set(payload["items"][0]) == {"name", "normalized"}
    assert payload["items"][0]["normalized"] == normalize_for_match(payload["items"][0]["name"])


def test_tags_endpoint_deduplicates_case_and_space_variants(public_client, t07_session):
    make_published_link(t07_session, name=unique_name(), tags=("Front End",))
    make_published_link(t07_session, name=unique_name(), tags=("front end",))

    payload = public_client.get(TAGS_PATH).json()

    assert [item["normalized"] for item in payload["items"]].count("front end") == 1


def test_empty_database_returns_honest_empty_state(public_client):
    response = public_client.get(LINKS_PATH)

    assert response.status_code == 200, response.text
    assert response.json() == {"items": [], "next_cursor": None}


def test_public_url_is_returned_exactly_as_stored(public_client, t07_session):
    link = make_published_link(t07_session, name=unique_name(), url="https://example.com/blog?a=1")

    payload = public_client.get(f"{LINKS_PATH}/{link.id}").json()

    assert payload["url"] == "https://example.com/blog?a=1"
    assert SAFE_URL  # 默认地址在同一规则下也合法
