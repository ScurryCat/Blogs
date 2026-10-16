"""手记管理端：登录要求、CSRF、If-Match、发布门槛、软删除（05 §5 / §7）。

覆盖验收：
  - 「公共管理写入被拒绝」：未登录 / 跨站 Origin / 缺 CSRF 一律拒绝（验收 4）；
  - 更新 / 发布 / 撤回 / 切可见性 / 删除都要 `If-Match`（缺 428、不符 412）；
  - 发布门槛：缺标题或正文 → 409，**不是** 200 也不是 500；
  - 关联的媒体必须 ready，否则 409 且不写入半成品关系。
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.modules.journal.models import JournalEntry, journal_entry_media
from tests.journal.helpers import (
    admin_login,
    assert_error,
    create_payload,
    make_entry,
    make_public_entry,
    unique_title,
)
from tests.media.helpers import make_media_row

ORIGIN = "http://testserver"


def _create(client, token: str, **overrides):
    response = client.post(
        "/api/v1/admin/journal/entries",
        json={**create_payload(**overrides), "csrf_token": token},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 201, response.text
    return response


def test_admin_endpoints_require_login(journal_client, t05_session: Session):
    entry = make_public_entry(t05_session, entry_date=date(2021, 3, 3))
    for method, path in (
        ("get", "/api/v1/admin/journal/entries"),
        ("get", f"/api/v1/admin/journal/entries/{entry.id}"),
        ("delete", f"/api/v1/admin/journal/entries/{entry.id}"),
    ):
        response = getattr(journal_client, method)(path)
        assert_error(response, status=401, code="UNAUTHORIZED")


def test_admin_write_requires_csrf_and_same_origin(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-csrf")

    missing_csrf = journal_client.post(
        "/api/v1/admin/journal/entries",
        json=create_payload(),
        headers={"Origin": ORIGIN},
    )
    assert_error(missing_csrf, status=403, code="FORBIDDEN")

    cross_origin = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={**create_payload(), "csrf_token": state["csrf_token"]},
        headers={"Origin": "https://evil.example"},
    )
    assert_error(cross_origin, status=403, code="FORBIDDEN")

    # 表里确实什么都没写进去。
    assert t05_session.query(JournalEntry).count() == 0


def test_create_then_publish_then_visible(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-flow")
    created = _create(journal_client, state["csrf_token"], entry_date="2020-05-05")
    body = created.json()
    assert body["public"] is False

    publish = journal_client.post(
        f"/api/v1/admin/journal/entries/{body['id']}/publish",
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert publish.status_code == 200, publish.text
    published = publish.json()
    assert published["status"] == "published"
    # 只发布、还没切 public：公开入口仍然看不到（两个条件都要满足）。
    assert published["public"] is False
    assert published["title"] not in journal_client.get("/api/v1/journal/entries").text

    switched = journal_client.post(
        f"/api/v1/admin/journal/entries/{body['id']}/visibility",
        params={"visibility": "public"},
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": publish.headers["ETag"]},
    )
    assert switched.status_code == 200, switched.text
    assert switched.json()["public"] is True

    seen = journal_client.get("/api/v1/journal/entries", params={"year": 2020})
    assert seen.status_code == 200, seen.text
    assert body["title"] in seen.text
    detail = journal_client.get(f"/api/v1/journal/entries/{body['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["title"] == body["title"]


def test_if_match_is_required_and_enforced(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-ifmatch")
    created = _create(journal_client, state["csrf_token"])
    entry_id = created.json()["id"]

    def patch(headers: dict[str, str]):
        return journal_client.patch(
            f"/api/v1/admin/journal/entries/{entry_id}",
            json={"title": unique_title("改过"), "csrf_token": state["csrf_token"]},
            headers={"Origin": ORIGIN, **headers},
        )

    assert_error(patch({}), status=428, code="PRECONDITION_REQUIRED")
    assert_error(patch({"If-Match": '"999"'}), status=412, code="VERSION_CONFLICT")
    assert_error(patch({"If-Match": "*"}), status=400, code="VALIDATION_FAILED")

    ok = patch({"If-Match": created.headers["ETag"]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["version"] == 2
    assert ok.headers["ETag"] == '"2"'

    # 用第一次读到的版本再改一次 → 412（不丢并行编辑）。
    stale = journal_client.patch(
        f"/api/v1/admin/journal/entries/{entry_id}",
        json={"title": unique_title("再来"), "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert_error(stale, status=412, code="VERSION_CONFLICT")


def test_publish_requires_title_and_content(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-gate")
    created = _create(journal_client, state["csrf_token"], title="", content_md="")

    blocked = journal_client.post(
        f"/api/v1/admin/journal/entries/{created.json()['id']}/publish",
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert_error(blocked, status=409, code="CONFLICT")
    assert "title" in blocked.json()["error"]["fields"]

    # 补上标题与正文后可以发布。
    filled = journal_client.patch(
        f"/api/v1/admin/journal/entries/{created.json()['id']}",
        json={
            "title": unique_title("补好了"),
            "content_md": "今天终于写完了。",
            "csrf_token": state["csrf_token"],
        },
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert filled.status_code == 200, filled.text
    published = journal_client.post(
        f"/api/v1/admin/journal/entries/{created.json()['id']}/publish",
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": filled.headers["ETag"]},
    )
    assert published.status_code == 200, published.text


def test_images_must_be_ready(journal_client, t05_session: Session, t05_settings):
    state = admin_login(journal_client, t05_session, username="owner-media")
    owner_id = _owner_id(t05_session)
    broken = make_media_row(
        t05_session, owner_id=owner_id, root=t05_settings.media_root_path, status="processing"
    )

    response = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={
            **create_payload(),
            "images": [{"media_id": str(broken.id), "position": 0, "alt": "还没处理完的图"}],
            "csrf_token": state["csrf_token"],
        },
        headers={"Origin": ORIGIN},
    )
    assert_error(response, status=409, code="CONFLICT")
    # 没有写入半成品关系：日记本身也没建出来。
    assert t05_session.query(JournalEntry).count() == 0
    assert t05_session.execute(journal_entry_media.select()).all() == []


def test_image_positions_must_be_contiguous(journal_client, t05_session: Session, t05_settings):
    state = admin_login(journal_client, t05_session, username="owner-positions")
    owner_id = _owner_id(t05_session)
    first = make_media_row(t05_session, owner_id=owner_id, root=t05_settings.media_root_path)
    second = make_media_row(t05_session, owner_id=owner_id, root=t05_settings.media_root_path)

    response = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={
            **create_payload(),
            "images": [
                {"media_id": str(first.id), "position": 0, "alt": "一"},
                {"media_id": str(second.id), "position": 2, "alt": "三"},
            ],
            "csrf_token": state["csrf_token"],
        },
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 422, response.text


def test_images_are_replaced_wholesale(journal_client, t05_session: Session, t05_settings):
    state = admin_login(journal_client, t05_session, username="owner-replace")
    owner_id = _owner_id(t05_session)
    first = make_media_row(t05_session, owner_id=owner_id, root=t05_settings.media_root_path)
    second = make_media_row(t05_session, owner_id=owner_id, root=t05_settings.media_root_path)

    created = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={
            **create_payload(),
            "images": [{"media_id": str(first.id), "position": 0, "alt": "第一张"}],
            "csrf_token": state["csrf_token"],
        },
        headers={"Origin": ORIGIN},
    )
    assert created.status_code == 201, created.text
    entry_id = created.json()["id"]
    assert [image["media_id"] for image in created.json()["images"]] == [str(first.id)]

    replaced = journal_client.patch(
        f"/api/v1/admin/journal/entries/{entry_id}",
        json={
            "images": [{"media_id": str(second.id), "position": 0, "alt": "换了一张"}],
            "csrf_token": state["csrf_token"],
        },
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert replaced.status_code == 200, replaced.text
    assert [image["media_id"] for image in replaced.json()["images"]] == [str(second.id)]

    cleared = journal_client.patch(
        f"/api/v1/admin/journal/entries/{entry_id}",
        json={"images": [], "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": replaced.headers["ETag"]},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["images"] == []


def test_shared_media_is_reported_honestly(journal_client, t05_session: Session, t05_settings):
    """一张图还有别的公开引用时必须如实提示（05 §11），不声称「切私密就撤回了图」。"""
    from app.modules.media import public_refs as media_public_refs

    state = admin_login(journal_client, t05_session, username="owner-shared")
    media = make_media_row(
        t05_session, owner_id=_owner_id(t05_session), root=t05_settings.media_root_path
    )

    def other_domain_reference(session, media_id) -> bool:  # noqa: ANN001
        return media_id == media.id

    media_public_refs.register("other-domain", other_domain_reference)
    try:
        created = journal_client.post(
            "/api/v1/admin/journal/entries",
            json={
                **create_payload(),
                "images": [{"media_id": str(media.id), "position": 0, "alt": "共用的一张图"}],
                "csrf_token": state["csrf_token"],
            },
            headers={"Origin": ORIGIN},
        )
        assert created.status_code == 201, created.text
        body = created.json()
        # 这条日记自己还没公开，所以 public 是 false；但图片已经因为别的公开引用而公开。
        assert body["public"] is False
        assert str(media.id) in body["shared_media"]
        assert body["images"][0]["still_public"] is True

        # 管理端有明确的说明文案字段：shared_media 非空 = 「切私密不会撤回这张图」。
        detail = journal_client.get(f"/api/v1/admin/journal/entries/{body['id']}")
        assert str(media.id) in detail.json()["shared_media"]
    finally:
        media_public_refs.unregister("other-domain")


def test_delete_is_soft_and_hides_immediately(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-delete")
    entry = make_public_entry(t05_session, entry_date=date(2019, 9, 9), title="要删的一天")

    # DELETE 用 `X-CSRF-Token` 请求头而不是 JSON body（core/csrf.py 支持两种传输；
    # httpx 的 `delete()` 不接受 `json=`，而请求头方式对无体请求更自然）。
    response = journal_client.delete(
        f"/api/v1/admin/journal/entries/{entry.id}",
        headers={"Origin": ORIGIN, "X-CSRF-Token": state["csrf_token"], "If-Match": '"1"'},
    )
    assert response.status_code == 204, response.text
    assert response.content == b""

    # 软删除：行还在（可人工恢复），但公开与管理端点都看不到了。
    t05_session.expire_all()
    row = t05_session.get(JournalEntry, entry.id)
    assert row is not None and row.deleted_at is not None
    assert_error(
        journal_client.get(f"/api/v1/journal/entries/{entry.id}"), status=404, code="NOT_FOUND"
    )
    assert_error(
        journal_client.get(f"/api/v1/admin/journal/entries/{entry.id}"), status=404, code="NOT_FOUND"
    )


def test_review_post_reference_must_exist(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-review")
    response = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={**create_payload(), "post_id": str(uuid.uuid4()), "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN},
    )
    assert_error(response, status=409, code="CONFLICT")


def test_review_post_link_is_returned_and_hidden_when_draft(journal_client, t05_session: Session):
    """长文引用：公开端点只给公开文章的标题；草稿文章不泄漏标题。"""
    from tests.posts.helpers import make_draft, make_post

    state = admin_login(journal_client, t05_session, username="owner-review2")
    published_post = make_post(t05_session, title="公开的长文")
    draft_post = make_draft(t05_session, title="草稿长文标题不该泄漏")

    public_entry = make_public_entry(
        t05_session,
        entry_date=date(2018, 8, 8),
        title="关联公开长文的一天",
        post_id=published_post.id,
    )
    draft_entry = make_public_entry(
        t05_session,
        entry_date=date(2018, 8, 9),
        title="关联草稿长文的一天",
        post_id=draft_post.id,
    )

    detail = journal_client.get(f"/api/v1/journal/entries/{public_entry.id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["post"]["slug"] == published_post.slug
    assert detail.json()["post"]["title"] == "公开的长文"

    hidden = journal_client.get(f"/api/v1/journal/entries/{draft_entry.id}")
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["post"] is None
    assert "草稿长文标题不该泄漏" not in hidden.text

    # 管理端可以看到它关联的是哪篇（含草稿），并标明当前是否公开。
    admin_view = journal_client.get(f"/api/v1/admin/journal/entries/{draft_entry.id}")
    assert admin_view.status_code == 200, admin_view.text
    assert admin_view.json()["post"]["status"] == "draft"
    assert admin_view.json()["post"]["public"] is False
    assert state["authenticated"] is True


def test_admin_list_filters_and_never_returns_deleted(journal_client, t05_session: Session):
    state = admin_login(journal_client, t05_session, username="owner-filters")
    draft = make_entry(t05_session, entry_date=date(2017, 1, 1), title="草稿")
    make_public_entry(t05_session, entry_date=date(2017, 1, 2), title="公开")

    listing = journal_client.get("/api/v1/admin/journal/entries", params={"status": "draft"})
    assert listing.status_code == 200, listing.text
    titles = [item["title"] for item in listing.json()["items"]]
    assert titles == [draft.title]

    private_only = journal_client.get(
        "/api/v1/admin/journal/entries", params={"visibility": "private"}
    )
    assert private_only.status_code == 200, private_only.text
    assert draft.title in [item["title"] for item in private_only.json()["items"]]

    assert state["authenticated"] is True


def _owner_id(session: Session):
    from app.modules.auth import service as auth_service
    from tests.auth.helpers import DEFAULT_USERNAME, make_admin

    for username in (DEFAULT_USERNAME, "owner-media", "owner-replace", "owner-review"):
        user = auth_service.find_user(session, username)
        if user is not None:
            return user.id
    return make_admin(session, username=DEFAULT_USERNAME).id
