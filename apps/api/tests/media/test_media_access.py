"""媒体授权测试（T01 任务卡「必须有的测试」第 5、6 行、05 §8）。

  - 变体 URL 猜测、未关联媒体、原图请求 → 匿名不可读；
  - 路径穿越不可读；
  - 一张图两处公开引用，撤回其中一处仍公开，撤回全部后新请求被拒绝；
  - 默认拒绝：没有登记任何公开引用检查时，即使文章已公开，匿名也是 404。

这些用例直接操作「登记表」本身，因为默认拒绝和显式登记正是要验证的契约
（SHARED-CONTRACTS §5：各模块的公开引用检查默认不生效，显式注册后才开放）。
"""

from __future__ import annotations

from app.core.db import utcnow
from app.modules.media import public_refs as media_public_refs
from app.modules.media.router import router as media_router
from app.modules.posts import public_refs as posts_public_refs
from app.modules.posts.models import STATUS_DRAFT
from app.modules.posts.router import router as posts_router
from app.modules.tags.router import router as tags_router
from app.modules.auth.router import router as auth_router
from tests.auth.helpers import DEFAULT_USERNAME, login_ok, make_admin
from tests.core.t01_db import module_api_client
from tests.media.helpers import make_media_row
from tests.posts.helpers import make_draft, make_post

ROUTERS = (
    ("auth", auth_router),
    ("media", media_router),
    ("posts", posts_router),
    ("tags", tags_router),
)


def _ensure_owner(session):
    """同一个用例里可能建多张媒体，站主只建一次（用户名唯一约束）。"""
    from app.modules.auth import service as auth_service

    user = auth_service.find_user(session, DEFAULT_USERNAME)
    return user if user is not None else make_admin(session, username=DEFAULT_USERNAME)


def _fixture_media(session, settings, *, status: str = "ready", deleted: bool = False, published: bool = True):
    """建一个「被文章封面引用」的媒体。"""
    owner = _ensure_owner(session)
    media = make_media_row(
        session,
        owner_id=owner.id,
        root=settings.media_root_path,
        status=status,
        deleted_at=utcnow() if deleted else None,
    )
    post = (
        make_post(session, cover_media_id=media.id)
        if published
        else make_draft(session, cover_media_id=media.id)
    )
    return owner, media, post


def _variant_url(media, name: str) -> str:
    return f"/api/v1/media/{media.id}/{name}"


def test_default_deny_when_no_checker_is_registered(t01_settings, t01_session):
    """注册表为空 → 匿名一律 404，哪怕是公开文章的封面。"""
    _, media, _ = _fixture_media(t01_session, t01_settings)
    assert media_public_refs.registered() == ()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        for name in ("w320.webp", "w640.webp", "original"):
            response = client.get(_variant_url(media, name))
            assert response.status_code == 404, (name, response.text)
        # 站主登录后仍然可以读（管理用途），说明 404 是权限判断而不是文件不存在。
        login_ok(client)
        assert client.get(_variant_url(media, "w320.webp")).status_code == 200
        assert client.get(_variant_url(media, "original")).status_code == 200


def test_published_post_cover_is_public_but_original_is_not(t01_settings, t01_session):
    _, media, _ = _fixture_media(t01_session, t01_settings)
    posts_public_refs.register()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        variant = client.get(_variant_url(media, "w320.webp"))
        assert variant.status_code == 200, variant.text
        assert variant.headers["content-type"] == "image/webp"
        assert variant.headers["x-content-type-options"] == "nosniff"
        assert variant.headers["cache-control"] == "private, no-store"
        assert variant.content

        # 原图永远只给站主，即使内容已公开
        assert client.get(_variant_url(media, "original")).status_code == 404

        # 站主可以读原图
        login_ok(client)
        original = client.get(_variant_url(media, "original"))
        assert original.status_code == 200
        assert original.headers["content-type"] == "image/png"


def test_unreferenced_and_draft_and_deleted_media_are_not_public(t01_settings, t01_session):
    owner = _ensure_owner(t01_session)
    unreferenced = make_media_row(t01_session, owner_id=owner.id, root=t01_settings.media_root_path)
    _, draft_media, _ = _fixture_media(t01_session, t01_settings, published=False)
    _, deleted_media, _ = _fixture_media(t01_session, t01_settings, deleted=True)
    _, processing_media, _ = _fixture_media(t01_session, t01_settings, status="processing")
    posts_public_refs.register()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        for media in (unreferenced, draft_media, deleted_media, processing_media):
            response = client.get(_variant_url(media, "w320.webp"))
            assert response.status_code == 404, (media.status, response.text)


