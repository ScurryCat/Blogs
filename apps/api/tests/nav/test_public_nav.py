"""公开专题：列表、详情、公开条件与分页（04 §4A / §8、05 §6）。

对应验收用例 1 / 3 / 4 与集成矩阵「殿堂所有文章撤回 → 列表、详情、搜索、匹配、重访均不暴露」。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.nav.models import STATUS_DRAFT, STATUS_PUBLISHED, PalacePost
from tests.nav.helpers import (
    admin_login,
    assert_error,
    make_palace,
    make_published_palace,
    unique_keyword,
    unique_slug,
)
from tests.posts.helpers import make_draft, make_post

UTC = timezone.utc

PUBLIC_SUMMARY_KEYS = {
    "id",
    "slug",
    "title",
    "summary",
    "keywords",
    "post_count",
    "published_at",
}
KEYWORD_KEYS = {"name", "location", "cognition"}


def test_only_published_palaces_with_public_posts_are_listed(public_client, t04_session: Session):
    """草稿、没有公开文章的殿堂、软删除的殿堂都不出现在公开列表里。"""
    public_post = make_post(t04_session, title="公开文章")
    draft_post = make_draft(t04_session, title="草稿文章")

    visible = make_published_palace(
        t04_session, posts=(public_post,), title="可进入的殿堂", slug=unique_slug()
    )
    draft_palace = make_palace(t04_session, posts=(public_post,), title="草稿殿堂")
    no_public_post = make_published_palace(
        t04_session, posts=(draft_post,), title="只有草稿文章的殿堂"
    )
    empty = make_published_palace(t04_session, posts=(), title="没有任何文章的殿堂")
    deleted = make_published_palace(
        t04_session, posts=(public_post,), title="已删除的殿堂", deleted_at=datetime.now(UTC)
    )
    future = make_published_palace(
        t04_session,
        posts=(public_post,),
        title="还没到发布时间的殿堂",
        published_at=datetime.now(UTC) + timedelta(days=1),
    )

    response = public_client.get("/api/v1/nav/palaces")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"items", "next_cursor"}
    slugs = [item["slug"] for item in payload["items"]]

    assert slugs == [visible.slug]
    for hidden in (draft_palace, no_public_post, empty, deleted, future):
        assert hidden.slug not in slugs

    item = payload["items"][0]
    assert set(item) == PUBLIC_SUMMARY_KEYS
    assert set(item["keywords"]) == KEYWORD_KEYS
    assert item["post_count"] == 1
    # 公开响应不得泄漏管理字段。
    text = response.text
    for leaked in ("version", "deleted_at", "draft", "storage_key"):
        assert leaked not in text


def test_retracting_every_post_hides_the_palace_everywhere(public_client, t04_session: Session):
    """全部关联文章撤回后：列表、详情、搜索与「重访」都不可读（验收 3）。"""
    post = make_post(t04_session, title="唯一公开文章", slug=unique_slug("post"))
    slug = unique_slug()
    palace = make_published_palace(t04_session, posts=(post,), slug=slug)
    t04_session.commit()

    assert [item["slug"] for item in public_client.get("/api/v1/nav/palaces").json()["items"]] == [
        palace.slug
    ]
    assert public_client.get(f"/api/v1/nav/palaces/{slug}").status_code == 200
    assert public_client.get("/api/v1/nav/search", params={"q": palace.title}).json()["items"]

    # 撤回唯一一篇关联文章（草稿 ≠ 公开）。
    post.status = STATUS_DRAFT
    t04_session.commit()

    assert public_client.get("/api/v1/nav/palaces").json()["items"] == []
    assert_error(
        public_client.get(f"/api/v1/nav/palaces/{slug}"), status=404, code="NOT_FOUND"
    )
    assert public_client.get("/api/v1/nav/search", params={"q": palace.title}).json()["items"] == []

    # 重新发布后再次可读：公开状态是「当前状态」，不是一次性快照。
    post.status = STATUS_PUBLISHED
    t04_session.commit()
    assert public_client.get(f"/api/v1/nav/palaces/{slug}").status_code == 200


def test_detail_hides_draft_posts_and_their_tags(public_client, t04_session: Session):
    """公开详情的文章顺序只含公开文章，且不泄漏草稿标题与草稿专用标签（验收 4）。"""
    first = make_post(t04_session, title="第一章：入口", slug=unique_slug("post"))
    second = make_post(t04_session, title="第二章：探索", slug=unique_slug("post"))
    secret = make_draft(
        t04_session,
        title="机密草稿标题",
        tags=(unique_keyword("秘密标签"),),
    )
    slug = unique_slug()
    make_published_palace(
        t04_session,
        posts=(first, secret, second),
        slug=slug,
        title="有序殿堂",
    )

    response = public_client.get(f"/api/v1/nav/palaces/{slug}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["slug"] for item in payload["posts"]] == [first.slug, second.slug]
    assert payload["post_count"] == 2
    body = response.text
    assert "机密草稿标题" not in body
    assert "秘密标签" not in body
    # 详情不返回文章的正文原文（列表 DTO 只给摘要），也不含管理字段。
    assert "content_md" not in body


def test_unknown_deleted_and_draft_slugs_are_indistinguishable(public_client, t04_session: Session):
    post = make_post(t04_session)
    hidden = [
        make_palace(t04_session, posts=(post,), title="草稿"),
        make_published_palace(
            t04_session, posts=(post,), deleted_at=datetime.now(UTC), title="已删除"
        ),
    ]
    messages = set()
    for palace in hidden:
        payload = assert_error(
            public_client.get(f"/api/v1/nav/palaces/{palace.slug}"), status=404, code="NOT_FOUND"
        )
        messages.add(payload["error"]["message"])
    missing = assert_error(
        public_client.get("/api/v1/nav/palaces/never-exists-at-all"), status=404, code="NOT_FOUND"
    )
    messages.add(missing["error"]["message"])
    # 三种情况的响应完全同形，不提供「存在但不可见」的探测信号。
    assert len(messages) == 1


def test_public_list_pagination_is_stable_and_filter_bound(public_client, t04_session: Session):
    """同一发布时间戳下分页不漏不重；游标不合法或与筛选不符返回 400（验收 4）。"""
    post = make_post(t04_session)
    moment = datetime.now(UTC) - timedelta(minutes=5)
    palaces = [
        make_published_palace(t04_session, posts=(post,), published_at=moment) for _ in range(5)
    ]
    t04_session.commit()
    # 排序键是 (published_at DESC, id DESC)：同时间戳时按 UUID 字节序倒序。
    expected = [palace.slug for palace in sorted(palaces, key=lambda item: item.id, reverse=True)]

    collected: list[str] = []
    cursor = None
    for _ in range(6):
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        payload = public_client.get("/api/v1/nav/palaces", params=params).json()
        collected.extend(item["slug"] for item in payload["items"])
        cursor = payload["next_cursor"]
        if cursor is None:
            break
    assert cursor is None
    assert collected == expected, (collected, expected)
    assert len(set(collected)) == 5

    assert_error(
        public_client.get("/api/v1/nav/palaces", params={"cursor": "not-a-cursor"}),
        status=400,
        code="VALIDATION_FAILED",
    )
    # 用搜索游标冒充列表游标：指纹与形状都不符 → 400，而不是静默当成第一页。
    search_cursor = public_client.get(
        "/api/v1/nav/search", params={"q": "公开", "limit": 1}
    ).json()["next_cursor"]
    if search_cursor:
        assert_error(
            public_client.get("/api/v1/nav/palaces", params={"cursor": search_cursor}),
            status=400,
            code="VALIDATION_FAILED",
        )
    assert_error(
        public_client.get("/api/v1/nav/palaces", params={"limit": 31}),
        status=422,
        code="UNPROCESSABLE",
    )


def test_logged_in_owner_still_gets_public_view_only(nav_client, t04_session: Session):
    """站主登录后读公开端点也不会多拿草稿（05 §7）。"""
    public_post = make_post(t04_session, title="公开文章")
    draft_post = make_draft(t04_session, title="还没发布的章节")
    slug = unique_slug()
    make_published_palace(t04_session, posts=(public_post, draft_post), slug=slug)
    admin_login(nav_client, t04_session)

    detail = nav_client.get(f"/api/v1/nav/palaces/{slug}")
    assert detail.status_code == 200
    assert [item["slug"] for item in detail.json()["posts"]] == [public_post.slug]
    assert "还没发布的章节" not in detail.text
    assert "version" not in detail.text


def test_post_count_is_computed_live_not_cached(public_client, t04_session: Session):
    """`post_count` 是实时统计：撤回一篇文章后立刻变化，不依赖缓存的计数列。"""
    posts = [make_post(t04_session) for _ in range(3)]
    slug = unique_slug()
    make_published_palace(t04_session, posts=tuple(posts), slug=slug)
    t04_session.commit()

    assert public_client.get(f"/api/v1/nav/palaces/{slug}").json()["post_count"] == 3
    posts[0].status = STATUS_DRAFT
    t04_session.commit()
    assert public_client.get(f"/api/v1/nav/palaces/{slug}").json()["post_count"] == 2


def test_public_list_hides_palace_whose_only_post_is_not_yet_published(
    public_client, t04_session: Session
):
    """未来发布的文章不算公开文章（05 §2 公开条件）。"""
    future_post = make_post(
        t04_session, published_at=datetime.now(UTC) + timedelta(days=2), title="将来的文章"
    )
    palace = make_published_palace(t04_session, posts=(future_post,))
    assert public_client.get("/api/v1/nav/palaces").json()["items"] == []
    assert_error(
        public_client.get(f"/api/v1/nav/palaces/{palace.slug}"), status=404, code="NOT_FOUND"
    )


def test_relations_are_database_constrained(t04_session: Session):
    """文章与顺序分别在同一专题内唯一：数据库约束真实生效（05 §3）。"""
    import pytest
    from sqlalchemy.exc import IntegrityError

    post_a = make_post(t04_session)
    post_b = make_post(t04_session)
    palace = make_palace(t04_session, posts=(post_a,))

    with pytest.raises(IntegrityError):
        with t04_session.begin_nested():
            t04_session.add(PalacePost(palace_id=palace.id, post_id=post_a.id, position=9))
            t04_session.flush()

    palace2 = make_palace(t04_session, posts=(post_b,))
    with pytest.raises(IntegrityError):
        with t04_session.begin_nested():
            t04_session.add(PalacePost(palace_id=palace2.id, post_id=post_a.id, position=0))
            t04_session.flush()
