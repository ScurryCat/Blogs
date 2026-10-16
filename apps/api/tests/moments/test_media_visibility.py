"""动态图片的公开可见性与共享注册表登记（05 §8 / §11，03 §6 / §9.5）。

这是 T03 最容易被漏掉的一环：**图片的公开引用检查默认拒绝**，
`moments.wiring.register()` 没被登记时，一条已公开的图文对匿名访客就是「全是坏图」。
因此这里把两种状态都真的跑一遍：

  - 未登记 → 匿名读图片 404（安全默认值生效，不是「碰巧能读」）；
  - 登记后 → 已公开动态的图片可读，草稿 / 撤回 / 已软删除的图片仍是 404；
  - 同一张图同时被公开动态与公开文章引用时，撤回其中一个仍可读（05 §11）；
  - 原图永远只给站主（05 §8）；
  - `GET /tags` 只出现有公开动态使用的标签，草稿专用标签不泄漏。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.core.db import utcnow
from app.modules.moments import wiring as moments_wiring
from app.modules.moments.models import STATUS_DRAFT, STATUS_PUBLISHED
from app.modules.moments.router import router as moments_router
from app.modules.media import public_refs as media_public_refs
from app.modules.media.router import router as media_router
from app.modules.tags import service as tags_service
from app.modules.tags.router import router as tags_router
from tests.auth.helpers import login_ok, make_admin
from tests.core.t01_db import assert_error
from tests.moments.helpers import (
    MOMENTS_PATH,
    admin_client,
    anonymous_client,
    attach_images,
    make_media,
    make_moment,
    unique_tag,
)

ROUTERS = (("moments", moments_router),)
MEDIA_AND_TAGS = (("media", media_router), ("tags", tags_router))


def _media_variant_url(media_id, name: str = "w320.webp") -> str:
    return f"/api/v1/media/{media_id}/{name}"


def _owner(session):
    return make_admin(session, username=f"owner{uuid.uuid4().hex[:8]}")


def test_checker_is_not_registered_by_default(t03_settings, t03_session):
    """安全默认值：没有登记时匿名读不到任何媒体（不是「默认通过」）。"""
    assert "moments" not in media_public_refs.registered()
    assert "moments" not in tags_service.registered_public_tag_sources()


def test_registered_contributions_after_wiring(t03_settings, t03_session):
    moments_wiring.register()
    try:
        assert "moments" in media_public_refs.registered()
        assert "moments" in tags_service.registered_public_tag_sources()
        assert "moments" in moments_wiring.registered_contributions()
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_double_register_is_rejected(t03_settings, t03_session):
    """重复登记立即报错：静默覆盖会悄悄改变权限。"""
    moments_wiring.register()
    try:
        with pytest.raises(media_public_refs.DuplicateCheckerError):
            moments_wiring.register()
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_declared_checker_name_matches_delivery(t03_settings, t03_session):
    from app.modules.moments import public_refs

    assert public_refs.CHECKER_NAME == "moments"
    from app.modules.moments import tags_source

    assert tags_source.SOURCE_NAME == "moments"


def test_published_moment_makes_image_readable_only_after_registration(
    t03_settings, t03_session
):
    owner = _owner(t03_session)
    media = make_media(t03_session, owner, root=t03_settings.media_root_path)
    moment = make_moment(t03_session, owner, text="公开图", status=STATUS_PUBLISHED)
    attach_images(t03_session, moment, [(media.id, 0, "操场")])

    with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
        # 未登记：即使动态已公开，匿名也是 404
        assert_error(
            client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND"
        )

    moments_wiring.register()
    try:
        with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
            response = client.get(_media_variant_url(media.id))
            assert response.status_code == 200, response.text
            assert response.headers["Cache-Control"] == "private, no-store"
            assert response.headers["X-Content-Type-Options"] == "nosniff"
            # 原图永远只给站主，即便内容已公开
            assert_error(
                client.get(_media_variant_url(media.id, "original")),
                status=404,
                code="NOT_FOUND",
            )
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_draft_image_stays_private_after_registration(t03_settings, t03_session):
    owner = _owner(t03_session)
    media = make_media(t03_session, owner, root=t03_settings.media_root_path)
    draft = make_moment(t03_session, owner, text="草稿图", status=STATUS_DRAFT)
    attach_images(t03_session, draft, [(media.id, 0, "草稿")])

    moments_wiring.register()
    try:
        with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
            assert_error(
                client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND"
            )
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_unpublish_and_soft_delete_revoke_anonymous_media_access(
    t03_settings, t03_session
):
    """撤回后新媒体请求不可读（03 §9.5）；软删除同理。"""
    owner = _owner(t03_session)
    media = make_media(t03_session, owner, root=t03_settings.media_root_path)
    moment = make_moment(t03_session, owner, text="将被撤回", status=STATUS_PUBLISHED)
    attach_images(t03_session, moment, [(media.id, 0, "图")])
    moments_wiring.register()
    try:
        with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
            assert client.get(_media_variant_url(media.id)).status_code == 200

            moment.status = STATUS_DRAFT
            moment.published_at = None
            t03_session.flush()
            assert_error(
                client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND"
            )

            moment.status = STATUS_PUBLISHED
            moment.published_at = utcnow()
            t03_session.flush()
            assert client.get(_media_variant_url(media.id)).status_code == 200

            moment.deleted_at = utcnow()
            t03_session.flush()
            assert_error(
                client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND"
            )
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_two_public_references_one_revoked_still_readable(t03_settings, t03_session):
    """一张图有两个公开引用：撤回一个不影响另一个（05 §11）。

    这里用「文章封面」作为第二个引用：它是 T01 已经实现的域，
    因此这条用例同时验证了**跨域**的注册表行为。
    """
    from app.modules.posts import wiring as posts_wiring

    owner = _owner(t03_session)
    media = make_media(t03_session, owner, root=t03_settings.media_root_path)

    from tests.posts.helpers import make_post, unique_category

    post = make_post(
        t03_session,
        cover_media_id=media.id,
        category=unique_category(),
        title="有封面的文章",
    )
    moment = make_moment(t03_session, owner, text="同一张图", status=STATUS_PUBLISHED)
    attach_images(t03_session, moment, [(media.id, 0, "同一张")])

    posts_wiring.register()
    moments_wiring.register()
    try:
        with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
            assert client.get(_media_variant_url(media.id)).status_code == 200

            # 撤回动态：文章封面仍是公开引用 → 图片仍可读
            moment.status = STATUS_DRAFT
            moment.published_at = None
            t03_session.flush()
            assert client.get(_media_variant_url(media.id)).status_code == 200

            # 再撤回文章：所有公开引用都没了 → 404
            post.status = STATUS_DRAFT
            t03_session.flush()
            assert_error(
                client.get(_media_variant_url(media.id)), status=404, code="NOT_FOUND"
            )
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_tags_endpoint_only_exposes_tags_used_by_public_moments(
    t03_settings, t03_session
):
    owner = _owner(t03_session)
    public_tag = unique_tag("公开")
    draft_tag = unique_tag("草稿")
    public_moment = make_moment(
        t03_session, owner, text="公开", status=STATUS_PUBLISHED, tags=(public_tag,)
    )
    make_moment(t03_session, owner, text="草稿", status=STATUS_DRAFT, tags=(draft_tag,))

    moments_wiring.register()
    try:
        with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
            names = {tag["name"] for tag in client.get("/api/v1/tags").json()}
        assert public_tag in names
        assert draft_tag not in names

        # 撤回后公开标签也消失（不残留一个「没有内容」的标签）
        public_moment.status = STATUS_DRAFT
        public_moment.published_at = None
        t03_session.flush()
        with anonymous_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as client:
            names_after = {tag["name"] for tag in client.get("/api/v1/tags").json()}
        assert public_tag not in names_after
    finally:
        moments_wiring.unregister()
        tags_service.reset_public_tag_sources()


def test_admin_can_read_original_and_draft_image(t03_settings, t03_session):
    """站主仍能读原图与草稿图（管理用途），与匿名路径分开判断。"""
    with admin_client(t03_settings, t03_session, *MEDIA_AND_TAGS) as (client, user, _csrf):
        media = make_media(t03_session, user, root=t03_settings.media_root_path)
        draft = make_moment(t03_session, user, text="草稿", status=STATUS_DRAFT)
        attach_images(t03_session, draft, [(media.id, 0, "草稿图")])
        assert client.get(_media_variant_url(media.id, "original")).status_code == 200
        assert client.get(_media_variant_url(media.id)).status_code == 200
