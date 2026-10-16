"""作品 / 相册图片的公开可见性与共享注册表登记（05 §8 / §11，07 §5，验收 2 / 3）。

这是 T06 最容易被漏掉的一环：**图片的公开引用检查默认拒绝**，
`projects.wiring.register()` / `gallery.wiring.register()` 没被登记时，
一件已公开的作品对匿名访客就是「全是坏图」。因此这里把两种状态都真的跑一遍：

  - 未登记 → 匿名读图片 404（安全默认值生效，不是「碰巧能读」）；
  - 只登记作品域 → 只有作品的图可读，相册的图仍 404（两个域是**独立**开关）；
  - 登记后 → 已公开作品 / 已公开相册的图片可读，草稿 / 撤回 / 已软删除的仍是 404；
  - **一张图多处引用**：动态 + 相册 + 作品同时引用时，
    撤回其中一处仍可读；**全部**撤回后匿名才 404（验收 3）；
  - 原图永远只给站主（05 §8）；
  - 私密引用不会让公开引用失效，也不会让不可读的媒体变可读。
"""

from __future__ import annotations

import uuid

from app.modules.gallery import wiring as gallery_wiring
from app.modules.gallery.router import router as gallery_router
from app.modules.media import public_refs as media_public_refs
from app.modules.media.router import router as media_router
from app.modules.moments import wiring as moments_wiring
from app.modules.moments.models import STATUS_PUBLISHED as MOMENT_PUBLISHED
from app.modules.moments.router import router as moments_router
from app.modules.posts import public_refs as posts_public_refs
from app.modules.projects import wiring as projects_wiring
from app.modules.projects.router import router as projects_router
from tests.core.t01_db import assert_error
from tests.projects.helpers import (
    admin_client,
    anonymous_client,
    attach_images,
    attach_photos,
    make_album,
    make_media,
    make_project,
    t06_routers,
    unique_slug,
)
from tests.support.t06_shared import make_admin


def _media_variant_url(media_id, name: str = "w320.webp") -> str:
    return f"/api/v1/media/{media_id}/{name}"


MEDIA_AND_MOMENTS = (
    ("media", media_router),
    ("moments", moments_router),
    ("projects", projects_router),
    ("gallery", gallery_router),
)


def _owner(session):
    return make_admin(session, username=f"owner{uuid.uuid4().hex[:8]}")


# --- 注册表本身 -----------------------------------------------------------


def test_checkers_are_not_registered_by_default(t06_settings, t06_session) -> None:
    """安全默认值：没有登记时匿名读不到任何媒体（不是「默认通过」）。"""
    assert "projects" not in media_public_refs.registered()
    assert "gallery" not in media_public_refs.registered()


def test_two_domains_are_independent_switches(t06_settings, t06_session) -> None:
    """作品域与相册域各自登记：只登记一个不会顺带打开另一个的权限。"""
    projects_wiring.register()
    try:
        assert "projects" in media_public_refs.registered()
        assert "gallery" not in media_public_refs.registered()
    finally:
        projects_wiring.unregister()
    gallery_wiring.register()
    try:
        assert "gallery" in media_public_refs.registered()
        assert "projects" not in media_public_refs.registered()
    finally:
        gallery_wiring.unregister()


def test_double_register_is_rejected(t06_settings, t06_session) -> None:
    """重复登记立即报错：静默覆盖会悄悄改变权限。"""
    import pytest

    projects_wiring.register()
    try:
        with pytest.raises(media_public_refs.DuplicateCheckerError):
            projects_wiring.register()
    finally:
        projects_wiring.unregister()


def test_declared_checker_names_match_delivery(t06_settings, t06_session) -> None:
    from app.modules.gallery import public_refs as gallery_refs
    from app.modules.projects import public_refs as project_refs

    assert project_refs.CHECKER_NAME == "projects"
    assert gallery_refs.CHECKER_NAME == "gallery"


# --- 未登记 = 默认拒绝 ----------------------------------------------------


