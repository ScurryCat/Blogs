"""相册管理 API（T06 执行清单第 3、4、7 条；05 §7、05 §11）。

全部通过**真实端点**走（Origin + CSRF + `If-Match`）。覆盖：

  - 匿名写被拒；
  - 创建总是草稿；slug 唯一且不可改；
  - 缺 `If-Match` 428、过期版本 412 且内容不变；
  - 发布门槛：没有照片 409、照片未 ready 409；
  - `photos` 完整替换（顺序、说明、拍摄时间一起换）；
  - 发布 / 撤回循环保留照片关系；
  - **单处撤回**端点：移除后媒体行仍在（不是删文件）；
  - **管理端「还有别处引用」提示的真实数据**（`media_reference_summary`）；
  - 软删除后管理列表与公开详情都不再出现。
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.modules.media.models import Media
from app.modules.projects import wiring as projects_wiring
from tests.core.t01_db import assert_error
from tests.projects.helpers import (
    ADMIN_ALBUMS_PATH,
    ALBUMS_PATH,
    admin_client,
    anonymous_client,
    attach_photos,
    make_album,
    make_media,
    make_project,
    photo_payload,
    t06_routers,
    unique_slug,
    write_headers,
)


def create_album(client, csrf, *, slug: str, title: str = "新相册", photos=None, **extra):
    body: dict[str, object] = {"slug": slug, "title": title}
    if photos is not None:
        body["photos"] = photos
    body.update(extra)
    return client.post(ADMIN_ALBUMS_PATH, json=body, headers=write_headers(csrf))


def publish(client, csrf, album_id: str, version: int):
    return client.post(
        f"{ADMIN_ALBUMS_PATH}/{album_id}/publish", headers=write_headers(csrf, version)
    )


def unpublish(client, csrf, album_id: str, version: int):
    return client.post(
        f"{ADMIN_ALBUMS_PATH}/{album_id}/unpublish", headers=write_headers(csrf, version)
    )


def test_anonymous_cannot_write(t06_session, t06_settings) -> None:
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        response = client.post(
            ADMIN_ALBUMS_PATH,
            json={"slug": unique_slug("album"), "title": "冒充"},
            headers={"Origin": "http://testserver"},
        )
        assert_error(response, status=401, code="UNAUTHORIZED")


def test_create_is_a_draft_with_etag(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        response = create_album(
            client,
            csrf,
            slug="tokyo-2026",
            title="东京街头",
            photos=photo_payload([media.id], taken_on=["2026-10-16"]),
            kind="photo",
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "draft"
        assert body["published_at"] is None
        assert body["position"] == 0
        assert response.headers["etag"] == '"1"'
        assert body["photos"][0]["taken_on"] == "2026-10-16"
        assert body["photos"][0]["media_status"] == "ready"


def test_default_position_increments_within_kind_and_explicit_position_wins(
    t06_session, t06_settings
) -> None:
    """不传 position 时按同类型最大值 +1；显式给 position 时以调用方为准。

    回归：`AlbumCreateIn.position` 有默认值 0，router 若用普通 `model_dump()` 就会把
    「没给」变成「要 0」，每本新相册都落在 0 上（真实浏览器里表现为管理列表顺序全乱）。
    这里两个分支都断言。
    """
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        first = create_album(client, csrf, slug="album-a", kind="photo").json()
        second = create_album(client, csrf, slug="album-b", kind="photo").json()
        screenshot = create_album(client, csrf, slug="album-c", kind="screenshot").json()
        assert (first["position"], second["position"], screenshot["position"]) == (0, 1, 0)

        explicit = create_album(client, csrf, slug="album-d", kind="photo", position=7).json()
        assert explicit["position"] == 7
        # 显式的 7 之后，下一个默认值跟着走。
        after = create_album(client, csrf, slug="album-e", kind="photo").json()
        assert after["position"] == 8


def test_slug_is_unique_and_immutable(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        slug = unique_slug("dup-album")
        assert create_album(client, csrf, slug=slug).status_code == 201
        duplicate = create_album(client, csrf, slug=slug, title="第二册")
        assert_error(duplicate, status=409, code="CONFLICT")

        album_id = create_album(client, csrf, slug=unique_slug("immutable")).json()["id"]
        renamed = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{album_id}",
            json={"slug": "new-album-slug"},
            headers=write_headers(csrf, 1),
        )
        assert_error(renamed, status=422, code="UNPROCESSABLE")


@pytest.mark.parametrize("slug", ["Upper", "中文", "with space", "a--b", "-x", "x_"])
def test_invalid_album_slug_is_rejected(t06_session, t06_settings, slug: str) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        response = create_album(client, csrf, slug=slug)
        assert_error(response, status=422, code="UNPROCESSABLE")


def test_missing_if_match_is_428(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        album_id = create_album(client, csrf, slug=unique_slug("nm")).json()["id"]
        response = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{album_id}",
            json={"title": "改标题"},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
        assert_error(response, status=428, code="PRECONDITION_REQUIRED")


def test_stale_version_is_412_and_content_is_untouched(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        album_id = create_album(client, csrf, slug=unique_slug("ver"), title="原标题").json()["id"]
        ok = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{album_id}",
            json={"title": "第一次修改"},
            headers=write_headers(csrf, 1),
        )
        assert ok.status_code == 200, ok.text
        stale = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{album_id}",
            json={"title": "基于旧版本"},
            headers=write_headers(csrf, 1),
        )
        assert_error(stale, status=412, code="VERSION_CONFLICT")
        assert client.get(f"{ADMIN_ALBUMS_PATH}/{album_id}").json()["title"] == "第一次修改"


def test_publish_requires_a_photo(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        album_id = create_album(client, csrf, slug=unique_slug("empty")).json()["id"]
        response = publish(client, csrf, album_id, 1)
        assert_error(response, status=409, code="CONFLICT")


def test_publish_rejects_unready_photo(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner, status="processing")
        created = create_album(
            client, csrf, slug=unique_slug("unready"), photos=photo_payload([media.id])
        )
        # 未 ready 的图连草稿都不接受。
        assert_error(created, status=409, code="CONFLICT")


def test_publish_unpublish_cycle_keeps_photos(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_album(
            client,
            csrf,
            slug="cycle-album",
            photos=photo_payload([media.id], taken_on=["2026-01-02"]),
        ).json()
        published = publish(client, csrf, created["id"], created["version"])
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"
        assert client.get(f"{ALBUMS_PATH}/cycle-album").status_code == 200

        retracted = unpublish(client, csrf, created["id"], published.json()["version"])
        assert retracted.status_code == 200, retracted.text
        assert retracted.json()["status"] == "draft"
        assert retracted.json()["published_at"] is None
        assert len(retracted.json()["photos"]) == 1, "撤回不应该丢掉照片关系"
        assert client.get(f"{ALBUMS_PATH}/cycle-album").status_code == 404


def test_photos_are_replaced_as_a_whole(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        first = make_media(t06_session, owner)
        second = make_media(t06_session, owner)
        created = create_album(
            client, csrf, slug=unique_slug("replace"), photos=photo_payload([first.id, second.id])
        ).json()
        assert [photo["position"] for photo in created["photos"]] == [0, 1]

        patched = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{created['id']}",
            json={
                "photos": [
                    {
                        "media_id": str(second.id),
                        "position": 0,
                        "alt": "重写的说明",
                        "caption": "换个顺序",
                        "taken_on": "2025-12-31",
                    }
                ]
            },
            headers=write_headers(csrf, created["version"]),
        )
        assert patched.status_code == 200, patched.text
        photos = patched.json()["photos"]
        assert len(photos) == 1
        assert photos[0]["media_id"] == str(second.id)
        assert photos[0]["alt"] == "重写的说明"
        assert photos[0]["caption"] == "换个顺序"
        assert photos[0]["taken_on"] == "2025-12-31"


def test_duplicate_media_or_position_is_409(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        first = make_media(t06_session, owner)
        second = make_media(t06_session, owner)
        duplicate_media = create_album(
            client,
            csrf,
            slug=unique_slug("dupmedia"),
            photos=[
                {"media_id": str(first.id), "position": 0, "alt": "一"},
                {"media_id": str(first.id), "position": 1, "alt": "二"},
            ],
        )
        assert_error(duplicate_media, status=409, code="CONFLICT")
        duplicate_position = create_album(
            client,
            csrf,
            slug=unique_slug("duppos"),
            photos=[
                {"media_id": str(first.id), "position": 0, "alt": "一"},
                {"media_id": str(second.id), "position": 0, "alt": "二"},
            ],
        )
        assert_error(duplicate_position, status=409, code="CONFLICT")


def test_blank_alt_is_rejected(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        response = create_album(
            client,
            csrf,
            slug=unique_slug("blankalt"),
            photos=[{"media_id": str(media.id), "position": 0, "alt": "   "}],
        )
        assert_error(response, status=422, code="UNPROCESSABLE")


def test_patch_with_photos_uses_router_dumped_payload(t06_session, t06_settings) -> None:
    """回归：`model_dump(exclude_unset=True)` 让 service 收到 dict 列表而不是模型实例。

    T03 的真实缺陷是这里直接 `photo.media_id` → AttributeError → 500。T06 用
    `_as_photo_input()` 归一化，本用例从 router 入口进来钉住它。
    """
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_album(client, csrf, slug=unique_slug("dumped")).json()
        patched = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{created['id']}",
            json={"photos": photo_payload([media.id])},
            headers=write_headers(csrf, created["version"]),
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["photos"][0]["media_id"] == str(media.id)


def test_remove_one_photo_keeps_the_media_row(t06_session, t06_settings) -> None:
    """单处撤回：只删相册这一处关系行，媒体行与文件不动（验收 3）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_album(
            client, csrf, slug=unique_slug("remove"), photos=photo_payload([media.id])
        ).json()
        response = client.delete(
            f"{ADMIN_ALBUMS_PATH}/{created['id']}/photos/{media.id}",
            headers=write_headers(csrf, created["version"]),
        )
        assert response.status_code == 204, response.text

        after = client.get(f"{ADMIN_ALBUMS_PATH}/{created['id']}").json()
        assert after["photos"] == []
        assert after["version"] == created["version"] + 1

    still_there = t06_session.execute(select(Media).where(Media.id == media.id)).scalars().first()
    assert still_there is not None
    assert still_there.deleted_at is None


