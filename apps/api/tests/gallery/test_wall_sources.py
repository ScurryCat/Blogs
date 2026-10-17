"""N3 · 统一公开条件与全局照片墙去重（任务书 §4.1 / §4.6 / §8.2）。

覆盖：

  - 全局照片墙按 `media_id` 去重：查询 / 分页 / `total` 一致，不是前端临时去重；
  - 主要归属 = 公开且**来源有效**的相册中 `(position ASC, id ASC)` 最前者，
    相册排序相同时用 id 做稳定次级排序；相册自己保留排序与说明；
  - 相册列表 / 详情 / 封面 / 数量 / 年份筛选也只统计实际可展示的图片；
  - 动态来源不公开（草稿 / 撤回）不构成图库资格，也不影响媒体权限；
  - 媒体权限：图库是最后一个公开引用时撤回后匿名 404；还有独立来源时继续可读。
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timezone

from app.modules.gallery.models import album_media, album_media_sources
from tests.projects.helpers import (
    anonymous_client,
    attach_photos,
    make_admin,
    make_album,
    make_media,
    unique_slug,
)
from tests.moments.helpers import attach_images as attach_moment_images
from tests.moments.helpers import make_moment

UTC = timezone.utc

ALBUMS_PATH = "/api/v1/gallery/albums"
PHOTOS_PATH = "/api/v1/gallery/photos"
MEDIA_PATH = "/api/v1/media"


def _published_album(session, slug: str, **kwargs):
    return make_album(session, slug=slug, status="published", **kwargs)


def _public_routers():
    from app.modules.gallery.router import router as gallery_router
    from app.modules.media.router import router as media_router

    return (("gallery", gallery_router), ("media", media_router))


@contextmanager
def gallery_media_domain_registered():
    """只登记图库的媒体公开引用检查器（验证图库这一域自己的权限条件）。"""
    from app.modules.gallery import wiring as gallery_wiring
    from app.modules.media import public_refs as media_public_refs

    registered = False
    if "gallery" not in media_public_refs.registered():
        gallery_wiring.register()
        registered = True
    try:
        yield
    finally:
        if registered:
            gallery_wiring.unregister()


def _attach_photo_with_dynamic_source(session, album, media, *, moment, position: int = 0):
    """直接构造「只有某条动态来源」的相册显示关系（模拟 N3 之前不存在的状态）。"""
    from app.modules.media.models import STATUS_READY  # noqa: F401  —— 语义提示

    session.execute(
        album_media.insert().values(
            album_id=album.id,
            media_id=media.id,
            position=position,
            alt="动态收录的照片",
            caption="",
            taken_on=None,
        )
    )
    session.execute(
        album_media_sources.insert().values(
            album_id=album.id, media_id=media.id, moment_id=moment.id
        )
    )
    session.flush()


# --- 去重 / 主要归属 --------------------------------------------------------


def test_global_wall_dedupes_media_across_albums(t06_session, t06_settings) -> None:
    """同一张图属于两个公开相册：全局墙只出现一次，归属排序最前的相册。"""
    owner = make_admin(t06_session, username="dedupe-owner")
    media = make_media(t06_session, owner)
    first = _published_album(t06_session, "dedupe-first", title="第一册", position=0)
    second = _published_album(t06_session, "dedupe-second", title="第二册", position=1)
    attach_photos(t06_session, first, [(media.id, 0, "第一册里的说明", date(2026, 5, 1))])
    attach_photos(t06_session, second, [(media.id, 0, "第二册里的说明", None)])

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        body = client.get(f"{PHOTOS_PATH}?limit=10").json()
        assert body["total"] == 1, "同一 media 在全局墙只能算一次"
        assert len(body["items"]) == 1
        item = body["items"][0]
        assert item["photo"]["media_id"] == str(media.id)
        assert item["photo"]["caption"] == "第一册里的说明"
        assert item["album"]["slug"] == first.slug, "主要归属 = 排序最前的公开有效相册"

        # 进入具体相册：各自保留自己的排序 / 说明，不做跨相册去重。
        first_body = client.get(f"{PHOTOS_PATH}?scope=album&album={first.slug}").json()
        second_body = client.get(f"{PHOTOS_PATH}?scope=album&album={second.slug}").json()
        assert [item["photo"]["caption"] for item in first_body["items"]] == ["第一册里的说明"]
        assert [item["photo"]["caption"] for item in second_body["items"]] == ["第二册里的说明"]


def test_global_wall_dedupe_is_consistent_with_pagination_and_total(
    t06_session, t06_settings
) -> None:
    owner = make_admin(t06_session, username="dedupe-page-owner")
    shared = make_media(t06_session, owner)
    only_first = make_media(t06_session, owner)
    only_second = make_media(t06_session, owner)
    first = _published_album(t06_session, "page-first", position=0)
    second = _published_album(t06_session, "page-second", position=1)
    attach_photos(
        t06_session,
        first,
        [(shared.id, 0, "共享图", date(2026, 3, 1)), (only_first.id, 1, "只在一册", None)],
    )
    attach_photos(t06_session, second, [(shared.id, 0, "共享图", None), (only_second.id, 1, "只在二册", None)])

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        seen: list[str] = []
        cursor = None
        for _ in range(10):
            query = "?limit=1" + (f"&cursor={cursor}" if cursor else "")
            body = client.get(f"{PHOTOS_PATH}{query}").json()
            assert body["total"] == 3, "total 必须按去重后的媒体数计算，且每页稳定"
            seen.extend(item["photo"]["media_id"] for item in body["items"])
            cursor = body["next_cursor"]
            if not cursor:
                break
        assert cursor is None
        assert len(seen) == len(set(seen)) == 3, "翻页不能把同一张图重复返回"


def test_primary_album_skips_albums_without_public_source(
    t06_session, t06_settings
) -> None:
    """主要归属必须是「公开且来源有效」的相册：只有草稿动态来源的相册不参与。"""
    owner = make_admin(t06_session, username="primary-owner")
    media = make_media(t06_session, owner)
    hidden = _published_album(t06_session, "primary-hidden", position=0)
    visible = _published_album(t06_session, "primary-visible", position=1)
    draft_moment = make_moment(t06_session, owner, status="draft")
    attach_moment_images(t06_session, draft_moment, [(media.id, 0, "草稿动态里的图")])
    _attach_photo_with_dynamic_source(t06_session, hidden, media, moment=draft_moment)
    attach_photos(t06_session, visible, [(media.id, 0, "有效来源", None)])

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        body = client.get(f"{PHOTOS_PATH}?limit=10").json()
        assert body["total"] == 1
        assert body["items"][0]["album"]["slug"] == visible.slug, (
            "只有草稿动态来源的相册没有公开资格，不能当主要归属"
        )

        # 相册自己的公开详情也不展示这张图。
        hidden_detail = client.get(f"{ALBUMS_PATH}/{hidden.slug}").json()
        assert hidden_detail["photos"] == []
        assert hidden_detail["photo_count"] == 0


def test_primary_album_switches_when_earlier_album_is_retracted(
    t06_session, t06_settings
) -> None:
    """相册撤回后，同一张图的主要归属立即回退到下一个公开有效相册。"""
    owner = make_admin(t06_session, username="switch-owner")
    media = make_media(t06_session, owner)
    first = _published_album(t06_session, "switch-first", position=0)
    second = _published_album(t06_session, "switch-second", position=1)
    attach_photos(t06_session, first, [(media.id, 0, "一册", None)])
    attach_photos(t06_session, second, [(media.id, 0, "二册", None)])

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        assert client.get(f"{PHOTOS_PATH}?limit=10").json()["items"][0]["album"]["slug"] == first.slug

    from app.core.db import utcnow

    first.status = "draft"
    first.published_at = None
    first.deleted_at = None
    first.updated_at = utcnow()
    t06_session.flush()

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        body = client.get(f"{PHOTOS_PATH}?limit=10").json()
        assert body["total"] == 1
        assert body["items"][0]["album"]["slug"] == second.slug


def test_kind_filter_uses_filtered_album_as_primary(t06_session, t06_settings) -> None:
    """筛「游戏截图」时，同时属于摄影相册的图会归到截图相册，而不是被摄影相册抢走。"""
    owner = make_admin(t06_session, username="kind-dedupe-owner")
    media = make_media(t06_session, owner)
    photo_album = _published_album(t06_session, "kind-photo", kind="photo", position=0)
    shot_album = _published_album(t06_session, "kind-shot", kind="screenshot", position=1)
    attach_photos(t06_session, photo_album, [(media.id, 0, "摄影", None)])
    attach_photos(t06_session, shot_album, [(media.id, 0, "截图", None)])

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        screenshots = client.get(f"{PHOTOS_PATH}?limit=10&kind=screenshot").json()
        assert screenshots["total"] == 1
        assert screenshots["items"][0]["album"]["slug"] == shot_album.slug
        photos = client.get(f"{PHOTOS_PATH}?limit=10&kind=photo").json()
        assert photos["total"] == 1
        assert photos["items"][0]["album"]["slug"] == photo_album.slug


# --- 年份 / 数量 / 封面 ----------------------------------------------------


def test_years_come_from_actually_visible_photos(t06_session, t06_settings) -> None:
    owner = make_admin(t06_session, username="years-owner")
    visible = make_media(t06_session, owner)
    hidden = make_media(t06_session, owner)
    album = _published_album(t06_session, "years-visible")
    attach_photos(t06_session, album, [(visible.id, 0, "2026", date(2026, 4, 1))])
    draft_moment = make_moment(t06_session, owner, status="draft")
    attach_moment_images(t06_session, draft_moment, [(hidden.id, 0, "草稿")])
    t06_session.execute(
        album_media.insert().values(
            album_id=album.id,
            media_id=hidden.id,
            position=1,
            alt="隐藏的图",
            caption="",
            taken_on=date(2024, 1, 1),
        )
    )
    t06_session.execute(
        album_media_sources.insert().values(
            album_id=album.id, media_id=hidden.id, moment_id=draft_moment.id
        )
    )
    t06_session.flush()

    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        assert client.get(f"{PHOTOS_PATH}/years").json() == [2026], (
            "年份只能来自实际可展示的图片；不被公开来源覆盖的 2024 不应出现"
        )
        body = client.get(f"{PHOTOS_PATH}?limit=10").json()
        assert body["total"] == 1
        detail = client.get(f"{ALBUMS_PATH}/{album.slug}").json()
        assert detail["photo_count"] == 1
        assert detail["cover"]["media_id"] == str(visible.id)


# --- 媒体权限 --------------------------------------------------------------


def test_gallery_domain_media_permission_follows_public_source(
    t06_session, t06_settings
) -> None:
    """图库域自己的媒体权限：公开来源在 → 可读；相册撤回 → 404。"""
    owner = make_admin(t06_session, username="perm-owner")
    media = make_media(t06_session, owner, root=t06_settings.media_root_path)
    album = _published_album(t06_session, "perm-album")
    attach_photos(t06_session, album, [(media.id, 0, "权限", None)])

    with gallery_media_domain_registered():
        with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
            assert client.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
    # 未登记 = 默认拒绝（安全默认值）
    with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
        assert client.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 404

    from app.core.db import utcnow

    album.status = "draft"
    album.published_at = None
    album.updated_at = utcnow()
    t06_session.flush()
    with gallery_media_domain_registered():
        with anonymous_client(t06_settings, t06_session, *_public_routers()) as client:
            assert client.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 404