def test_retracting_the_post_revokes_the_media(t01_settings, t01_session):
    _, media, post = _fixture_media(t01_session, t01_settings)
    posts_public_refs.register()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        assert client.get(_variant_url(media, "w320.webp")).status_code == 200

        # 撤回文章（软删除 / 改回草稿）：同一张图的新请求必须被拒绝
        post.status = STATUS_DRAFT
        t01_session.commit()
        assert client.get(_variant_url(media, "w320.webp")).status_code == 404

        post.deleted_at = utcnow()
        t01_session.commit()
        assert client.get(_variant_url(media, "w320.webp")).status_code == 404


def test_two_public_references_one_revoked_still_public(t01_settings, t01_session):
    """一张图两处公开引用：撤回其中一处仍公开；全部撤回后新请求被拒（05 §11）。"""
    _, media, post = _fixture_media(t01_session, t01_settings)
    posts_public_refs.register()

    # 第二个公开引用：模拟后续域（例如动态 / 相册）的检查器
    other_ref = {"active": True}

    def fake_domain_checker(session, media_id):
        return other_ref["active"] and media_id == media.id

    media_public_refs.register("fake-domain", fake_domain_checker)
    assert media_public_refs.registered() == ("fake-domain", "posts")

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        assert client.get(_variant_url(media, "w320.webp")).status_code == 200

        # 撤回「文章」这一处引用：另一个引用仍在 → 继续公开
        post.status = STATUS_DRAFT
        t01_session.commit()
        assert client.get(_variant_url(media, "w320.webp")).status_code == 200, "还有公开引用时必须继续可读"

        # 撤回最后一处引用 → 新请求不可读
        other_ref["active"] = False
        assert client.get(_variant_url(media, "w320.webp")).status_code == 404

        # 反向顺序同样成立：先恢复另一个引用，再恢复文章 → 仍公开
        other_ref["active"] = True
        assert client.get(_variant_url(media, "w320.webp")).status_code == 200


def test_variant_guessing_and_path_traversal_are_404(t01_settings, t01_session):
    _, media, _ = _fixture_media(t01_session, t01_settings)
    posts_public_refs.register()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        guessed = [
            "w999.webp",
            "w320",
            "w320.jpg",
            "original.webp",
            "ORIGINAL",
            "w320.webp.bak",
            "../../etc/passwd",
            "..%2F..%2Fetc%2Fpasswd",
            "w320.webp/../../original",
            "%2e%2e%2foriginal",
            "original%00.png",
            "w320.webp%20",
        ]
        for name in guessed:
            response = client.get(f"/api/v1/media/{media.id}/{name}")
            assert response.status_code == 404, (name, response.status_code)

        # 非 UUID / 不存在的 UUID：同样 404（不给出「格式对但不存在」的探测信号）
        assert client.get("/api/v1/media/not-a-uuid/w320.webp").status_code == 404
        assert client.get(f"/api/v1/media/{'0' * 32}/w320.webp").status_code == 404
        assert client.get(f"/api/v1/media/{media.id}/").status_code == 404
        assert client.get("/api/v1/media/").status_code == 404


def test_admin_can_read_deleted_original_but_not_variants(t01_settings, t01_session):
    _, media, _ = _fixture_media(t01_session, t01_settings, deleted=True)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        login_ok(client)
        assert client.get(_variant_url(media, "original")).status_code == 200
        assert client.get(_variant_url(media, "w320.webp")).status_code == 404


def test_missing_file_is_404_even_for_admin(t01_settings, t01_session):
    """元数据授权与文件是否存在分别校验：记录在、文件丢了 → 404，不返回空响应。"""
    _, media, _ = _fixture_media(t01_session, t01_settings)
    file_path = t01_settings.media_root_path / media.storage_key
    assert file_path.is_file()
    file_path.unlink()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        login_ok(client)
        response = client.get(_variant_url(media, "original"))
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"


def test_prelogin_session_gets_no_admin_media_access(t01_settings, t01_session):
    """预登录会话（有 Cookie、无站主身份）不能读原图。"""
    _, media, _ = _fixture_media(t01_session, t01_settings)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        response = client.get("/api/v1/auth/session")  # 建立预登录会话
        assert response.status_code == 200
        assert client.get(_variant_url(media, "original")).status_code == 404
