"""草稿 / 私密手记在所有公开入口都不可读（验收 1、验收 2、集成矩阵「日记 private 或 draft」）。

这是本包**最重要**的一组用例：它先于实现被写出来（初始应当失败），
因为「私密内容不泄漏」不是靠界面隐藏链接实现的，而是靠服务端的公开条件。

覆盖的公开入口：
  1. 列表 `GET /journal/entries`
  2. 详情 `GET /journal/entries/{id}`
  3. 日历 `GET /journal/calendar`（计数与日期）
  4. 图片 `GET /media/{id}/{variant}`（匿名读取）
  5. 分享摘要：公开列表 / 详情响应文本里不得出现私密标题、正文、心情或地点

并且验证「切为 private 后**新请求**立即生效」——没有缓存或延迟失效。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.journal.models import (
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
)
from app.modules.media import public_refs as media_public_refs
from app.modules.journal import public_refs as journal_public_refs
from tests.journal.helpers import (
    admin_login,
    assert_error,
    create_payload,
    make_entry,
    make_public_entry,
    unique_title,
)
from tests.media.helpers import make_media_row

UTC = timezone.utc


def _image(session, settings, owner_id):
    return make_media_row(session, owner_id=owner_id, root=settings.media_root_path)


def test_public_list_only_shows_published_and_public(public_journal_client, t05_session: Session):
    """草稿、私密、已删除、未来日期都不出现在公开列表里。"""
    visible = make_public_entry(t05_session, entry_date=date(2026, 10, 1), title="公开的一天")
    hidden = [
        make_entry(t05_session, title="草稿的一天", status=STATUS_DRAFT),
        make_entry(
            t05_session,
            title="私密的一天",
            status=STATUS_PUBLISHED,
            visibility=VISIBILITY_PRIVATE,
        ),
        make_entry(
            t05_session,
            title="公开但已删除",
            status=STATUS_PUBLISHED,
            visibility=VISIBILITY_PUBLIC,
            deleted_at=datetime.now(UTC),
        ),
        make_public_entry(t05_session, title="未来的一天", entry_date=date(2099, 1, 1)),
    ]

    response = public_journal_client.get("/api/v1/journal/entries")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"items", "next_cursor"}
    titles = [item["title"] for item in payload["items"]]

    assert titles == [visible.title]
    body = response.text
    for item in hidden:
        assert item.title not in body, f"公开列表泄漏了 {item.title}"
    for leaked in ("version", "deleted_at", "visibility", "status", "private", "draft"):
        assert leaked not in body, f"公开列表响应里出现了内部字段 {leaked}"


def test_public_detail_of_private_or_draft_is_404(public_journal_client, t05_session: Session):
    """草稿 / 私密 / 已删除 / 未来日期的详情统一 404，与「真的不存在」不可区分。"""
    draft = make_entry(t05_session, title="草稿详情", status=STATUS_DRAFT)
    private = make_entry(
        t05_session, title="私密详情", status=STATUS_PUBLISHED, visibility=VISIBILITY_PRIVATE
    )
    deleted = make_public_entry(
        t05_session, title="已删除详情", deleted_at=datetime.now(UTC)
    )
    future = make_public_entry(
        t05_session, title="未来详情", entry_date=date(2099, 2, 2)
    )
    unknown = uuid.uuid4()

    for entry in (draft, private, deleted, future):
        response = public_journal_client.get(f"/api/v1/journal/entries/{entry.id}")
        assert_error(response, status=404, code="NOT_FOUND")
        assert entry.title not in response.text

    response = public_journal_client.get(f"/api/v1/journal/entries/{unknown}")
    missing = assert_error(response, status=404, code="NOT_FOUND")
    # 「不存在」与「无权」的响应形状必须完全一致。
    reference = public_journal_client.get(f"/api/v1/journal/entries/{draft.id}").json()
    assert set(missing) == set(reference)
    assert missing["error"]["message"] == reference["error"]["message"]


def test_calendar_counts_only_public_entries(public_journal_client, t05_session: Session):
    """日历只聚合真正公开的记录；空日期不出现在结果里，也不显示隐藏记录数量。"""
    make_public_entry(t05_session, entry_date=date(2026, 10, 5), title="公开的 5 号")
    make_public_entry(t05_session, entry_date=date(2026, 10, 5), title="公开的 5 号之二")
    make_public_entry(t05_session, entry_date=date(2026, 10, 9), title="公开的 9 号")

    make_entry(
        t05_session,
        entry_date=date(2026, 10, 6),
        title="私密的 6 号",
        status=STATUS_PUBLISHED,
        visibility=VISIBILITY_PRIVATE,
    )
    make_entry(t05_session, entry_date=date(2026, 10, 7), title="草稿的 7 号")
    make_public_entry(t05_session, entry_date=date(2026, 10, 8), title="删除的 8 号",
                      deleted_at=datetime.now(UTC))

    response = public_journal_client.get("/api/v1/journal/calendar", params={"year": 2026})
    assert response.status_code == 200, response.text
    payload = response.json()
    days = payload["months"][0]["days"]

    assert days == {"2026-10-05": 2, "2026-10-09": 1}
    assert payload["total_entries"] == 3
    assert payload["timezone"] == "Asia/Shanghai"
    # 隐藏记录的日期与数量不得出现在响应里。
    text = response.text
    for leaked in ("2026-10-06", "2026-10-07", "2026-10-08"):
        assert leaked not in text, f"日历泄漏了隐藏日期 {leaked}"


def test_calendar_empty_month_has_no_months(public_journal_client, t05_session: Session):
    """没有任何公开记录的年月：`months` 是空列表，不是「有 0 篇」的占位。"""
    make_entry(
        t05_session,
        entry_date=date(2031, 3, 3),
        title="私密的三月",
        status=STATUS_PUBLISHED,
        visibility=VISIBILITY_PRIVATE,
    )

    response = public_journal_client.get("/api/v1/journal/calendar", params={"year": 2031})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["months"] == []
    assert payload["total_entries"] == 0


def test_private_media_is_not_readable_anonymously(
    media_client, t05_session: Session, t05_settings
):
    """未登记任何公开引用检查时，即使日记公开，图片对匿名也是 404（默认拒绝）。"""
    media = _image(t05_session, t05_settings, _owner_id(t05_session))

    make_public_entry(t05_session, images=((media, 0, "公开日记的图"),))

    # 默认拒绝：没有登记 journal 的检查器。
    assert "journal" not in media_public_refs.registered()
    response = media_client.get(f"/api/v1/media/{media.id}/w320.webp")
    assert_error(response, status=404, code="NOT_FOUND")


def test_public_entry_image_requires_registered_checker(
    media_client, t05_session: Session, t05_settings
):
    """登记 journal 检查器之后，公开日记的图片匿名可读（否则就是「发布成功但全是坏图」）。"""
    owner = _owner_id(t05_session)
    media = _image(t05_session, t05_settings, owner)
    make_public_entry(t05_session, images=((media, 0, "公开日记的图"),))

    journal_public_refs.register()
    try:
        response = media_client.get(f"/api/v1/media/{media.id}/w320.webp")
        assert response.status_code == 200, response.text
    finally:
        journal_public_refs.unregister()


def test_private_entry_image_stays_unreadable_when_only_reference(
    media_client, t05_session: Session, t05_settings
):
    """只有私密日记引用时，登记了检查器也仍然 404。"""
    media = _image(t05_session, t05_settings, _owner_id(t05_session))
    make_entry(
        t05_session,
        title="私密配图",
        status=STATUS_PUBLISHED,
        visibility=VISIBILITY_PRIVATE,
        images=((media, 0, "私密日记的图"),),
    )

    journal_public_refs.register()
    try:
        assert_error(media_client.get(f"/api/v1/media/{media.id}/w320.webp"), status=404,
                     code="NOT_FOUND")
    finally:
        journal_public_refs.unregister()


def test_switching_to_private_takes_effect_on_the_next_request(
    journal_media_client, anonymous_client, t05_session: Session, t05_settings
):
    """切为 private 后**新请求立即生效**（验收 1）：列表、详情、日历、图片同时拒读。"""
    media = _image(t05_session, t05_settings, _owner_id(t05_session))
    entry = make_public_entry(
        t05_session,
        entry_date=date(2026, 10, 12),
        title=unique_title("立即生效"),
        images=((media, 0, "今天的照片"),),
    )
    journal_public_refs.register()
    try:
        session_state = admin_login(journal_media_client, t05_session, username="owner-journal")
        # 切之前：公开可见。
        assert journal_media_client.get("/api/v1/journal/entries").status_code == 200
        assert (
            journal_media_client.get(f"/api/v1/journal/entries/{entry.id}").status_code == 200
        )
        # 匿名读取要用**没有站主 Cookie** 的客户端：站主本来就能读原图与已撤回对象，
        # 用登录态的客户端测「匿名能不能读」会永远通过（这是 T01 的既定语义）。
        assert anonymous_client.get(f"/api/v1/media/{media.id}/w320.webp").status_code == 200

        current = journal_media_client.get(f"/api/v1/admin/journal/entries/{entry.id}")
        assert current.status_code == 200, current.text
        version = current.headers["ETag"]

        switched = journal_media_client.post(
            f"/api/v1/admin/journal/entries/{entry.id}/visibility",
            params={"visibility": "private"},
            json={"csrf_token": session_state["csrf_token"]},
            headers={
                "Origin": "http://testserver",
                "If-Match": version,
            },
        )
        assert switched.status_code == 200, switched.text
        assert switched.json()["visibility"] == "private"

        # **新请求**立即拒读：没有缓存需要失效。
        listing = journal_media_client.get("/api/v1/journal/entries")
        assert entry.title not in listing.text
        assert_error(
            journal_media_client.get(f"/api/v1/journal/entries/{entry.id}"), status=404,
            code="NOT_FOUND",
        )
        calendar = journal_media_client.get("/api/v1/journal/calendar", params={"year": 2026})
        assert calendar.json()["months"] == [] or all(
            "2026-10-12" not in month["days"] for month in calendar.json()["months"]
        )
        assert_error(
            anonymous_client.get(f"/api/v1/media/{media.id}/w320.webp"), status=404,
            code="NOT_FOUND",
        )

        # 再切回 public：同样立即生效（可见性是可逆的，不是单向破坏）。
        back = journal_media_client.post(
            f"/api/v1/admin/journal/entries/{entry.id}/visibility",
            params={"visibility": "public"},
            json={"csrf_token": session_state["csrf_token"]},
            headers={"Origin": "http://testserver", "If-Match": switched.headers["ETag"]},
        )
        assert back.status_code == 200, back.text
        assert (
            journal_media_client.get(f"/api/v1/journal/entries/{entry.id}").status_code == 200
        )
        assert anonymous_client.get(f"/api/v1/media/{media.id}/w320.webp").status_code == 200
    finally:
        journal_public_refs.unregister()


def test_logged_in_owner_reads_public_endpoints_without_extra_drafts(
    journal_client, t05_session: Session
):
    """站主登录后读公开端点**也不会**多拿草稿（预览只走管理端点，05 §7）。"""
    draft = make_entry(t05_session, title="只有站主看得到的草稿")
    public = make_public_entry(t05_session, entry_date=date(2026, 10, 2), title="公开的一天")
    admin_login(journal_client, t05_session, username="owner-preview")

    listing = journal_client.get("/api/v1/journal/entries")
    assert listing.status_code == 200, listing.text
    assert draft.title not in listing.text
    assert public.title in listing.text

    assert_error(
        journal_client.get(f"/api/v1/journal/entries/{draft.id}"), status=404, code="NOT_FOUND"
    )
    # 管理端点才是草稿的唯一入口，并且它带 ETag。
    admin_read = journal_client.get(f"/api/v1/admin/journal/entries/{draft.id}")
    assert admin_read.status_code == 200, admin_read.text
    assert admin_read.json()["status"] == "draft"
    assert admin_read.json()["visibility"] == "private"
    assert admin_read.headers["ETag"] == '"1"'


def test_new_entry_defaults_to_draft_and_private(journal_client, t05_session: Session):
    """新建默认 draft + private，且**请求体里无法**把它直接建成公开（验收 1）。"""
    state = admin_login(journal_client, t05_session, username="owner-defaults")

    created = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={**create_payload(), "csrf_token": state["csrf_token"]},
        headers={"Origin": "http://testserver"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "draft"
    assert body["visibility"] == "private"
    assert body["public"] is False

    # 请求体里塞 status / visibility 会被拒绝（extra="forbid"），不是被静默忽略。
    rejected = journal_client.post(
        "/api/v1/admin/journal/entries",
        json={**create_payload(), "status": "published", "csrf_token": state["csrf_token"]},
        headers={"Origin": "http://testserver"},
    )
    assert rejected.status_code == 422, rejected.text

    # 新建的这条在公开列表里一定看不到。
    listing = journal_client.get("/api/v1/journal/entries")
    assert body["title"] not in listing.text


def test_unpublish_is_immediately_effective(journal_client, t05_session: Session):
    """撤回（unpublish）同样立即生效，且不删除图片关系。"""
    entry = make_public_entry(t05_session, entry_date=date(2026, 10, 3), title="撤回我")
    state = admin_login(journal_client, t05_session, username="owner-unpublish")

    current = journal_client.get(f"/api/v1/admin/journal/entries/{entry.id}")
    assert current.status_code == 200, current.text

    response = journal_client.post(
        f"/api/v1/admin/journal/entries/{entry.id}/unpublish",
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": "http://testserver", "If-Match": current.headers["ETag"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "draft"
    # 撤回不清空首次发布时间（重新发布不会刷新历史时间）。
    assert response.json()["published_at"] is not None

    assert_error(
        journal_client.get(f"/api/v1/journal/entries/{entry.id}"), status=404, code="NOT_FOUND"
    )


def _owner_id(session: Session):
    """取（或建）站主 ID：媒体记录需要 owner_id 外键。"""
    from app.modules.auth import service as auth_service
    from tests.auth.helpers import DEFAULT_USERNAME, make_admin

    user = auth_service.find_user(session, DEFAULT_USERNAME)
    if user is None:
        user = make_admin(session, username=DEFAULT_USERNAME)
    return user.id
