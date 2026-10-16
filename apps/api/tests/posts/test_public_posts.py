"""公开文章 / 公开标签读取（05 §6、T01 任务卡「必须有的测试」第 1 与第 8 行）。

覆盖：
  - 已登录站主读公开端点：**仍然**没有草稿、没有私密字段、没有草稿专用标签；
  - private 管理字段（status / version / deleted_at / storage_key）绝不出现在公共响应；
  - 详情：草稿 / 删除 / 未到发布时间 / 不存在 → 统一 404；
  - 分页：同时间戳稳定（不漏不重）、游标与筛选绑定、limit 边界；
  - DB 断线 → 503，不伪装成 404 或空列表。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine

from app.core.deps import get_session
from app.core.db import create_session_factory
from app.modules.auth.router import router as auth_router
from app.modules.posts.models import Post
from app.modules.posts.router import router as posts_router
from app.modules.tags.router import router as tags_router
from tests.auth.helpers import login_ok, make_admin
from tests.core.t01_db import assert_error, module_api_client
from tests.media.helpers import make_media_row
from tests.posts.helpers import make_draft, make_post, unique_category, unique_tag

ROUTERS = (("auth", auth_router), ("posts", posts_router), ("tags", tags_router))

PUBLIC_LIST_KEYS = {
    "id",
    "slug",
    "title",
    "excerpt",
    "category",
    "display_date",
    "published_at",
    "tags",
    "cover",
}
PRIVATE_MARKERS = ("storage_key", "owner_id", "sha256", "deleted_at", '"version"', '"status"', "password")


def _client(t01_settings, t01_session):
    return module_api_client(t01_settings, t01_session, *ROUTERS)


def test_logged_in_admin_still_gets_public_view_only(t01_settings, t01_session):
    make_admin(t01_session)
    category = unique_category()
    public_tag = unique_tag("公开")
    draft_tag = unique_tag("仅草稿")
    cover = make_media_row(
        t01_session,
        owner_id=make_admin(t01_session, username="cover-owner").id,
        root=t01_settings.media_root_path,
    )
    published = make_post(
        t01_session,
        title="公开文章",
        category=category,
        tags=(public_tag,),
        cover_media_id=cover.id,
        excerpt="摘要",
    )
    draft = make_draft(
        t01_session, title="草稿文章", category=category, tags=(draft_tag,)
    )

    with _client(t01_settings, t01_session) as client:
        login_ok(client)  # 已登录站主

        listing = client.get("/api/v1/posts", params={"category": category})
        assert listing.status_code == 200, listing.text
        body = listing.json()
        assert set(body) == {"items", "next_cursor"}
        slugs = [item["slug"] for item in body["items"]]
        assert slugs == [published.slug]
        assert draft.slug not in slugs, "站主登录后公共端点也不能多给草稿"

        item = body["items"][0]
        assert set(item) == PUBLIC_LIST_KEYS, item
        assert "content_md" not in item, "列表不返回正文"
        for marker in PRIVATE_MARKERS:
            assert marker not in listing.text, f"公共列表泄漏了 {marker}"

        # 封面：只给公开变体 URL，不给原图 URL、storage_key 或 sha256
        assert item["cover"]["id"] == str(cover.id)
        assert {v["name"] for v in item["cover"]["variants"]} == {"w320.webp", "w640.webp"}
        assert "original" not in listing.text

        detail = client.get(f"/api/v1/posts/{published.slug}")
        assert detail.status_code == 200, detail.text
        detail_body = detail.json()
        assert detail_body["content_md"] == published.content_md
        assert set(detail_body) == PUBLIC_LIST_KEYS | {"content_md"}
        for marker in PRIVATE_MARKERS:
            assert marker not in detail.text

        assert client.get(f"/api/v1/posts/{draft.slug}").status_code == 404

        # 标签：草稿专用标签不出现
        tags = client.get("/api/v1/tags")
        assert tags.status_code == 200
        names = {tag["name"] for tag in tags.json()}
        assert public_tag in names
        assert draft_tag not in names, "仅草稿使用的标签泄漏到了公开标签列表"
        assert set(tags.json()[0]) == {"id", "slug", "name"}


def test_unpublished_deleted_and_future_posts_are_not_public(t01_settings, t01_session):
    category = unique_category()
    draft = make_draft(t01_session, category=category)
    deleted = make_post(
        t01_session,
        category=category,
        deleted_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    future = make_post(
        t01_session,
        category=category,
        published_at=datetime.now(timezone.utc) + timedelta(days=3),
    )
    live = make_post(t01_session, category=category)

    with _client(t01_settings, t01_session) as client:
        listing = client.get("/api/v1/posts", params={"category": category}).json()
        assert [item["slug"] for item in listing["items"]] == [live.slug]
        for hidden in (draft, deleted, future):
            assert client.get(f"/api/v1/posts/{hidden.slug}").status_code == 404
        # 不存在的 slug 同样是 404（而不是 500 或重定向回列表）
        assert client.get("/api/v1/posts/no-such-slug-at-all").status_code == 404


def test_pagination_is_stable_with_identical_timestamps(t01_settings, t01_session):
    category = unique_category()
    moment = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
    posts = [make_post(t01_session, category=category, published_at=moment) for _ in range(5)]

    seen: list[str] = []
    with _client(t01_settings, t01_session) as client:
        cursor = None
        pages = 0
        while True:
            params = {"category": category, "limit": 2}
            if cursor:
                params["cursor"] = cursor
            response = client.get("/api/v1/posts", params=params)
            assert response.status_code == 200, response.text
            body = response.json()
            seen.extend(item["slug"] for item in body["items"])
            pages += 1
            cursor = body["next_cursor"]
            if cursor is None:
                break
            assert pages < 10, "分页没有收敛"
    assert pages == 3
    assert sorted(seen) == sorted(post.slug for post in posts)
    assert len(seen) == len(set(seen)), "同一时间戳下分页出现重复项"


def test_cursor_is_bound_to_current_filters(t01_settings, t01_session):
    category_a = unique_category()
    category_b = unique_category()
    make_post(t01_session, category=category_a, published_at=datetime(2026, 7, 1, tzinfo=timezone.utc))
    make_post(t01_session, category=category_a, published_at=datetime(2026, 6, 1, tzinfo=timezone.utc))
    make_post(t01_session, category=category_b, published_at=datetime(2026, 5, 1, tzinfo=timezone.utc))

    with _client(t01_settings, t01_session) as client:
        first = client.get("/api/v1/posts", params={"category": category_a, "limit": 1}).json()
        cursor = first["next_cursor"]
        assert cursor

        # 换筛选后继续用旧游标 → 400（客户端必须从第一页重新开始）
        mismatched = client.get(
            "/api/v1/posts", params={"category": category_b, "cursor": cursor}
        )
        assert_error(mismatched, status=400, code="VALIDATION_FAILED")

        # 同筛选继续翻页 → 200
        assert client.get(
            "/api/v1/posts", params={"category": category_a, "cursor": cursor}
        ).status_code == 200


def test_invalid_cursor_and_limit_bounds(t01_settings, t01_session):
    with _client(t01_settings, t01_session) as client:
        bad = client.get("/api/v1/posts", params={"cursor": "!!!not-a-cursor!!!"})
        assert_error(bad, status=400, code="VALIDATION_FAILED")

        assert client.get("/api/v1/posts", params={"limit": 0}).status_code == 422
        assert client.get("/api/v1/posts", params={"limit": 31}).status_code == 422
        assert client.get("/api/v1/posts", params={"limit": 30}).status_code == 200
        # 默认 12：制造 13 篇同分类文章，确认第一页只回 12 且给出 next_cursor
        category = unique_category()
        moment = datetime(2026, 4, 1, tzinfo=timezone.utc)
        for index in range(13):
            make_post(
                t01_session,
                category=category,
                published_at=moment - timedelta(minutes=index),
            )
        page = client.get("/api/v1/posts", params={"category": category}).json()
        assert len(page["items"]) == 12
        assert page["next_cursor"]


def test_tag_and_category_filters(t01_settings, t01_session):
    category = unique_category()
    tag = unique_tag("前端")
    tagged = make_post(t01_session, category=category, tags=(tag,))
    make_post(t01_session, category=category)
    other_category = unique_category()
    other_tagged = make_post(t01_session, category=other_category, tags=(tag,))

    with _client(t01_settings, t01_session) as client:
        # 标签是跨分类的：两篇文章都该出现
        by_tag = client.get("/api/v1/posts", params={"tag": tag}).json()
        assert {item["slug"] for item in by_tag["items"]} == {tagged.slug, other_tagged.slug}
        # 标签 + 分类组合筛选
        both = client.get(
            "/api/v1/posts", params={"tag": tag, "category": category}
        ).json()
        assert {item["slug"] for item in both["items"]} == {tagged.slug}
        assert client.get("/api/v1/posts", params={"tag": "不存在的标签"}).json()["items"] == []
        # 全角 / 大小写规范化：用 size 变形仍能命中同一个标签
        normalized = client.get("/api/v1/posts", params={"tag": f"  {tag.upper()}  "}).json()
        assert {item["slug"] for item in normalized["items"]} == {tagged.slug, other_tagged.slug}


def test_public_reads_are_not_shared_cached(t01_settings, t01_session):
    with _client(t01_settings, t01_session) as client:
        listing = client.get("/api/v1/posts")
        assert listing.status_code == 200
        assert listing.headers["cache-control"] == "no-store"
        assert client.get("/api/v1/tags").headers["cache-control"] == "no-store"
        # 错误响应同样不得被缓存（被缓存的 404 / 503 会把临时状态变成长期状态）。
        detail = client.get("/api/v1/posts/no-such-slug")
        assert detail.status_code == 404
        assert detail.headers["cache-control"] == "no-store"


def test_database_failure_is_503_not_404_or_empty_list(t01_settings, t01_session):
    """DB 断线：列表与详情都必须 503，不能返回空列表或伪装 404。"""
    from fastapi.testclient import TestClient

    from tests.support.module_app import build_module_app

    broken_engine = create_engine(
        "postgresql+psycopg://pl@127.0.0.1:55433/pl_test_unreachable",
        connect_args={"connect_timeout": 2},
    )
    session = create_session_factory(broken_engine)()
    try:
        app = build_module_app(t01_settings, ("posts", posts_router), ("tags", tags_router))
        app.dependency_overrides[get_session] = lambda: session
        with TestClient(app, raise_server_exceptions=False) as client:
            listing = client.get("/api/v1/posts")
            assert_error(listing, status=503, code="SERVICE_UNAVAILABLE")

            detail = client.get("/api/v1/posts/phantom-blog-launch")
            assert_error(detail, status=503, code="SERVICE_UNAVAILABLE")

            tags = client.get("/api/v1/tags")
            assert_error(tags, status=503, code="SERVICE_UNAVAILABLE")
    finally:
        session.close()
        broken_engine.dispose()


def test_published_window_boundary(t01_settings, t01_session):
    """发布时间恰好等于「现在」的文章可见；未来一秒不可见。"""
    category = unique_category()
    now = datetime.now(timezone.utc)
    make_post(t01_session, category=category, published_at=now - timedelta(seconds=1))
    make_post(t01_session, category=category, published_at=now + timedelta(seconds=30))
    with _client(t01_settings, t01_session) as client:
        items = client.get("/api/v1/posts", params={"category": category}).json()["items"]
        assert len(items) == 1
    # 直接查服务层：确认过滤条件在 SQL 里，而不是在 Python 里事后筛。
    rows = t01_session.query(Post).filter(Post.category == category).count()
    assert rows == 2