def test_published_project_image_is_404_before_registration(t06_settings, t06_session) -> None:
    owner = _owner(t06_session)
    media = make_media(t06_session, owner, root=t06_settings.media_root_path)
    project = make_project(t06_session, slug=unique_slug(), status="published")
    attach_images(t06_session, project, [(media.id, 0, "cover")])

    with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
        assert_error(client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND")

        projects_wiring.register()
        try:
            response = client.get(_media_variant_url(media.id))
            assert response.status_code == 200, response.text
            assert response.headers["Cache-Control"] == "private, no-store"
            assert response.headers["X-Content-Type-Options"] == "nosniff"
            # 原图永远只给站主，即便作品已公开（05 §8）。
            assert_error(
                client.get(_media_variant_url(media.id, "original")),
                status=404,
                code="NOT_FOUND",
            )
        finally:
            projects_wiring.unregister()


def test_owner_can_still_read_original(t06_settings, t06_session) -> None:
    """站主能读原图；匿名不能 —— 两者在同一个端点上分开。"""
    with admin_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        project = make_project(t06_session, slug=unique_slug(), status="published")
        attach_images(t06_session, project, [(media.id, 0, "cover")])
        response = client.get(_media_variant_url(media.id, "original"))
        assert response.status_code == 200, response.text
        assert csrf


def test_draft_project_image_stays_private(t06_settings, t06_session) -> None:
    owner = _owner(t06_session)
    media = make_media(t06_session, owner, root=t06_settings.media_root_path)
    project = make_project(t06_session, slug=unique_slug(), status="draft")
    attach_images(t06_session, project, [(media.id, 0, "cover")])

    projects_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert_error(client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND")
    finally:
        projects_wiring.unregister()


def test_retracted_and_deleted_projects_stop_referencing(t06_settings, t06_session) -> None:
    from datetime import datetime, timezone

    owner = _owner(t06_session)
    retracted = make_media(t06_session, owner, root=t06_settings.media_root_path)
    deleted = make_media(t06_session, owner, root=t06_settings.media_root_path)
    first = make_project(t06_session, slug=unique_slug("r"), status="draft")
    second = make_project(
        t06_session,
        slug=unique_slug("d"),
        status="published",
        deleted_at=datetime.now(timezone.utc),
    )
    attach_images(t06_session, first, [(retracted.id, 0, "cover")])
    attach_images(t06_session, second, [(deleted.id, 0, "cover")])

    projects_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert_error(client.get(_media_variant_url(retracted.id)), status=404, code="NOT_FOUND")
            assert_error(client.get(_media_variant_url(deleted.id)), status=404, code="NOT_FOUND")
    finally:
        projects_wiring.unregister()


# --- 一图多引用（验收 2 / 3）---------------------------------------------


def _readable(client, media_id) -> int:
    return client.get(_media_variant_url(media_id)).status_code


def test_one_image_in_moment_album_and_project(t06_settings, t06_session) -> None:
    """同一张图被动态 / 相册 / 作品同时引用：撤回一处不影响其它（验收 2、3）。"""
    from app.modules.moments.models import Moment, moment_media

    owner = _owner(t06_session)
    media = make_media(t06_session, owner, root=t06_settings.media_root_path)

    moment = Moment(author_id=owner.id, text="同一张图", status=MOMENT_PUBLISHED)
    moment.published_at = moment.created_at
    t06_session.add(moment)
    t06_session.flush()
    t06_session.execute(
        moment_media.insert().values(moment_id=moment.id, media_id=media.id, position=0, alt="图")
    )
    album = make_album(t06_session, slug=unique_slug("album"), status="published")
    attach_photos(t06_session, album, [(media.id, 0, "相册说明", None)])
    project = make_project(t06_session, slug=unique_slug("proj"), status="published")
    attach_images(t06_session, project, [(media.id, 0, "cover")])
    t06_session.flush()

    projects_wiring.register()
    gallery_wiring.register()
    moments_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert _readable(client, media.id) == 200

            # 撤回动态 → 相册与作品还在，仍然可读。
            moment.status = "draft"
            t06_session.flush()
            assert _readable(client, media.id) == 200, "撤回一处不应让仍在别处公开的图失效"

            # 再撤回相册 → 作品还在。
            album.status = "draft"
            t06_session.flush()
            assert _readable(client, media.id) == 200

            # 最后撤回作品 → 全部撤回，匿名才 404。
            project.status = "draft"
            t06_session.flush()
            assert_error(client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND")

            # 恢复作品 → 又可读（撤回是可逆的状态变化，不销毁引用）。
            project.status = "published"
            t06_session.flush()
            assert _readable(client, media.id) == 200
    finally:
        projects_wiring.unregister()
        gallery_wiring.unregister()
        moments_wiring.unregister()


def test_private_reference_does_not_revoke_a_public_one(t06_settings, t06_session) -> None:
    """私密引用不会推翻另一个公开引用（05 §11）。"""
    owner = _owner(t06_session)
    media = make_media(t06_session, owner, root=t06_settings.media_root_path)
    public_project = make_project(t06_session, slug=unique_slug("pub"), status="published")
    attach_images(t06_session, public_project, [(media.id, 0, "cover")])
    draft_album = make_album(t06_session, slug=unique_slug("draft"), status="draft")
    attach_photos(t06_session, draft_album, [(media.id, 0, "草稿相册里的同一张", None)])

    projects_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            # 相册域没登记（草稿相册本来也不构成引用）：作品让它可读。
            assert _readable(client, media.id) == 200
    finally:
        projects_wiring.unregister()


def test_unreferenced_and_unready_media_stay_private(t06_settings, t06_session) -> None:
    """没被任何公开内容引用 / 未 ready 的图，即使作品已公开也不可读。"""
    owner = _owner(t06_session)
    loose = make_media(t06_session, owner, root=t06_settings.media_root_path)
    processing = make_media(
        t06_session, owner, root=t06_settings.media_root_path, status="processing"
    )
    project = make_project(t06_session, slug=unique_slug(), status="published")
    # 直接挂关系（绕过 service 的 ready 校验），验证**读取时**仍然拒绝。
    attach_images(t06_session, project, [(processing.id, 0, "cover")])

    projects_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert_error(client.get(_media_variant_url(loose.id)), status=404, code="NOT_FOUND")
            assert_error(
                client.get(_media_variant_url(processing.id)), status=404, code="NOT_FOUND"
            )
    finally:
        projects_wiring.unregister()


# --- 相册域单独 -----------------------------------------------------------


def test_album_image_requires_the_gallery_checker(t06_settings, t06_session) -> None:
    owner = _owner(t06_session)
    media = make_media(t06_session, owner, root=t06_settings.media_root_path)
    album = make_album(t06_session, slug=unique_slug("solo"), status="published")
    attach_photos(t06_session, album, [(media.id, 0, "说明", None)])

    # 登记作品域不够：相册的图仍然 404。
    projects_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert_error(client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND")
    finally:
        projects_wiring.unregister()

    gallery_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert _readable(client, media.id) == 200
    finally:
        gallery_wiring.unregister()


def test_removing_one_album_reference_keeps_the_image_readable(
    t06_settings, t06_session
) -> None:
    """`DELETE /admin/albums/{id}/photos/{media_id}` 只移除**那一处**引用（验收 3）。

    用真实的 HTTP 端点走一遍：移除后相册里没有这张图、`photo_count` 归零，
    但**匿名读图仍然成功** —— 因为作品还在引用同一张 media。
    媒体行与文件都没被动过。
    """
    from app.modules.media.models import Media
    from sqlalchemy import select

    from tests.projects.helpers import ADMIN_ALBUMS_PATH, write_headers

    with admin_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = make_album(t06_session, slug=unique_slug("mix"), status="published")
        attach_photos(t06_session, album, [(media.id, 0, "相册里的说明", None)])
        project = make_project(t06_session, slug=unique_slug("mixp"), status="published")
        attach_images(t06_session, project, [(media.id, 0, "cover")])

        detail = client.get(f"/api/v1/gallery/albums/{album.slug}")
        assert detail.status_code == 200
        assert [photo["media_id"] for photo in detail.json()["photos"]] == [str(media.id)]

        removed = client.delete(
            f"{ADMIN_ALBUMS_PATH}/{album.id}/photos/{media.id}",
            headers=write_headers(csrf, album.version),
        )
        assert removed.status_code == 204, removed.text

        after = client.get(f"/api/v1/gallery/albums/{album.slug}")
        assert after.json()["photos"] == []
        assert after.json()["photo_count"] == 0

    # 媒体行仍在（软删除的是「这一处引用」，不是文件）。
    still_there = t06_session.execute(
        select(Media).where(Media.id == media.id)
    ).scalars().first()
    assert still_there is not None
    assert still_there.deleted_at is None

    projects_wiring.register()
    try:
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert _readable(client, media.id) == 200, (
                "相册里移除了一张仍被公开作品引用的图 —— 匿名读图不该因此变 404"
            )
    finally:
        projects_wiring.unregister()


def test_posts_checker_still_works_alongside_t06(t06_settings, t06_session) -> None:
    """T06 的登记不干扰文章域：三个检查器可以同时存在，取「或」。"""
    posts_public_refs.register()
    projects_wiring.register()
    gallery_wiring.register()
    try:
        assert set(media_public_refs.registered()) >= {"posts", "projects", "gallery"}
        # 未关联媒体：三者都说不，结论仍然是不可读。
        owner = _owner(t06_session)
        loose = make_media(t06_session, owner, root=t06_settings.media_root_path)
        with anonymous_client(t06_settings, t06_session, *MEDIA_AND_MOMENTS) as client:
            assert_error(client.get(_media_variant_url(loose.id)), status=404, code="NOT_FOUND")
    finally:
        projects_wiring.unregister()
        gallery_wiring.unregister()
        posts_public_refs.unregister()


def test_t06_routers_are_the_two_declared_modules(t06_settings) -> None:
    names = [name for name, _router in t06_routers()]
    assert names == ["projects", "gallery"]
