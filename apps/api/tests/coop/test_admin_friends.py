"""管理端：维护、排序、发布 / 撤回、If-Match 与 CSRF（05 §7、任务卡执行清单）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.modules.coop.models import STATUS_DRAFT, STATUS_PUBLISHED
from tests.coop.helpers import (
    SAFE_URL,
    admin_login,
    assert_error,
    create_payload,
    make_link,
    make_published_link,
    unique_name,
    unique_tag,
    write_headers,
)

UTC = timezone.utc

ADMIN_PATH = "/api/v1/admin/friends"
PUBLIC_PATH = "/api/v1/coop/links"


def test_admin_endpoints_require_owner_session(coop_client, t07_session):
    link = make_link(t07_session, name=unique_name())

    assert_error(coop_client.get(ADMIN_PATH), status=401, code="UNAUTHORIZED")
    assert_error(coop_client.get(f"{ADMIN_PATH}/{link.id}"), status=401, code="UNAUTHORIZED")
    assert_error(coop_client.post(ADMIN_PATH, json=create_payload()), status=401, code="UNAUTHORIZED")


def test_admin_reads_are_private_no_store(coop_client, t07_session):
    admin_login(coop_client, t07_session)

    response = coop_client.get(ADMIN_PATH)

    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "private, no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_create_requires_csrf_token(coop_client, t07_session):
    admin_login(coop_client, t07_session)

    response = coop_client.post(
        ADMIN_PATH, json=create_payload(), headers={"Origin": "http://testserver"}
    )

    assert_error(response, status=403, code="FORBIDDEN")


def test_create_returns_draft_with_etag_and_writes_nothing_public(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    payload = create_payload(name=unique_name("新友链"), position=7)

    response = coop_client.post(
        ADMIN_PATH,
        json={**payload, "csrf_token": session_state["csrf_token"]},
        headers=write_headers(session_state["csrf_token"]),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_DRAFT
    assert body["published_at"] is None
    assert body["version"] == 1
    assert body["position"] == 7
    assert response.headers["ETag"] == '"1"'
    assert sorted(tag["name"] for tag in body["tags"]) == sorted(payload["tags"])
    # 新建即公开是不允许的：列表里还看不到它。
    assert str(body["id"]) not in {item["id"] for item in coop_client.get(PUBLIC_PATH).json()["items"]}


def test_create_rejects_executable_url_and_keeps_database_clean(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)

    response = coop_client.post(
        ADMIN_PATH,
        json={
            **create_payload(url="javascript:alert(1)"),
            "csrf_token": session_state["csrf_token"],
        },
        headers=write_headers(session_state["csrf_token"]),
    )

    payload = assert_error(response, status=422, code="UNPROCESSABLE")
    assert "url" in payload["error"]["fields"]
    assert coop_client.get(ADMIN_PATH).json()["items"] == []


def test_create_rejects_unknown_fields(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)

    response = coop_client.post(
        ADMIN_PATH,
        json={
            **create_payload(),
            "status": "published",
            "csrf_token": session_state["csrf_token"],
        },
        headers=write_headers(session_state["csrf_token"]),
    )

    assert_error(response, status=422, code="UNPROCESSABLE")


def test_create_rejects_duplicate_tags_ignoring_case_and_space(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)

    response = coop_client.post(
        ADMIN_PATH,
        json={
            **create_payload(tags=["Front End", " front  end "]),
            "csrf_token": session_state["csrf_token"],
        },
        headers=write_headers(session_state["csrf_token"]),
    )

    payload = assert_error(response, status=422, code="UNPROCESSABLE")
    assert "tags" in payload["error"]["fields"]


def test_patch_requires_if_match(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(t07_session, name=unique_name())

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"summary": "改简介", "csrf_token": session_state["csrf_token"]},
        headers=write_headers(session_state["csrf_token"]),
    )

    assert_error(response, status=428, code="PRECONDITION_REQUIRED")


def test_patch_with_stale_version_is_rejected_and_keeps_data(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(t07_session, name=unique_name("原名"))
    original_summary = link.summary

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"name": "被覆盖的名字", "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"7"'},
    )

    payload = assert_error(response, status=412, code="VERSION_CONFLICT")
    assert "version" in payload["error"]["fields"]
    t07_session.refresh(link)
    assert link.name != "被覆盖的名字"
    assert link.summary == original_summary


def test_patch_only_touches_provided_fields_and_replaces_tags(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(
        t07_session,
        name=unique_name("保留的站名"),
        summary="保留的简介",
        story="保留的故事",
        tags=("旧标签",),
    )
    original_name = link.name

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={
            "tags": ["新标签", unique_tag("第二")],
            "position": 42,
            "csrf_token": session_state["csrf_token"],
        },
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == original_name
    assert body["summary"] == "保留的简介"
    assert body["story"] == "保留的故事"
    assert "新标签" in {tag["name"] for tag in body["tags"]}
    assert "旧标签" not in {tag["name"] for tag in body["tags"]}
    assert body["position"] == 42
    assert body["version"] == 2
    assert response.headers["ETag"] == '"2"'


def test_patch_can_clear_optional_story_and_arcana(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(t07_session, name=unique_name(), story="旧故事", arcana="IX · HERMIT")

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"story": None, "arcana": None, "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert response.status_code == 200, response.text
    assert response.json()["story"] is None
    assert response.json()["arcana"] is None


def test_patch_rejects_executable_url_without_changing_row(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(t07_session, name=unique_name(), url=SAFE_URL)

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"url": "data:text/html,<script>1</script>", "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert_error(response, status=422, code="UNPROCESSABLE")
    t07_session.refresh(link)
    assert link.url == SAFE_URL
    assert link.version == 1


def test_patch_with_no_fields_does_not_bump_version(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(t07_session, name=unique_name())

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert response.status_code == 200, response.text
    assert response.json()["version"] == 1
    assert response.headers["ETag"] == '"1"'


def test_if_match_wildcard_is_rejected(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_link(t07_session, name=unique_name())

    response = coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"summary": "x", "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": "*"},
    )

    assert_error(response, status=400, code="VALIDATION_FAILED")


def test_publish_makes_the_same_record_public_and_keeps_published_at(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    created = coop_client.post(
        ADMIN_PATH,
        json={**create_payload(name=unique_name("上线")), "csrf_token": session_state["csrf_token"]},
        headers=write_headers(session_state["csrf_token"]),
    ).json()

    published = coop_client.post(
        f"{ADMIN_PATH}/{created['id']}/publish",
        json={"csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert published.status_code == 200, published.text
    body = published.json()
    assert body["status"] == STATUS_PUBLISHED
    assert body["published_at"] is not None
    assert body["version"] == 2

    listed = coop_client.get(PUBLIC_PATH).json()["items"]
    assert [item["id"] for item in listed] == [created["id"]]
    assert listed[0]["name"] == created["name"]

    # 重新发布不刷新历史发布时间（与 nav 的约定一致）。
    again = coop_client.post(
        f"{ADMIN_PATH}/{created['id']}/publish",
        json={"csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"2"'},
    )
    assert again.json()["published_at"] == body["published_at"]


def test_unpublish_hides_link_from_public_but_keeps_it_in_admin(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_published_link(t07_session, name=unique_name("要撤回"), position=5)

    response = coop_client.post(
        f"{ADMIN_PATH}/{link.id}/unpublish",
        json={"csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == STATUS_DRAFT
    assert str(link.id) not in {item["id"] for item in coop_client.get(PUBLIC_PATH).json()["items"]}
    assert_error(coop_client.get(f"{PUBLIC_PATH}/{link.id}"), status=404, code="NOT_FOUND")
    # 管理端仍然看得到，站主可以继续编辑。
    assert coop_client.get(f"{ADMIN_PATH}/{link.id}").status_code == 200


def test_soft_delete_removes_from_public_and_keeps_row_for_admin(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    link = make_published_link(t07_session, name=unique_name("删除"))

    # httpx 的 delete 不带 json 关键字，这里用通用 request 发同一份请求体。
    response = coop_client.request(
        "DELETE",
        f"{ADMIN_PATH}/{link.id}",
        json={"csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert response.status_code == 204, response.text
    assert_error(coop_client.get(f"{PUBLIC_PATH}/{link.id}"), status=404, code="NOT_FOUND")
    admin_detail = coop_client.get(f"{ADMIN_PATH}/{link.id}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["deleted_at"] is not None
    assert admin_detail.json()["version"] == 2


def test_admin_list_includes_drafts_and_deleted_with_pagination(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    links = [make_link(t07_session, name=unique_name(f"管理{index}"), position=index) for index in range(3)]

    first = coop_client.get(ADMIN_PATH, params={"limit": 2}).json()
    assert len(first["items"]) == 2
    assert first["next_cursor"]

    second = coop_client.get(ADMIN_PATH, params={"limit": 2, "cursor": first["next_cursor"]}).json()
    ids = [item["id"] for item in first["items"]] + [item["id"] for item in second["items"]]
    assert sorted(ids) == sorted(str(link.id) for link in links)


def test_admin_unknown_id_is_404_even_with_if_match(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)

    response = coop_client.patch(
        f"{ADMIN_PATH}/{uuid.uuid4()}",
        json={"summary": "x", "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    assert_error(response, status=404, code="NOT_FOUND")


def test_position_update_changes_public_order(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    first = make_published_link(t07_session, name=unique_name("A"), position=10)
    second = make_published_link(t07_session, name=unique_name("B"), position=20)

    response = coop_client.patch(
        f"{ADMIN_PATH}/{second.id}",
        json={"position": 5, "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )
    assert response.status_code == 200, response.text

    listed = coop_client.get(PUBLIC_PATH).json()["items"]
    assert [item["id"] for item in listed] == [str(second.id), str(first.id)]


def test_avatar_must_point_to_a_ready_media(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)

    response = coop_client.post(
        ADMIN_PATH,
        json={
            **create_payload(),
            "avatar_media_id": str(uuid.uuid4()),
            "csrf_token": session_state["csrf_token"],
        },
        headers=write_headers(session_state["csrf_token"]),
    )

    payload = assert_error(response, status=422, code="UNPROCESSABLE")
    assert "avatar_media_id" in payload["error"]["fields"]


def test_published_at_is_never_refreshed_by_edits(coop_client, t07_session):
    session_state = admin_login(coop_client, t07_session)
    published_at = datetime.now(UTC) - timedelta(days=3)
    link = make_published_link(t07_session, name=unique_name(), published_at=published_at)

    coop_client.patch(
        f"{ADMIN_PATH}/{link.id}",
        json={"summary": "改一下", "csrf_token": session_state["csrf_token"]},
        headers={**write_headers(session_state["csrf_token"]), "If-Match": '"1"'},
    )

    detail = coop_client.get(f"{ADMIN_PATH}/{link.id}").json()
    assert datetime.fromisoformat(detail["published_at"]) == published_at
