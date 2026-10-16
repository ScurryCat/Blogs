"""相册 / 照片墙公开 API（T06 执行清单第 3、4 条；验收 2 / 4）。

覆盖：

  - 相册列表 / 详情只在公开时可见；草稿 / 撤回 / 软删除 / 未到发布时间真 404；
  - 相册内的照片顺序 = 手工 `position`，说明与拍摄时间按上下文各自保存；
  - 照片墙两个 scope 的排序语义（跨相册按拍摄日期，单相册按手工顺序）；
  - `taken_on` 为空的照片排在**最后**（不知道日期不该假装最新），并且不参与年份筛选；
  - 年份 / 月份 / 类型筛选、分页游标与筛选指纹；
  - 参数错误（scope 不合法、month 没给 year、非法 kind）→ 422，不静默忽略；
  - 公开响应里没有草稿字段，也没有原图变体。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from tests.core.t01_db import assert_error
from tests.projects.helpers import (
    ALBUMS_PATH,
    PHOTOS_PATH,
    admin_client,
    anonymous_client,
    attach_photos,
    make_admin,
    make_album,
    make_media,
    make_project,
    t06_routers,
    unique_slug,
)

UTC = timezone.utc


def _published_album(session, slug: str, **kwargs):
    return make_album(session, slug=slug, status="published", **kwargs)


# --- 相册列表 / 详情 -------------------------------------------------------


def test_published_album_is_readable_by_anonymous(t06_session, t06_settings) -> None:
    owner = make_admin(t06_session, username="gallery-owner")
    media = make_media(t06_session, owner)
    album = _published_album(t06_session, unique_slug("photos"), title="东京街头")
    attach_photos(t06_session, album, [(media.id, 0, "午后", date(2026, 10, 16))])

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        listing = client.get(ALBUMS_PATH)
        assert listing.status_code == 200, listing.text
        items = listing.json()["items"]
        assert [item["slug"] for item in items] == [album.slug]
        card = items[0]
        assert card["title"] == "东京街头"
        assert card["kind"] == "photo"
        assert card["kind_label"] == "摄影"
        assert card["photo_count"] == 1
        assert card["cover"]["media_id"] == str(media.id)
        assert "status" not in card and "version" not in card and "deleted_at" not in card

        detail = client.get(f"{ALBUMS_PATH}/{album.slug}")
        assert detail.status_code == 200, detail.text
        photos = detail.json()["photos"]
        assert len(photos) == 1
        assert photos[0]["caption"] == "午后"
        assert photos[0]["taken_on"] == "2026-10-16"
        assert photos[0]["alt"] == "照片 0"
        assert photos[0]["width"] == 800 and photos[0]["height"] == 600
        assert all(variant["name"] != "original" for variant in photos[0]["variants"])


@pytest.mark.parametrize("state", ["draft", "retracted", "deleted", "future"])
def test_non_public_albums_are_invisible(t06_session, t06_settings, state: str) -> None:
    slug = unique_slug("hidden-album")
    if state == "draft":
        make_album(t06_session, slug=slug, title="草稿相册", status="draft")
    elif state == "retracted":
        make_album(
            t06_session,
            slug=slug,
            title="已撤回相册",
            status="draft",
            published_at=datetime.now(UTC) - timedelta(minutes=5),
        )
    elif state == "deleted":
        make_album(
            t06_session,
            slug=slug,
            title="已删除相册",
            status="published",
            deleted_at=datetime.now(UTC),
        )
    else:
        make_album(
            t06_session,
            slug=slug,
            title="未来的相册",
            status="published",
            published_at=datetime.now(UTC) + timedelta(days=1),
        )

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        listing = client.get(ALBUMS_PATH)
        assert listing.status_code == 200
        assert listing.json()["items"] == []
        detail = client.get(f"{ALBUMS_PATH}/{slug}")
        assert_error(detail, status=404, code="NOT_FOUND")
        assert "草稿相册" not in detail.text and "已撤回相册" not in detail.text


def test_photo_order_follows_manual_position(t06_session, t06_settings) -> None:
    """相册内顺序 = 站主排的 `position`，不是入库时间（执行清单第 3 条）。"""
    owner = make_admin(t06_session, username="order-owner")
    media = [make_media(t06_session, owner) for _ in range(3)]
    album = _published_album(t06_session, unique_slug("order"))
    # 故意乱序插入，position 才是真相。
    attach_photos(
        t06_session,
        album,
        [
            (media[2].id, 2, "第三张", None),
            (media[0].id, 0, "第一张", None),
            (media[1].id, 1, "第二张", None),
        ],
    )
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        detail = client.get(f"{ALBUMS_PATH}/{album.slug}")
        assert [photo["caption"] for photo in detail.json()["photos"]] == [
            "第一张",
            "第二张",
            "第三张",
        ]


def test_caption_can_differ_per_context(t06_session, t06_settings) -> None:
    """同一张图在相册与作品里的说明各自独立，而文件只有一套（验收 2）。"""
    from app.modules.projects.models import project_media

    owner = make_admin(t06_session, username="ctx-owner")
    media = make_media(t06_session, owner)
    album = _published_album(t06_session, unique_slug("ctx-album"))
    attach_photos(t06_session, album, [(media.id, 0, "相册里的说明：旅行", None)])
    project = make_project(t06_session, slug=unique_slug("ctx-project"), status="published")
    t06_session.execute(
        project_media.insert().values(
            project_id=project.id,
            media_id=media.id,
            position=0,
            kind="cover",
            alt="作品截图",
            caption="作品里的说明：首页",
            taken_on=None,
        )
    )
    t06_session.flush()

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        album_photo = client.get(f"{ALBUMS_PATH}/{album.slug}").json()["photos"][0]
        project_image = client.get(f"/api/v1/projects/{project.slug}").json()["images"][0]
        assert album_photo["caption"] == "相册里的说明：旅行"
        assert project_image["caption"] == "作品里的说明：首页"
        # 文件只有一套：两个上下文引用的是同一个 media_id（不重复上传）。
        assert album_photo["media_id"] == project_image["media_id"] == str(media.id)

    # 媒体行只有一条：相册与作品引用的是同一行，而不是各插一份。
    from sqlalchemy import func, select

    from app.modules.media.models import Media

    count = t06_session.execute(
        select(func.count()).select_from(Media).where(Media.id == media.id)
    ).scalars().one()
    assert count == 1


def test_album_kind_filter(t06_session, t06_settings) -> None:
    owner = make_admin(t06_session, username="kind-owner")
    photo_album = _published_album(t06_session, unique_slug("p"), title="摄影集", kind="photo")
    shot_album = _published_album(
        t06_session, unique_slug("s"), title="游戏截图", kind="screenshot"
    )
    assert owner and photo_album and shot_album
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        only_shots = client.get(f"{ALBUMS_PATH}?kind=screenshot")
        assert [item["slug"] for item in only_shots.json()["items"]] == [shot_album.slug]
        bogus = client.get(f"{ALBUMS_PATH}?kind=video")
        assert_error(bogus, status=422, code="UNPROCESSABLE")


# --- 照片墙 ---------------------------------------------------------------


def _wall_fixture(session):
    """三个相册、四张照片（其中一张没有拍摄日期），用于照片墙的排序与筛选。"""
    owner = make_admin(session, username="wall-owner")
    media = [make_media(session, owner) for _ in range(4)]
    first = _published_album(session, "wall-first", title="第一册", position=0)
    second = _published_album(
        session, "wall-second", title="第二册", position=1, kind="screenshot"
    )
    attach_photos(
        session,
        first,
        [
            (media[0].id, 0, "2026 年拍的", date(2026, 10, 1)),
            (media[1].id, 1, "2025 年拍的", date(2025, 5, 2)),
        ],
    )
    attach_photos(
        session,
        second,
        [
            (media[2].id, 0, "2026 年 11 月", date(2026, 11, 3)),
            (media[3].id, 1, "没有拍摄时间", None),
        ],
    )
    return owner, media, first, second


def test_wall_global_scope_sorts_by_taken_on_desc_with_nulls_last(
    t06_session, t06_settings
) -> None:
    _wall_fixture(t06_session)
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        response = client.get(f"{PHOTOS_PATH}?scope=global&limit=10")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 4
        captions = [item["photo"]["caption"] for item in body["items"]]
        # 2026-11 → 2026-10 → 2025-05 → 没有日期（最后）。
        assert captions == ["2026 年 11 月", "2026 年拍的", "2025 年拍的", "没有拍摄时间"]
        # 每一项都带它属于哪个相册（前端据此渲染分组标题）。
        assert body["items"][0]["album"]["slug"] == "wall-second"
        assert body["items"][0]["album"]["title"] == "第二册"
        assert body["items"][0]["album"]["kind_label"] == "游戏截图"


def test_wall_album_scope_uses_manual_order(t06_session, t06_settings) -> None:
    _wall_fixture(t06_session)
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        response = client.get(f"{PHOTOS_PATH}?scope=album&album=wall-first&limit=10")
        assert response.status_code == 200, response.text
        captions = [item["photo"]["caption"] for item in response.json()["items"]]
        assert captions == ["2026 年拍的", "2025 年拍的"]


def test_wall_year_and_month_filter(t06_session, t06_settings) -> None:
    _wall_fixture(t06_session)
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        year = client.get(f"{PHOTOS_PATH}?year=2026&limit=10").json()
        assert [item["photo"]["caption"] for item in year["items"]] == [
            "2026 年 11 月",
            "2026 年拍的",
        ]
        # 只有 2026-10 那一张。
        october = client.get(f"{PHOTOS_PATH}?year=2026&month=10&limit=10").json()
        assert [item["photo"]["caption"] for item in october["items"]] == ["2026 年拍的"]
        assert october["total"] == 1
        # 没有拍摄时间的照片不进年份筛选（不生成一个点了没结果的「未知年份」）。
        years = client.get(f"{PHOTOS_PATH}/years").json()
        assert years == [2026, 2025]


def test_wall_pagination_is_stable_across_pages(t06_session, t06_settings) -> None:
    _wall_fixture(t06_session)
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        seen: list[str] = []
        cursor = None
        for _ in range(5):
            query = "?limit=1" + (f"&cursor={cursor}" if cursor else "")
            body = client.get(f"{PHOTOS_PATH}{query}").json()
            seen.extend(item["photo"]["caption"] for item in body["items"])
            cursor = body["next_cursor"]
            if not cursor:
                break
    assert seen == ["2026 年 11 月", "2026 年拍的", "2025 年拍的", "没有拍摄时间"]
    assert len(set(seen)) == 4


def test_wall_cursor_is_bound_to_the_current_filters(t06_session, t06_settings) -> None:
    _wall_fixture(t06_session)
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        first = client.get(f"{PHOTOS_PATH}?limit=1&kind=photo").json()
        cursor = first["next_cursor"]
        assert cursor
        same = client.get(f"{PHOTOS_PATH}?limit=1&kind=photo&cursor={cursor}")
        assert same.status_code == 200, same.text
        switched = client.get(f"{PHOTOS_PATH}?limit=1&kind=screenshot&cursor={cursor}")
        assert_error(switched, status=400, code="VALIDATION_FAILED")
        # 两个 scope 的游标不能互换（排序语义不同）。
        album_cursor = client.get(f"{PHOTOS_PATH}?scope=album&album=wall-first&limit=1").json()
        assert album_cursor["next_cursor"]
        crossed = client.get(
            f"{PHOTOS_PATH}?scope=album&album=wall-first&limit=1&cursor={cursor}"
        )
        assert_error(crossed, status=400, code="VALIDATION_FAILED")


@pytest.mark.parametrize(
    "query,field",
    [
        ("scope=album", "album"),
        ("month=10", "year"),
        ("year=1800", "year"),
        ("month=13&year=2026", "month"),
        ("scope=everything", "scope"),
        ("kind=video", "kind"),
    ],
)
def test_wall_rejects_bad_filters(t06_session, t06_settings, query: str, field: str) -> None:
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        response = client.get(f"{PHOTOS_PATH}?{query}")
        assert response.status_code == 422, response.text
        payload = assert_error(response, status=422, code="UNPROCESSABLE")
        # 有的边界在 pydantic 的 query 校验里（字段名带 `query.` 前缀），
        # 有的在 router 的显式检查里（裸字段名）。两者都要求**指出是哪个字段**。
        keys = set(payload["error"]["fields"])
        assert any(key == field or key.endswith(f".{field}") for key in keys), payload


def test_wall_hides_photos_of_draft_albums(t06_session, t06_settings) -> None:
    owner = make_admin(t06_session, username="draft-wall-owner")
    media = make_media(t06_session, owner)
    draft = make_album(t06_session, slug="draft-wall", status="draft")
    attach_photos(t06_session, draft, [(media.id, 0, "草稿里的照片", date(2026, 1, 1))])
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        body = client.get(f"{PHOTOS_PATH}?limit=10").json()
        assert body["items"] == []
        assert body["total"] == 0
        assert client.get(f"{ALBUMS_PATH}/draft-wall").status_code == 404


def test_public_endpoints_are_no_store(t06_session, t06_settings) -> None:
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        for path in (ALBUMS_PATH, PHOTOS_PATH, f"{PHOTOS_PATH}/years"):
            response = client.get(path)
            assert response.status_code == 200, path
            assert response.headers["cache-control"] == "no-store", path


def test_unknown_album_slug_is_a_real_404(t06_session, t06_settings) -> None:
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        assert_error(
            client.get(f"{ALBUMS_PATH}/nope-nope"), status=404, code="NOT_FOUND"
        )


def test_album_detail_hides_not_ready_photos_but_admin_sees_them(
    t06_session, t06_settings
) -> None:
    """未 ready 的图片不出现在公开相册里，但**管理视图如实显示**（表单要能提示）。"""
    owner = make_admin(t06_session, username="unready-owner")
    good = make_media(t06_session, owner)
    bad = make_media(t06_session, owner, status="processing")
    album = _published_album(t06_session, unique_slug("unready"), title="有未就绪的相册")
    attach_photos(t06_session, album, [(good.id, 0, "好图", None), (bad.id, 1, "未就绪", None)])

    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        body = client.get(f"{ALBUMS_PATH}/{album.slug}").json()
        assert [photo["media_id"] for photo in body["photos"]] == [str(good.id)]
        assert body["photo_count"] == 1

    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, _csrf):
        admin_body = client.get(f"/api/v1/admin/albums/{album.id}")
        assert admin_body.status_code == 200, admin_body.text
        statuses = {photo["media_id"]: photo["media_status"] for photo in admin_body.json()["photos"]}
        assert statuses[str(good.id)] == "ready"
        assert statuses[str(bad.id)] == "processing"
