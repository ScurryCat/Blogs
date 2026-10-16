"""问题记录公开 API（05 §6、07 §6、任务卡验收 3 / 4 / 6）。

覆盖：
  - 工作状态与发布状态**相互独立**（已解决的草稿不公开；待探索的公开记录可见）；
  - 私有草稿不出现在列表、计数与链接摘要里（验收 3）；
  - 撤回关联文章 / 作品后**不泄漏隐藏标题**（任务卡执行清单）；
  - 公开详情给出实际结果说明与可选验证链接；
  - 分类素材来自关联文章，链接可点，但记录本身明确是站主整理（验收 4）。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.exploration.models import WORK_INVESTIGATING, WORK_RESOLVED
from app.modules.posts.models import STATUS_DRAFT as POST_DRAFT
from app.modules.posts.models import STATUS_PUBLISHED as POST_PUBLISHED
from app.modules.projects.models import STATUS_DRAFT as PROJECT_DRAFT
from app.modules.projects.models import STATUS_PUBLISHED as PROJECT_PUBLISHED
from app.modules.projects.models import Project
from tests.exploration.helpers import (
    RECORDS_PATH,
    anonymous_client,
    attach_record_posts,
    attach_record_projects,
    make_post,
    make_record,
    t09_routers,
    unique_slug,
)

UTC = timezone.utc


def _project(session: Session, *, title: str, published: bool = True) -> Project:
    project = Project(
        slug=unique_slug("proj"),
        title=title,
        summary="一句话用途",
        maintenance="maintained",
        tech_stack=[],
        links=[],
    )
    project.status = PROJECT_PUBLISHED if published else PROJECT_DRAFT
    if published:
        from datetime import timedelta

        project.published_at = datetime.now(UTC) - timedelta(minutes=5)
    session.add(project)
    session.flush()
    return project


# --- 列表与状态独立 ---------------------------------------------------------


def test_only_published_records_are_listed(t09_session, t09_settings) -> None:
    published = make_record(t09_session, slug=unique_slug("pub"), status="published")
    make_record(t09_session, slug=unique_slug("draft"), status="draft")

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(RECORDS_PATH).json()

    slugs = [item["slug"] for item in payload["items"]]
    assert published.slug in slugs
    assert all(not slug.startswith("draft-") for slug in slugs)


def test_resolved_draft_is_not_public(t09_session, t09_settings) -> None:
    """验收 3：工作状态「已解决」**不自动等于**公开。"""
    make_record(
        t09_session,
        slug=unique_slug("res"),
        work_status=WORK_RESOLVED,
        resolved_at=datetime.now(UTC),
        outcome="修好了。",
        status="draft",
    )
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        listing = client.get(RECORDS_PATH).json()
        stats = client.get(f"{RECORDS_PATH}/stats").json()

    assert listing["items"] == []
    assert stats["total"] == 0
    assert stats["by_work_status"]["resolved"] == 0


def test_pending_published_record_is_visible(t09_session, t09_settings) -> None:
    """正交的另一半：**待探索但已发布**是合法的公开状态（「正在查」本身就是内容）。"""
    record = make_record(
        t09_session,
        slug=unique_slug("pend"),
        title="为什么动画结束后无法点击页面",
        work_status="pending",
        status="published",
    )
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        detail = client.get(f"{RECORDS_PATH}/{record.slug}").json()
    assert detail["work_status"] == "pending"
    assert detail["work_status_label"] == "待探索"
    assert detail["resolved_at"] is None


def test_detail_reports_outcome_and_evidence_links(t09_session, t09_settings) -> None:
    record = make_record(
        t09_session,
        slug=unique_slug("solved"),
        work_status=WORK_RESOLVED,
        resolved_at=datetime.now(UTC),
        outcome="根因是遮罩卸载晚于指针事件恢复，改成在卸载时同步恢复。",
        evidence_links=[
            {"kind": "proof", "label": "修复说明", "url": "https://example.com/fix"},
        ],
        status="published",
    )
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{RECORDS_PATH}/{record.slug}").json()

    assert payload["work_status"] == "resolved"
    assert "遮罩卸载" in payload["outcome"]
    assert payload["resolved_at"] is not None
    assert payload["evidence_links"][0]["url"] == "https://example.com/fix"


def test_stats_match_visible_records(t09_session, t09_settings) -> None:
    make_record(t09_session, slug=unique_slug("a"), work_status="pending", status="published")
    make_record(
        t09_session, slug=unique_slug("b"), work_status=WORK_INVESTIGATING, status="published"
    )
    make_record(t09_session, slug=unique_slug("c"), work_status="pending", status="draft")

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        listing = client.get(RECORDS_PATH).json()
        stats = client.get(f"{RECORDS_PATH}/stats").json()

    assert stats["total"] == len(listing["items"])
    assert stats["by_work_status"]["pending"] == 1
    assert stats["by_work_status"]["investigating"] == 1


def test_work_status_filter_rejects_unknown_value(t09_session, t09_settings) -> None:
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(RECORDS_PATH, params={"work_status": "wontfix"})
    assert response.status_code == 422


def test_work_status_filter_narrows_results(t09_session, t09_settings) -> None:
    make_record(t09_session, slug=unique_slug("p"), work_status="pending", status="published")
    investigating = make_record(
        t09_session,
        slug=unique_slug("i"),
        work_status=WORK_INVESTIGATING,
        status="published",
    )
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(RECORDS_PATH, params={"work_status": "investigating"}).json()
    assert [item["slug"] for item in payload["items"]] == [investigating.slug]


def test_draft_detail_is_404(t09_session, t09_settings) -> None:
    record = make_record(t09_session, slug=unique_slug("hidden"), status="draft")
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(f"{RECORDS_PATH}/{record.slug}")
    assert response.status_code == 404


# --- 关联内容与撤回 ---------------------------------------------------------


def test_related_post_and_project_are_publicly_listed(t09_session, t09_settings) -> None:
    record = make_record(t09_session, slug=unique_slug("linked"), status="published")
    post = make_post(
        t09_session, title="遮罩卸载时机的一次修复", status=POST_PUBLISHED
    )
    project = _project(t09_session, title="这个 P5 博客")
    attach_record_posts(t09_session, record, [(post.id, 0)])
    attach_record_projects(t09_session, record, [(project, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{RECORDS_PATH}/{record.slug}").json()

    assert payload["post_count"] == 1
    assert payload["project_count"] == 1
    assert payload["posts"][0]["title"] == "遮罩卸载时机的一次修复"
    assert payload["posts"][0]["href"] == f"/posts/{post.slug}"
    assert payload["projects"][0]["href"] == f"/showcase/projects/{project.slug}"


def test_withdrawn_post_title_is_not_leaked(t09_session, t09_settings) -> None:
    """撤回关联文章后：引用整条消失，**不泄漏隐藏标题**，也不留「（已隐藏）」暗示。"""
    record = make_record(t09_session, slug=unique_slug("leak"), status="published")
    post = make_post(
        t09_session,
        title="还没写完的内部标题",
        status=POST_PUBLISHED,
    )
    attach_record_posts(t09_session, record, [(post.id, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        before = client.get(f"{RECORDS_PATH}/{record.slug}").json()
        assert before["posts"][0]["title"] == "还没写完的内部标题"

        post.status = POST_DRAFT
        post.published_at = None
        t09_session.flush()

        after = client.get(f"{RECORDS_PATH}/{record.slug}")
        listing = client.get(RECORDS_PATH)

    assert after.status_code == 200
    payload = after.json()
    assert payload["posts"] == []
    assert payload["post_count"] == 0
    assert "还没写完的内部标题" not in after.text
    assert "还没写完的内部标题" not in listing.text
    assert "已隐藏" not in after.text


def test_withdrawn_project_title_is_not_leaked(t09_session, t09_settings) -> None:
    record = make_record(t09_session, slug=unique_slug("leak2"), status="published")
    project = _project(t09_session, title="还没发布的作品标题", published=True)
    attach_record_projects(t09_session, record, [(project, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        assert client.get(f"{RECORDS_PATH}/{record.slug}").json()["projects"]
        project.status = PROJECT_DRAFT
        project.published_at = None
        t09_session.flush()
        after = client.get(f"{RECORDS_PATH}/{record.slug}")

    assert after.json()["projects"] == []
    assert "还没发布的作品标题" not in after.text


def test_soft_deleted_post_title_is_not_leaked(t09_session, t09_settings) -> None:
    record = make_record(t09_session, slug=unique_slug("leak3"), status="published")
    post = make_post(t09_session, title="被删除的文章标题", status=POST_PUBLISHED)
    attach_record_posts(t09_session, record, [(post.id, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        post.deleted_at = datetime.now(UTC)
        t09_session.flush()
        after = client.get(f"{RECORDS_PATH}/{record.slug}")

    assert after.json()["posts"] == []
    assert "被删除的文章标题" not in after.text


def test_draft_relation_does_not_count_in_summary(t09_session, t09_settings) -> None:
    """列表摘要里的计数与详情里的引用完全一致（都用公开条件）。"""
    record = make_record(t09_session, slug=unique_slug("counts"), status="published")
    public_post = make_post(t09_session, title="公开文章", status=POST_PUBLISHED)
    draft_post = make_post(t09_session, title="草稿文章", status=POST_DRAFT)
    attach_record_posts(t09_session, record, [(public_post.id, 0), (draft_post.id, 1)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        listing = client.get(RECORDS_PATH).json()
        detail = client.get(f"{RECORDS_PATH}/{record.slug}").json()

    item = next(entry for entry in listing["items"] if entry["slug"] == record.slug)
    assert item["post_count"] == 1
    assert detail["post_count"] == 1
    assert "草稿文章" not in str(listing) + str(detail)


def test_public_responses_are_not_shared_cached(t09_session, t09_settings) -> None:
    record = make_record(t09_session, slug=unique_slug("cache"), status="published")
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        listing = client.get(RECORDS_PATH)
        detail = client.get(f"{RECORDS_PATH}/{record.slug}")
        stats = client.get(f"{RECORDS_PATH}/stats")
    for response in (listing, detail, stats):
        assert "no-store" in response.headers.get("cache-control", "")


def test_pagination_cursor_is_filter_bound(t09_session, t09_settings) -> None:
    make_record(t09_session, slug=unique_slug("c1"), work_status="pending", status="published")
    make_record(
        t09_session,
        slug=unique_slug("c2"),
        work_status=WORK_INVESTIGATING,
        status="published",
    )
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        first = client.get(RECORDS_PATH, params={"limit": 1}).json()
        assert first["next_cursor"], "夹具没有产出两页数据，断言会空过"
        mismatched = client.get(
            RECORDS_PATH, params={"limit": 1, "work_status": "pending", "cursor": first["next_cursor"]}
        )
        consistent = client.get(RECORDS_PATH, params={"limit": 1, "cursor": first["next_cursor"]})

    assert mismatched.status_code == 400
    assert consistent.status_code == 200
