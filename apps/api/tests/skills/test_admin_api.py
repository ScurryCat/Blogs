"""技能管理 API（05 §7、07 §6、ACCEPTANCE §1）。

覆盖：创建总是草稿、发布门槛（范围说明 + 掌握证据）、If-Match 428/412、
CSRF/Origin、完整替换关联、撤回不删关系、软删除、管理侧能看到草稿关联。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.projects.models import STATUS_PUBLISHED, Project
from tests.skills.helpers import (
    ADMIN_SKILLS_PATH,
    SKILLS_PATH,
    admin_client,
    anonymous_client,
    create_skill,
    publish_skill,
    t09_routers,
    unique_slug,
    write_headers,
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
    if published:
        project.status = STATUS_PUBLISHED
        project.published_at = datetime.now(UTC) - timedelta(minutes=5)
    session.add(project)
    session.flush()
    return project


def test_create_always_starts_as_draft(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_skill(client, csrf, slug=unique_slug("new"))
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["status"] == "draft"
    assert payload["published_at"] is None
    assert payload["version"] == 1
    assert response.headers["ETag"] == '"1"'


def test_new_draft_is_not_publicly_visible(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(client, csrf, slug=unique_slug("hidden"))
        assert created.status_code == 201

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        assert client.get(f"{SKILLS_PATH}/{created.json()['slug']}").status_code == 404
        listing = client.get(SKILLS_PATH).json()
    assert created.json()["slug"] not in [item["slug"] for item in listing["items"]]
    # 站主读公开端点也不会多拿草稿（05 §7）。
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, _csrf):
        assert client.get(f"{SKILLS_PATH}/{created.json()['slug']}").status_code == 404


def test_publish_requires_scope_and_evidence(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(client, csrf, slug=unique_slug("bare"), scope="", evidence="")
        assert created.status_code == 201
        skill_id = created.json()["id"]

        blocked = publish_skill(client, csrf, skill_id, created.json()["version"])
        assert blocked.status_code == 409, blocked.text
        assert "掌握证据" in blocked.json()["error"]["message"]

        patched = client.patch(
            f"{ADMIN_SKILLS_PATH}/{skill_id}",
            json={"evidence": "ACM 训练与题解记录。"},
            headers=write_headers(csrf, created.json()["version"]),
        )
        assert patched.status_code == 200, patched.text

        still_blocked = publish_skill(client, csrf, skill_id, patched.json()["version"])
        assert still_blocked.status_code == 409
        assert "范围说明" in still_blocked.json()["error"]["message"]

        filled = client.patch(
            f"{ADMIN_SKILLS_PATH}/{skill_id}",
            json={"scope": "能独立完成常见数据结构实现。"},
            headers=write_headers(csrf, patched.json()["version"]),
        )
        assert filled.status_code == 200, filled.text

        published = publish_skill(client, csrf, skill_id, filled.json()["version"])
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"
        assert published.json()["published_at"] is not None


def test_publish_without_if_match_is_428(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(client, csrf, slug=unique_slug("nomatch")).json()
        response = client.post(
            f"{ADMIN_SKILLS_PATH}/{created['id']}/publish",
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
    assert response.status_code == 428
    assert response.json()["error"]["code"] == "PRECONDITION_REQUIRED"


def test_update_with_stale_version_is_412_and_keeps_data(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(client, csrf, slug=unique_slug("conflict"), name="原名").json()
        first = client.patch(
            f"{ADMIN_SKILLS_PATH}/{created['id']}",
            json={"name": "改过的名字"},
            headers=write_headers(csrf, created["version"]),
        )
        assert first.status_code == 200
        stale = client.patch(
            f"{ADMIN_SKILLS_PATH}/{created['id']}",
            json={"name": "用旧版本号覆盖"},
            headers=write_headers(csrf, created["version"]),
        )
        assert stale.status_code == 412
        assert stale.json()["error"]["code"] == "VERSION_CONFLICT"

        latest = client.get(f"{ADMIN_SKILLS_PATH}/{created['id']}").json()

    assert latest["name"] == "改过的名字", "412 之后不能有任何修改落地"


def test_write_without_csrf_is_rejected(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, _csrf):
        response = client.post(
            ADMIN_SKILLS_PATH,
            json={"slug": unique_slug("nocsrf"), "name": "无 token"},
            headers={"Origin": "http://testserver"},
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_admin_list_requires_login(t09_session, t09_settings) -> None:
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(ADMIN_SKILLS_PATH)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_projects_relation_is_replaced_wholesale(t09_session, t09_settings) -> None:
    first = _project(t09_session, title="作品一")
    second = _project(t09_session, title="作品二")
    third = _project(t09_session, title="作品三")

    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(
            client,
            csrf,
            slug=unique_slug("rels"),
            projects=[
                {"project_id": str(first.id), "position": 0},
                {"project_id": str(second.id), "position": 1},
            ],
        ).json()
        assert [item["title"] for item in created["projects"]] == ["作品一", "作品二"]

        replaced = client.patch(
            f"{ADMIN_SKILLS_PATH}/{created['id']}",
            json={"projects": [{"project_id": str(third.id), "position": 0}]},
            headers=write_headers(csrf, created["version"]),
        )
        assert replaced.status_code == 200, replaced.text
        assert [item["title"] for item in replaced.json()["projects"]] == ["作品三"]

    # 公开侧反映的正是替换后的关系（同一个来源，不是第二份数据）。
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        latest = client.get(f"{ADMIN_SKILLS_PATH}/{created['id']}").json()
        published = publish_skill(client, csrf, created["id"], latest["version"])
        assert published.status_code == 200, published.text

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        detail = client.get(f"{SKILLS_PATH}/{created['slug']}").json()
    assert detail["project_count"] == 1
    assert [item["title"] for item in detail["projects"]] == ["作品三"]


def test_relation_rejects_duplicate_project_and_position(t09_session, t09_settings) -> None:
    project = _project(t09_session, title="作品一")
    other = _project(t09_session, title="作品二")

    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        duplicated = create_skill(
            client,
            csrf,
            slug=unique_slug("dup"),
            projects=[
                {"project_id": str(project.id), "position": 0},
                {"project_id": str(project.id), "position": 1},
            ],
        )
        assert duplicated.status_code == 409
        assert "重复关联" in duplicated.json()["error"]["message"]

        same_position = create_skill(
            client,
            csrf,
            slug=unique_slug("samepos"),
            projects=[
                {"project_id": str(project.id), "position": 0},
                {"project_id": str(other.id), "position": 0},
            ],
        )
        assert same_position.status_code == 409
        assert "顺序" in same_position.json()["error"]["message"]


def test_relation_rejects_unknown_project(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_skill(
            client,
            csrf,
            slug=unique_slug("ghost"),
            projects=[{"project_id": str(uuid.uuid4()), "position": 0}],
        )
    assert response.status_code == 409
    assert "不存在" in response.json()["error"]["message"]


def test_admin_can_see_draft_project_relation(t09_session, t09_settings) -> None:
    """管理端必须看到「关联的是一件草稿」，而不是被悄悄过滤掉。"""
    draft = _project(t09_session, title="还没发布的作品", published=False)

    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(
            client,
            csrf,
            slug=unique_slug("draftrel"),
            projects=[{"project_id": str(draft.id), "position": 0}],
        ).json()

    assert created["projects"][0]["title"] == "还没发布的作品"
    assert created["projects"][0]["status"] == "draft"


def test_links_reject_non_http_scheme(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_skill(
            client,
            csrf,
            slug=unique_slug("js"),
            links=[{"kind": "other", "label": "坏链接", "url": "javascript:alert(1)"}],
        )
    assert response.status_code == 422
    assert "http" in response.text


def test_links_reject_local_absolute_path(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        response = create_skill(
            client,
            csrf,
            slug=unique_slug("path"),
            # 站内绝对路径（不是站外 http/https）必须被拒：它会把服务器文件系统
            # 暴露成一个可点的链接。
            links=[{"kind": "other", "label": "本机路径", "url": "/etc/passwd"}],
        )
    assert response.status_code == 422


def test_duplicate_slug_is_rejected(t09_session, t09_settings) -> None:
    slug = unique_slug("same")
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        assert create_skill(client, csrf, slug=slug).status_code == 201
        second = create_skill(client, csrf, slug=slug, name="另一个")
    assert second.status_code == 409
    assert "slug" in second.json()["error"]["fields"]


def test_unpublish_keeps_relations_and_clears_published_at(t09_session, t09_settings) -> None:
    project = _project(t09_session, title="作品一")

    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(
            client,
            csrf,
            slug=unique_slug("unpub"),
            projects=[{"project_id": str(project.id), "position": 0}],
        ).json()
        published = publish_skill(client, csrf, created["id"], created["version"]).json()
        unpublished = client.post(
            f"{ADMIN_SKILLS_PATH}/{created['id']}/unpublish",
            headers=write_headers(csrf, published["version"]),
        )

    assert unpublished.status_code == 200, unpublished.text
    body = unpublished.json()
    assert body["status"] == "draft"
    assert body["published_at"] is None
    assert [item["title"] for item in body["projects"]] == ["作品一"]


def test_soft_delete_removes_from_admin_list_and_public(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        created = create_skill(client, csrf, slug=unique_slug("del")).json()
        published = publish_skill(client, csrf, created["id"], created["version"]).json()
        deleted = client.delete(
            f"{ADMIN_SKILLS_PATH}/{created['id']}",
            headers=write_headers(csrf, published["version"]),
        )
        assert deleted.status_code == 204, deleted.text

        listing = client.get(ADMIN_SKILLS_PATH).json()
        assert created["id"] not in [item["id"] for item in listing["items"]]
        assert client.get(f"{ADMIN_SKILLS_PATH}/{created['id']}").status_code == 404

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        assert client.get(f"{SKILLS_PATH}/{created['slug']}").status_code == 404


def test_admin_responses_are_private(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, _csrf):
        response = client.get(ADMIN_SKILLS_PATH)
    assert "private" in response.headers.get("cache-control", "")


def test_admin_list_includes_drafts(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, csrf):
        draft = create_skill(client, csrf, slug=unique_slug("listed")).json()
        listing = client.get(ADMIN_SKILLS_PATH, params={"status": "draft"}).json()

    assert draft["id"] in [item["id"] for item in listing["items"]]
    assert all(item["status"] == "draft" for item in listing["items"])


def test_admin_list_rejects_unknown_status_filter(t09_session, t09_settings) -> None:
    with admin_client(t09_settings, t09_session, *t09_routers()) as (client, _user, _csrf):
        response = client.get(ADMIN_SKILLS_PATH, params={"status": "archived"})
    assert response.status_code == 422
