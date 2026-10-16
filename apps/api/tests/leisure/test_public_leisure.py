"""放课后公开端点的权限与筛选（05 §6 / §7，验收 3、4）。

  - 草稿 / 已删除条目在列表与详情里都不可见；
  - `kind` 筛选把追番与游戏分开（同一组端点，两个页签）；
  - 公开长评引用只给公开文章，草稿长评的标题不泄漏；
  - 公开端点 `no-store`；站主登录读公开端点也不会多拿草稿。
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from tests.leisure.helpers import (
    admin_login,
    assert_error,
    make_anime,
    make_game,
    make_public_anime,
    make_public_game,
)

UTC = timezone.utc

PUBLIC_KEYS = {
    "id",
    "kind",
    "title",
    "progress",
    "progress_label",
    "rating",
    "notes",
    "notes_have_spoilers",
    "cover",
    "anime",
    "game",
    "review",
    "updated_at",
}


def test_public_list_hides_drafts_and_deleted(public_leisure_client, t05_session: Session):
    visible = make_public_anime(t05_session, title="公开的追番")
    make_anime(t05_session, title="草稿追番")
    make_public_anime(t05_session, title="已删除追番", deleted_at=datetime.now(UTC))
    public_game = make_public_game(t05_session, title="公开的游戏")
    make_game(t05_session, title="草稿游戏")

    response = public_leisure_client.get("/api/v1/leisure/entries", params={"limit": 30})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"items", "next_cursor"}
    titles = [item["title"] for item in payload["items"]]

    assert visible.title in titles
    assert public_game.title in titles
    assert "草稿追番" not in titles
    assert "草稿游戏" not in titles
    assert "已删除追番" not in titles
    for item in payload["items"]:
        assert set(item) == PUBLIC_KEYS


def test_kind_filter_separates_the_two_tabs(public_leisure_client, t05_session: Session):
    anime = make_public_anime(t05_session, title="只有追番页签看得到")
    game = make_public_game(t05_session, title="只有游戏页签看得到")

    anime_only = public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "anime", "limit": 30}
    )
    assert anime_only.status_code == 200, anime_only.text
    titles = [item["title"] for item in anime_only.json()["items"]]
    assert anime.title in titles and game.title not in titles
    assert all(item["kind"] == "anime" for item in anime_only.json()["items"])

    game_only = public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "game", "limit": 30}
    )
    assert game_only.status_code == 200, game_only.text
    titles = [item["title"] for item in game_only.json()["items"]]
    assert game.title in titles and anime.title not in titles


def test_kind_filter_rejects_unknown_value(public_leisure_client):
    assert public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "movie"}
    ).status_code == 422


def test_progress_filter(public_leisure_client, t05_session: Session):
    watching = make_public_anime(t05_session, progress="watching", title="在看")
    dropped = make_public_anime(t05_session, progress="dropped", title="弃坑")

    response = public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "anime", "progress": "dropped", "limit": 30}
    )
    assert response.status_code == 200, response.text
    titles = [item["title"] for item in response.json()["items"]]
    assert dropped.title in titles
    assert watching.title not in titles


def test_public_detail_404_for_draft(public_leisure_client, t05_session: Session):
    draft = make_anime(t05_session, title="草稿详情")
    deleted = make_public_anime(t05_session, title="已删除详情", deleted_at=datetime.now(UTC))

    for entry in (draft, deleted):
        response = public_leisure_client.get(f"/api/v1/leisure/entries/{entry.id}")
        assert_error(response, status=404, code="NOT_FOUND")
        assert entry.title not in response.text


def test_public_detail_rejects_non_uuid(public_leisure_client):
    assert_error(
        public_leisure_client.get("/api/v1/leisure/entries/not-a-uuid"),
        status=422,
        code="UNPROCESSABLE",
    )


def test_public_detail_review_hides_draft_post(public_leisure_client, t05_session: Session):
    from tests.posts.helpers import make_draft, make_post

    published_post = make_post(t05_session, title="公开长评")
    draft_post = make_draft(t05_session, title="草稿长评标题不该泄漏")

    with_public = make_public_anime(t05_session, title="有公开长评", rating=9)
    with_public.review_post_id = published_post.id
    with_draft = make_public_anime(t05_session, title="只有草稿长评")
    with_draft.review_post_id = draft_post.id
    t05_session.flush()

    good = public_leisure_client.get(f"/api/v1/leisure/entries/{with_public.id}")
    assert good.status_code == 200, good.text
    assert good.json()["review"]["slug"] == published_post.slug
    assert good.json()["review"]["title"] == "公开长评"

    hidden = public_leisure_client.get(f"/api/v1/leisure/entries/{with_draft.id}")
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["review"] is None
    assert "草稿长评标题不该泄漏" not in hidden.text


def test_logged_in_owner_gets_no_extra_drafts(leisure_client, t05_session: Session):
    draft = make_anime(t05_session, title="站主也不该在公开端点看到我")
    admin_login(leisure_client, t05_session, username="owner-leisure-public")

    listing = leisure_client.get("/api/v1/leisure/entries", params={"limit": 30})
    assert listing.status_code == 200, listing.text
    assert draft.title not in listing.text
    assert_error(
        leisure_client.get(f"/api/v1/leisure/entries/{draft.id}"), status=404, code="NOT_FOUND"
    )
    # 管理端点才是草稿的入口。
    assert leisure_client.get(f"/api/v1/admin/leisure/entries/{draft.id}").status_code == 200


def test_public_list_is_no_store(public_leisure_client, t05_session: Session):
    entry = make_public_anime(t05_session)
    for path in ("/api/v1/leisure/entries", f"/api/v1/leisure/entries/{entry.id}"):
        response = public_leisure_client.get(path)
        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "no-store", path


def test_pagination_is_stable_and_cursor_bound_to_filters(
    public_leisure_client, t05_session: Session
):
    created = [make_public_anime(t05_session) for _ in range(3)]

    first = public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "anime", "limit": 2}
    )
    assert first.status_code == 200, first.text
    cursor = first.json()["next_cursor"]
    assert cursor, "还有下一页时 next_cursor 不应为 null"
    assert len(first.json()["items"]) == 2

    second = public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "anime", "limit": 2, "cursor": cursor}
    )
    assert second.status_code == 200, second.text
    ids = [item["id"] for item in first.json()["items"] + second.json()["items"]]
    assert len(ids) == len(set(ids)), "翻页不应重复"
    assert set(ids) == {str(entry.id) for entry in created}

    # 换筛选后复用旧游标 → 400（不是静默当成第一页）。
    assert_error(
        public_leisure_client.get(
            "/api/v1/leisure/entries",
            params={"kind": "game", "limit": 2, "cursor": cursor},
        ),
        status=400,
        code="VALIDATION_FAILED",
    )
    assert_error(
        public_leisure_client.get(
            "/api/v1/leisure/entries", params={"kind": "anime", "limit": 2, "cursor": "junk"}
        ),
        status=400,
        code="VALIDATION_FAILED",
    )


def test_cover_image_requires_registered_checker(
    public_leisure_client, leisure_client, anonymous_client, t05_session: Session, t05_settings
):
    """已发布条目的封面在**登记检查器之后**匿名可读；草稿封面不可读。"""
    from app.modules.leisure import wiring
    from tests.media.helpers import make_media_row

    owner_id = _owner_id(t05_session)
    cover = make_media_row(t05_session, owner_id=owner_id, root=t05_settings.media_root_path)
    draft_cover = make_media_row(
        t05_session, owner_id=owner_id, root=t05_settings.media_root_path
    )

    published = make_public_anime(t05_session, cover_media_id=cover.id, title="有封面的追番")
    make_anime(t05_session, cover_media_id=draft_cover.id, title="草稿有封面")

    payload = public_leisure_client.get(f"/api/v1/leisure/entries/{published.id}").json()
    assert payload["cover"] is not None
    assert payload["cover"]["id"] == str(cover.id)

    wiring.register()
    try:
        assert (
            anonymous_client.get(f"/api/v1/media/{cover.id}/w320.webp").status_code == 200
        ), "已发布条目的封面必须匿名可读（否则就是「发布成功但全是坏图」）"
        assert_error(
            anonymous_client.get(f"/api/v1/media/{draft_cover.id}/w320.webp"),
            status=404,
            code="NOT_FOUND",
        )
    finally:
        wiring.unregister()


def _owner_id(session: Session):
    from app.modules.auth import service as auth_service
    from tests.auth.helpers import DEFAULT_USERNAME, make_admin

    for username in (DEFAULT_USERNAME, "owner-leisure-public"):
        user = auth_service.find_user(session, username)
        if user is not None:
            return user.id
    return make_admin(session, username=DEFAULT_USERNAME).id


def test_updated_at_is_the_public_sort_key(public_leisure_client, t05_session: Session):
    """排序按 `updated_at`：进度更新后回到列表前面（与「最近在看什么」一致）。"""
    older = make_public_anime(t05_session, title="先更新的")
    newer = make_public_anime(t05_session, title="后更新的")
    older.updated_at = datetime(2019, 1, 1, tzinfo=UTC)
    newer.updated_at = datetime(2020, 1, 1, tzinfo=UTC)
    t05_session.flush()

    listing = public_leisure_client.get(
        "/api/v1/leisure/entries", params={"kind": "anime", "limit": 30}
    ).json()
    titles = [item["title"] for item in listing["items"]]
    assert titles.index("后更新的") < titles.index("先更新的")


def test_leisure_dates_round_trip_as_plain_dates(public_leisure_client, t05_session: Session):
    entry = make_public_anime(
        t05_session,
        last_watched_on=date(2020, 5, 5),
        total_episodes=None,
        episodes_watched=3,
    )
    payload = public_leisure_client.get(f"/api/v1/leisure/entries/{entry.id}").json()
    assert payload["anime"]["last_watched_on"] == "2020-05-05"
