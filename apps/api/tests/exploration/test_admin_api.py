"""问题记录管理 API（05 §7、07 §6、任务卡验收 3）。

覆盖：新建总是「草稿 + 待探索」、**发布状态与工作状态互不联动**、
「已解决」必须有实际结果说明、撤回不改工作状态、If-Match 428/412、CSRF、
完整替换关联、软删除。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.projects.models import STATUS_DRAFT as PROJECT_DRAFT
from app.modules.projects.models import STATUS_PUBLISHED as PROJECT_PUBLISHED
from app.modules.projects.models import Project
from tests.exploration.helpers import (
    ADMIN_RECORDS_PATH,
    RECORDS_PATH,
    admin_client,
    anonymous_client,
    create_record,
    make_post,
    publish_record,
    t09_routers,
    unique_slug,
    write_headers,
)

UTC = timezone.utc


def _project(session: Session, *, title: str, published: bool = True) -> Project:
    from datetime import timedelta

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
        project.published_at = datetime.now(UTC) - timedelta(minutes=5)
    session.add(project)
    session.flush()
    return project


def test_create_defaults_to_draft_and_pending(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_record(client, csrf, slug=unique_slug("new"))
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["status"] == "draft"
    assert payload["work_status"] == "pending"
    assert payload["resolved_at"] is None
    assert payload["published_at"] is None
    assert response.headers["ETag"] == '"1"'


def test_creating_as_resolved_requires_outcome(t09_session, t09_settings) -> None:
    """直接建成「已解决」也必须带结果说明 —— 不能靠「先建后补」绕过门槛。"""
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        blocked = create_record(
            client, csrf, slug=unique_slug("res"), work_status="resolved", outcome=""
        )
    assert blocked.status_code == 409
    assert "结果说明" in blocked.json()["error"]["message"]


def test_creating_as_resolved_with_outcome_sets_resolved_at(
    t09_session, t09_settings
) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("res"),
            work_status="resolved",
            outcome="根因是遮罩卸载晚于指针事件恢复。",
        )
    assert created.status_code == 201, created.text
    assert created.json()["work_status"] == "resolved"
    assert created.json()["resolved_at"] is not None
    # 但**没有**因此变成已发布（工作状态与发布状态相互独立）。
    assert created.json()["status"] == "draft"


def test_marking_resolved_without_outcome_is_blocked(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(client, csrf, slug=unique_slug("mark")).json()
        blocked = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={"work_status": "resolved"},
            headers=write_headers(csrf, created["version"]),
        )
    assert blocked.status_code == 409
    assert "结果说明" in blocked.json()["error"]["message"]


def test_clearing_outcome_on_resolved_record_is_blocked(t09_session, t09_settings) -> None:
    """「已解决」的记录不能把结果说明改回空白（否则页面只剩一个状态标签）。"""
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("clear"),
            work_status="resolved",
            outcome="修好了。",
        ).json()
        blocked = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={"outcome": "   "},
            headers=write_headers(csrf, created["version"]),
        )
    assert blocked.status_code == 409


def test_leaving_resolved_clears_resolved_at(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("back"),
            work_status="resolved",
            outcome="先记成解决了。",
        ).json()
        assert created["resolved_at"] is not None
        reopened = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={"work_status": "investigating"},
            headers=write_headers(csrf, created["version"]),
        )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["resolved_at"] is None
    assert reopened.json()["work_status"] == "investigating"


def test_resolved_at_is_not_pushed_forward_on_repeat_save(t09_session, t09_settings) -> None:
    """重复保存「已解决」不会把解决时间往后推（首次解决时间才是事实）。"""
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("keep"),
            work_status="resolved",
            outcome="第一次解决。",
        ).json()
        first_resolved_at = created["resolved_at"]
        again = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={"outcome": "补充一句说明。"},
            headers=write_headers(csrf, created["version"]),
        )
    assert again.status_code == 200, again.text
    # 比较**时刻**而不是字符串：两次响应的时区写法可能不同（Z 与 +08:00），
    # 那是序列化差异，不是时间被改动的证据。
    assert datetime.fromisoformat(
        again.json()["resolved_at"].replace("Z", "+00:00")
    ) == datetime.fromisoformat(first_resolved_at.replace("Z", "+00:00"))


def test_publish_requires_background(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(client, csrf, slug=unique_slug("nobg"), background="").json()
        blocked = publish_record(client, csrf, created["id"], created["version"])
    assert blocked.status_code == 409
    assert "背景" in blocked.json()["error"]["message"]


def test_publish_does_not_change_work_status(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(client, csrf, slug=unique_slug("pub")).json()
        published = publish_record(client, csrf, created["id"], created["version"])
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert published.json()["work_status"] == created["work_status"] == "pending"
    assert published.json()["published_at"] is not None


def test_unpublish_does_not_change_work_status(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("unpub"),
            work_status="resolved",
            outcome="已修好。",
        ).json()
        published = publish_record(client, csrf, created["id"], created["version"]).json()
        unpublished = client.post(
            f"{ADMIN_RECORDS_PATH}/{created['id']}/unpublish",
            headers=write_headers(csrf, published["version"]),
        )
    assert unpublished.status_code == 200, unpublished.text
    assert unpublished.json()["status"] == "draft"
    assert unpublished.json()["published_at"] is None
    assert unpublished.json()["work_status"] == "resolved"
    assert unpublished.json()["resolved_at"] is not None


def test_publish_without_if_match_is_428(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(client, csrf, slug=unique_slug("nomatch")).json()
        response = client.post(
            f"{ADMIN_RECORDS_PATH}/{created['id']}/publish",
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
    assert response.status_code == 428


def test_stale_version_is_412(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(client, csrf, slug=unique_slug("conflict")).json()
        first = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={"attempts": "第一次修改"},
            headers=write_headers(csrf, created["version"]),
        )
        assert first.status_code == 200
        stale = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={"attempts": "用旧版本号覆盖"},
            headers=write_headers(csrf, created["version"]),
        )
        latest = client.get(f"{ADMIN_RECORDS_PATH}/{created['id']}").json()
    assert stale.status_code == 412
    assert latest["attempts"] == "第一次修改"


def test_write_without_csrf_is_rejected(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, _csrf):
        response = client.post(
            ADMIN_RECORDS_PATH,
            json={"slug": unique_slug("nocsrf"), "title": "无 token"},
            headers={"Origin": "http://testserver"},
        )
    assert response.status_code == 403


def test_admin_list_requires_login(t09_session, t09_settings) -> None:
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(ADMIN_RECORDS_PATH)
    assert response.status_code == 401


def test_relations_are_replaced_wholesale(t09_session, t09_settings) -> None:
    post_a = make_post(t09_session, title="文章甲")
    post_b = make_post(t09_session, title="文章乙")
    project = _project(t09_session, title="作品一")

    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("rels"),
            posts=[{"post_id": str(post_a.id), "position": 0}],
            projects=[{"project_id": str(project.id), "position": 0}],
        ).json()
        assert [item["title"] for item in created["posts"]] == ["文章甲"]

        replaced = client.patch(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            json={
                "posts": [{"post_id": str(post_b.id), "position": 0}],
                "projects": [],
            },
            headers=write_headers(csrf, created["version"]),
        )
    assert replaced.status_code == 200, replaced.text
    assert [item["title"] for item in replaced.json()["posts"]] == ["文章乙"]
    assert replaced.json()["projects"] == []


def test_relation_rejects_unknown_post(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_record(
            client,
            csrf,
            slug=unique_slug("ghost"),
            posts=[{"post_id": str(uuid.uuid4()), "position": 0}],
        )
    assert response.status_code == 409
    assert "不存在" in response.json()["error"]["message"]


def test_relation_lists_draft_post_for_admin(t09_session, t09_settings) -> None:
    """管理端必须看到「关联的是一篇草稿」，而不是被悄悄过滤掉。"""
    draft = make_post(t09_session, title="还没写完的文章", status="draft")
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(
            client,
            csrf,
            slug=unique_slug("draftrel"),
            posts=[{"post_id": str(draft.id), "position": 0}],
        ).json()
    assert created["posts"][0]["title"] == "还没写完的文章"
    assert created["posts"][0]["status"] == "draft"


def test_evidence_link_scheme_is_validated(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_record(
            client,
            csrf,
            slug=unique_slug("js"),
            evidence_links=[
                {"kind": "proof", "label": "坏链接", "url": "javascript:alert(1)"}
            ],
        )
    assert response.status_code == 422


def test_soft_delete_hides_from_admin_and_public(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_record(client, csrf, slug=unique_slug("del")).json()
        published = publish_record(client, csrf, created["id"], created["version"]).json()
        deleted = client.delete(
            f"{ADMIN_RECORDS_PATH}/{created['id']}",
            headers=write_headers(csrf, published["version"]),
        )
        assert deleted.status_code == 204, deleted.text
        assert client.get(f"{ADMIN_RECORDS_PATH}/{created['id']}").status_code == 404
        listing = client.get(ADMIN_RECORDS_PATH).json()
        assert created["id"] not in [item["id"] for item in listing["items"]]

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        assert client.get(f"{RECORDS_PATH}/{created['slug']}").status_code == 404


def test_admin_responses_are_private(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, _csrf):
        response = client.get(ADMIN_RECORDS_PATH)
    assert "private" in response.headers.get("cache-control", "")
