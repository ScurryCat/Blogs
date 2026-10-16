"""作品公开 API（T06 执行清单第 1、2、5 条；验收 1 / 5）。

覆盖：

  - slug 是公开 URL 的一部分：非法 slug 被拒（URL 校验），合法 slug 可读；
  - 草稿 / 已撤回 / 已软删除 / 未到发布时间一律 404，且响应里**没有**草稿内容；
  - 列表分页（不透明游标）与筛选指纹（换 maintenance / tech 后旧游标 400）；
  - 站主登录后读公开端点**仍然**只拿到公开视图（05 §7）；
  - 关联专题撤回后：作品仍在（不连带删除），`palace` 变 null，
    **响应文本里没有隐藏专题的标题**（验收 5）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.modules.nav.models import STATUS_DRAFT as PALACE_DRAFT
from app.modules.nav.models import STATUS_PUBLISHED as PALACE_PUBLISHED
from app.modules.nav.models import Palace, PalacePost
from app.modules.posts.models import Post
from tests.core.t01_db import assert_error
from tests.projects.helpers import (
    ADMIN_PROJECTS_PATH,
    PROJECTS_PATH,
    admin_client,
    anonymous_client,
    attach_images,
    make_media,
    make_admin,
    make_project,
    t06_routers,
    unique_slug,
    write_headers,
)
from tests.support.t06_shared import make_admin

UTC = timezone.utc


def _palace(session, *, slug: str, status: str, title: str) -> Palace:
    """插一条专题行（T04 的表）。只写数据，不改 T04 的代码。"""
    palace = Palace(
        slug=slug,
        title=title,
        summary="专题说明",
        name="关键词",
        location="地点",
        cognition="认知",
        status=status,
        published_at=datetime.now(UTC) - timedelta(minutes=5) if status == PALACE_PUBLISHED else None,
    )
    session.add(palace)
    session.flush()
    return palace


def _public_post(session, *, slug: str) -> Post:
    """插一条公开文章（nav 的公开专题要求至少一篇公开文章）。"""
    post = Post(
        slug=slug,
        title="公开文章",
        excerpt="摘要",
        content_md="正文",
        status="published",
        published_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    session.add(post)
    session.flush()
    return post


# --- 公开列表 / 详情 -------------------------------------------------------


def test_published_project_is_readable_by_anonymous(t06_session, t06_settings) -> None:
    owner = make_admin(t06_session)
    media = make_media(t06_session, owner)
    project = make_project(
        t06_session,
        slug=unique_slug("blog"),
        title="这个 P5 博客",
        summary="把静态博客改造成怪盗基地",
        status="published",
        tech_stack=["Next.js", "FastAPI"],
    )
    attach_images(t06_session, project, [(media.id, 0, "cover")])

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        listing = client.get(PROJECTS_PATH)
        assert listing.status_code == 200, listing.text
        payload = listing.json()
        assert [item["slug"] for item in payload["items"]] == [project.slug]
        card = payload["items"][0]
        assert card["title"] == "这个 P5 博客"
        assert card["tech_stack"] == ["Next.js", "FastAPI"]
        assert card["maintenance_label"] == "持续维护"
        assert card["cover"]["media_id"] == str(media.id)
        # 公开 DTO 不含任何管理字段（05 §7）。
        assert "status" not in card and "version" not in card and "deleted_at" not in card

        detail = client.get(f"{PROJECTS_PATH}/{project.slug}")
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["role"] == "发起与实现"
        assert body["images"][0]["alt"] == "图片 0"
        # 公开图片永不含原图变体（05 §8）。
        assert all(variant["name"] != "original" for variant in body["images"][0]["variants"])


@pytest.mark.parametrize(
    "slug",
    [
        "UPPER-CASE",
        "中文-slug",
        "with space",
        "trailing-",
        "-leading",
        "double--hyphen",
        "has_underscore",
        "dot.slug",
        "sla/sh",
    ],
)
def test_invalid_slug_is_rejected(t06_session, t06_settings, slug: str) -> None:
    """slug 进 URL 之前必须通过 URL 校验（执行清单第 1 条）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        response = client.post(
            ADMIN_PROJECTS_PATH,
            json={"slug": slug, "title": "非法 slug", "summary": "用途"},
            headers=write_headers(csrf),
        )
        assert response.status_code == 422, response.text
        # 传输层校验失败统一是 UNPROCESSABLE（T00 的错误 code 表，与 posts 一致）；
        # 业务层「筛选不合法」也用同一个 code，见 test_cursor_is_bound_to_the_current_filters。
        assert_error(response, status=422, code="UNPROCESSABLE")