def test_media_reference_summary_reports_other_public_places(
    t06_session, t06_settings
) -> None:
    """管理端「这张图还有别处公开引用」提示的数据来源（07 §5 末段 / 05 §11）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = make_album(t06_session, slug=unique_slug("refsum"), status="published")
        attach_photos(t06_session, album, [(media.id, 0, "同一张", None)])
        project = make_project(t06_session, slug=unique_slug("refproj"), status="published")
        from tests.projects.helpers import attach_images

        attach_images(t06_session, project, [(media.id, 0, "cover")])

        projects_wiring.register()
        from app.modules.gallery import wiring as gallery_wiring

        gallery_wiring.register()
        try:
            from app.modules.projects import service as projects_service

            summary = projects_service.media_reference_summary(t06_session, media.id)
            assert summary.get("projects") is True
            assert summary.get("gallery") is True
            assert csrf  # 站主会话仍开着（提示是管理端功能）
        finally:
            projects_wiring.unregister()
            gallery_wiring.unregister()


def test_soft_delete_hides_album_everywhere(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_album(
            client, csrf, slug="to-delete", photos=photo_payload([media.id])
        ).json()
        published = publish(client, csrf, created["id"], created["version"]).json()

        deleted = client.delete(
            f"{ADMIN_ALBUMS_PATH}/{created['id']}",
            headers=write_headers(csrf, published["version"]),
        )
        assert deleted.status_code == 204, deleted.text
        assert client.get(f"{ADMIN_ALBUMS_PATH}/{created['id']}").status_code == 404
        listed = client.get(ADMIN_ALBUMS_PATH).json()["items"]
        assert all(item["id"] != created["id"] for item in listed)

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        assert client.get(f"{ALBUMS_PATH}/to-delete").status_code == 404


def test_admin_listing_is_private_no_store_and_lists_drafts(
    t06_session, t06_settings
) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        create_album(client, csrf, slug="draft-album")
        response = client.get(ADMIN_ALBUMS_PATH)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "private, no-store"
        assert [item["slug"] for item in response.json()["items"]] == ["draft-album"]
        assert response.json()["items"][0]["status"] == "draft"


def test_admin_listing_orders_by_position(t06_session, t06_settings) -> None:
    """管理列表按站主维护的 position 排（前台的相册卡顺序由它决定）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        create_album(client, csrf, slug="third", position=2)
        create_album(client, csrf, slug="first", position=0)
        create_album(client, csrf, slug="second", position=1)
        listed = [item["slug"] for item in client.get(ADMIN_ALBUMS_PATH).json()["items"]]
        assert listed == ["first", "second", "third"]


def test_admin_listing_rejects_bad_filters(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, _csrf):
        assert_error(
            client.get(f"{ADMIN_ALBUMS_PATH}?status=archived"), status=422, code="UNPROCESSABLE"
        )
        assert_error(
            client.get(f"{ADMIN_ALBUMS_PATH}?kind=video"), status=422, code="UNPROCESSABLE"
        )


def test_non_uuid_album_id_is_a_404(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, _csrf):
        assert_error(
            client.get(f"{ADMIN_ALBUMS_PATH}/not-a-uuid"), status=404, code="NOT_FOUND"
        )


def test_unknown_media_in_album_is_409(t06_session, t06_settings) -> None:
    import uuid

    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _owner, csrf):
        response = create_album(
            client,
            csrf,
            slug=unique_slug("nomed"),
            photos=[{"media_id": str(uuid.uuid4()), "position": 0, "alt": "不存在"}],
        )
        assert_error(response, status=409, code="CONFLICT")