def test_slug_is_immutable_on_update(t06_session, t06_settings) -> None:
    """slug 不可改（公开 URL 稳定优先）：带上 slug 的 PATCH 是字段错误。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        created = client.post(
            ADMIN_PROJECTS_PATH,
            json={"slug": unique_slug(), "title": "作品", "summary": "用途"},
            headers=write_headers(csrf),
        )
        assert created.status_code == 201, created.text
        project_id = created.json()["id"]
        patched = client.patch(
            f"{ADMIN_PROJECTS_PATH}/{project_id}",
            json={"slug": "new-slug"},
            headers=write_headers(csrf, 1),
        )
        assert patched.status_code == 422, patched.text


@pytest.mark.parametrize(
    "state",
    ["draft", "unpublished", "deleted", "future"],
)
def test_non_public_projects_are_invisible(t06_session, t06_settings, state: str) -> None:
    """草稿 / 已撤回 / 已软删除 / 未到发布时间：列表里没有，详情真 404。"""
    slug = unique_slug("hidden")
    if state == "draft":
        make_project(t06_session, slug=slug, title="草稿作品", status="draft")
    elif state == "unpublished":
        make_project(
            t06_session,
            slug=slug,
            title="撤回作品",
            status="draft",
            published_at=datetime.now(UTC) - timedelta(minutes=5),
        )
    elif state == "deleted":
        make_project(
            t06_session,
            slug=slug,
            title="已删除作品",
            status="published",
            deleted_at=datetime.now(UTC),
        )
    else:
        make_project(
            t06_session,
            slug=slug,
            title="未来的作品",
            status="published",
            published_at=datetime.now(UTC) + timedelta(days=1),
        )

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        listing = client.get(PROJECTS_PATH)
        assert listing.status_code == 200
        assert listing.json()["items"] == [], state
        detail = client.get(f"{PROJECTS_PATH}/{slug}")
        assert detail.status_code == 404, detail.text
        assert_error(detail, status=404, code="NOT_FOUND")
        assert "草稿作品" not in detail.text and "撤回作品" not in detail.text


def test_logged_in_owner_still_gets_public_view_only(t06_session, t06_settings) -> None:
    """站主访问公开端点也不能多拿草稿（05 §7）。"""
    make_project(t06_session, slug="hidden-for-owner", title="草稿的秘密", status="draft")
    public = make_project(
        t06_session, slug=unique_slug("public"), title="公开作品", status="published"
    )
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, _csrf):
        listing = client.get(PROJECTS_PATH)
        assert listing.status_code == 200
        slugs = [item["slug"] for item in listing.json()["items"]]
        assert slugs == [public.slug]
        assert "hidden-for-owner" not in listing.text
        detail = client.get(f"{PROJECTS_PATH}/hidden-for-owner")
        assert detail.status_code == 404


# --- 分页与筛选指纹 -------------------------------------------------------


def test_listing_pagination_does_not_repeat_or_drop(t06_session, t06_settings) -> None:
    for index in range(5):
        make_project(
            t06_session,
            slug=f"page-{index}",
            title=f"作品 {index}",
            status="published",
            published_at=datetime.now(UTC) - timedelta(minutes=index),
        )
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        seen: list[str] = []
        cursor = None
        for _ in range(5):
            query = f"?limit=2" + (f"&cursor={cursor}" if cursor else "")
            response = client.get(f"{PROJECTS_PATH}{query}")
            assert response.status_code == 200, response.text
            body = response.json()
            seen.extend(item["slug"] for item in body["items"])
            cursor = body["next_cursor"]
            if not cursor:
                break
    assert seen == ["page-0", "page-1", "page-2", "page-3", "page-4"]
    assert len(set(seen)) == 5


def test_cursor_is_bound_to_the_current_filters(t06_session, t06_settings) -> None:
    """换筛选后继续用旧游标 → 400，由客户端从第一页重新开始（05 §6）。"""
    # 两件 FastAPI 作品 + 一件只写 Next.js 的作品：FastAPI 筛选下 limit=1 才会有下一页。
    for index in range(3):
        make_project(
            t06_session,
            slug=f"tech-{index}",
            title=f"技术作品 {index}",
            status="published",
            tech_stack=["FastAPI"] if index < 2 else ["Next.js"],
            published_at=datetime.now(UTC) - timedelta(minutes=index),
        )
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        first = client.get(f"{PROJECTS_PATH}?limit=1&tech=FastAPI")
        assert first.status_code == 200, first.text
        cursor = first.json()["next_cursor"]
        assert cursor
        # 同一筛选 → 可以继续翻页。
        same = client.get(f"{PROJECTS_PATH}?limit=1&tech=FastAPI&cursor={cursor}")
        assert same.status_code == 200, same.text
        # 换筛选 → 400。
        switched = client.get(f"{PROJECTS_PATH}?limit=1&tech=Next.js&cursor={cursor}")
        assert_error(switched, status=400, code="VALIDATION_FAILED")
        # 非法 maintenance 筛选 → 422（不静默当成「全部」）。
        bogus = client.get(f"{PROJECTS_PATH}?maintenance=whatever")
        assert_error(bogus, status=422, code="UNPROCESSABLE")


# --- 关联专题与「攻略记录」（验收 5）--------------------------------------


def test_palace_link_is_returned_only_while_the_palace_is_public(
    t06_session, t06_settings
) -> None:
    post = _public_post(t06_session, slug=unique_slug("p"))
    palace = _palace(
        t06_session, slug="walkthrough", status=PALACE_PUBLISHED, title="怪盗据点工程"
    )
    t06_session.add(PalacePost(palace_id=palace.id, post_id=post.id, position=0))
    t06_session.flush()
    project = make_project(
        t06_session, slug=unique_slug("p5blog"), status="published", palace_id=palace.id
    )
    assert project.palace_id == palace.id

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        detail = client.get(f"{PROJECTS_PATH}/{project.slug}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["palace"]["slug"] == "walkthrough"
        assert detail.json()["palace"]["title"] == "怪盗据点工程"


def test_retracting_the_palace_hides_its_title_but_keeps_the_project(
    t06_session, t06_settings
) -> None:
    """验收 5：专题撤回不连带删除作品，也**不露出隐藏专题标题**。"""
    post = _public_post(t06_session, slug=unique_slug("p"))
    palace = _palace(
        t06_session, slug="hidden-palace", status=PALACE_PUBLISHED, title="隐藏的专题标题"
    )
    t06_session.add(PalacePost(palace_id=palace.id, post_id=post.id, position=0))
    t06_session.flush()
    project = make_project(
        t06_session, slug=unique_slug("keep"), status="published", palace_id=palace.id
    )

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        assert client.get(f"{PROJECTS_PATH}/{project.slug}").json()["palace"] is not None

        # 撤回专题（只改 status，与 T04 的 unpublish 同形）。
        palace.status = PALACE_DRAFT
        t06_session.flush()

        detail = client.get(f"{PROJECTS_PATH}/{project.slug}")
        assert detail.status_code == 200, "撤回专题不应该连带撤回作品"
        body = detail.json()
        assert body["palace"] is None
        assert "隐藏的专题标题" not in detail.text, "不得露出隐藏专题的标题"

        listing = client.get(PROJECTS_PATH)
        assert listing.status_code == 200
        assert "隐藏的专题标题" not in listing.text


def test_soft_deleted_palace_also_hides_its_title(t06_session, t06_settings) -> None:
    post = _public_post(t06_session, slug=unique_slug("p"))
    palace = _palace(
        t06_session, slug="deleted-palace", status=PALACE_PUBLISHED, title="已删除专题标题"
    )
    t06_session.add(PalacePost(palace_id=palace.id, post_id=post.id, position=0))
    t06_session.flush()
    project = make_project(
        t06_session, slug=unique_slug("keep2"), status="published", palace_id=palace.id
    )
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        palace.deleted_at = datetime.now(UTC)
        t06_session.flush()
        detail = client.get(f"{PROJECTS_PATH}/{project.slug}")
        assert detail.status_code == 200
        assert detail.json()["palace"] is None
        assert "已删除专题标题" not in detail.text


def test_palace_without_public_post_is_not_linkable(t06_session, t06_settings) -> None:
    """专题「公开」但没有任何公开文章时同样不算公开（04 §8 / 05 §3）。"""
    palace = _palace(
        t06_session, slug="no-posts", status=PALACE_PUBLISHED, title="没有公开文章的专题"
    )
    project = make_project(
        t06_session, slug=unique_slug("nopost"), status="published", palace_id=palace.id
    )
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        detail = client.get(f"{PROJECTS_PATH}/{project.slug}")
        assert detail.status_code == 200
        assert detail.json()["palace"] is None
        assert "没有公开文章的专题" not in detail.text


# --- 错误形状 -------------------------------------------------------------


def test_unknown_slug_is_a_real_404(t06_session, t06_settings) -> None:
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        response = client.get(f"{PROJECTS_PATH}/nope-nope-nope")
        assert_error(response, status=404, code="NOT_FOUND")


def test_non_uuid_admin_id_is_a_404_not_a_500(t06_session, t06_settings) -> None:
    """管理端点用 UUID：格式不对与「不存在」同形 404（不给探测信号）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, _csrf):
        response = client.get(f"{ADMIN_PROJECTS_PATH}/not-a-uuid")
        assert_error(response, status=404, code="NOT_FOUND")


def test_public_listing_is_no_store(t06_session, t06_settings) -> None:
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        response = client.get(PROJECTS_PATH)
        assert response.headers["cache-control"] == "no-store"


def test_unknown_media_id_is_rejected(t06_session, t06_settings) -> None:
    """引用不存在的媒体 → 409，不写半个作品。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        response = client.post(
            ADMIN_PROJECTS_PATH,
            json={
                "slug": unique_slug(),
                "title": "作品",
                "summary": "用途",
                "images": [
                    {"media_id": str(uuid.uuid4()), "position": 0, "kind": "cover", "alt": "图"}
                ],
            },
            headers=write_headers(csrf),
        )
        assert response.status_code == 409, response.text
        assert_error(response, status=409, code="CONFLICT")
