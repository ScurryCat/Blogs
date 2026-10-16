"""头像走共享媒体权限：公开引用检查的真实行为（05 §8 / §11、SHARED-CONTRACTS §5）。

这组用例刻意**不**只断言我们自己的布尔函数：它们用真实的
`GET /api/v1/media/{id}/{variant}` 与真实的 `media/public_refs` 注册表，
证明「未登记 = 默认拒绝」「已发布友链的头像才可匿名读」「撤回后新请求立刻 404」。
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.modules.coop import wiring
from app.modules.media import public_refs
from tests.coop.helpers import admin_login, make_link, make_published_link, unique_name
from tests.media.helpers import png_bytes, upload

UTC = timezone.utc
VARIANT = "w320.webp"


def upload_media(client, csrf_token: str) -> dict:
    """走真实的站主上传端点得到一条 ready 媒体（不伪造记录）。"""
    response = upload(client, png_bytes(800, 600), csrf_token=csrf_token)
    assert response.status_code == 201, response.text
    return response.json()


def media_status(client, media_id: str, variant: str = VARIANT) -> int:
    return client.get(f"/api/v1/media/{media_id}/{variant}").status_code


def anonymous_client(settings, session: Session, *routers):
    """没有任何 Cookie 的客户端：匿名读取必须走公开引用检查。"""
    from tests.coop.conftest import module_api_client

    return module_api_client(settings, session, *routers)


def test_unregistered_domain_keeps_avatars_private(coop_client, t07_session, t07_settings):
    """默认拒绝：没有登记公开引用检查时，已发布友链的头像对匿名也是 404。"""
    from app.modules.auth.router import router as auth_router
    from app.modules.coop.router import router as coop_router
    from app.modules.media.router import router as media_router

    session_state = admin_login(coop_client, t07_session)
    media = upload_media(coop_client, session_state["csrf_token"])
    make_published_link(t07_session, name=unique_name(), avatar_media_id=media["id"])

    # 进程里可能已有别的域（posts）注册过；这里只要求 coop 自己**没有**注册。
    assert "coop" not in public_refs.registered()
    with anonymous_client(
        t07_settings, t07_session, ("auth", auth_router), ("coop", coop_router), ("media", media_router)
    ) as client:
        assert media_status(client, media["id"]) == 404


def test_published_avatar_becomes_publicly_readable_after_registration(
    coop_client, t07_session, t07_settings
):
    from app.modules.auth.router import router as auth_router
    from app.modules.coop.router import router as coop_router
    from app.modules.media.router import router as media_router

    session_state = admin_login(coop_client, t07_session)
    media = upload_media(coop_client, session_state["csrf_token"])
    link = make_published_link(t07_session, name=unique_name(), avatar_media_id=media["id"])

    wiring.register()
    assert "coop" in public_refs.registered()

    with anonymous_client(
        t07_settings, t07_session, ("auth", auth_router), ("coop", coop_router), ("media", media_router)
    ) as client:
        response = client.get(f"/api/v1/media/{media['id']}/{VARIANT}")
        assert response.status_code == 200, response.text
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        # 公开详情里给的是相对 URL 的变体，不含原图。
        detail = client.get(f"/api/v1/coop/links/{link.id}").json()
        assert detail["avatar"]["id"] == media["id"]
        assert {variant["name"] for variant in detail["avatar"]["variants"]} == {"w320.webp", "w640.webp"}


def test_draft_avatar_is_not_a_public_reference(coop_client, t07_session, t07_settings):
    from app.modules.auth.router import router as auth_router
    from app.modules.coop.router import router as coop_router
    from app.modules.media.router import router as media_router

    session_state = admin_login(coop_client, t07_session)
    media = upload_media(coop_client, session_state["csrf_token"])
    make_link(t07_session, name=unique_name("草稿"), avatar_media_id=media["id"])
    wiring.register()

    with anonymous_client(
        t07_settings, t07_session, ("auth", auth_router), ("coop", coop_router), ("media", media_router)
    ) as client:
        assert media_status(client, media["id"]) == 404


def test_unpublish_and_delete_revoke_the_public_reference(coop_client, t07_session, t07_settings):
    from app.modules.auth.router import router as auth_router
    from app.modules.coop.router import router as coop_router
    from app.modules.media.router import router as media_router

    session_state = admin_login(coop_client, t07_session)
    media = upload_media(coop_client, session_state["csrf_token"])
    link = make_published_link(t07_session, name=unique_name(), avatar_media_id=media["id"])
    wiring.register()

    with anonymous_client(
        t07_settings, t07_session, ("auth", auth_router), ("coop", coop_router), ("media", media_router)
    ) as client:
        assert media_status(client, media["id"]) == 200

        # 撤回 → 新匿名请求立刻读不到（不共享缓存）。
        from app.modules.coop import service

        service.unpublish_link(t07_session, link)
        assert media_status(client, media["id"]) == 404

        service.publish_link(t07_session, link)
        assert media_status(client, media["id"]) == 200

        service.soft_delete_link(t07_session, link)
        assert media_status(client, media["id"]) == 404


def test_one_still_public_reference_keeps_the_avatar_readable(
    coop_client, t07_session, t07_settings
):
    """同一张图被两条友链引用：撤回其中一条不收回另一条的公开引用（05 §11）。"""
    from app.modules.auth.router import router as auth_router
    from app.modules.coop.router import router as coop_router
    from app.modules.media.router import router as media_router
    from app.modules.coop import service

    session_state = admin_login(coop_client, t07_session)
    media = upload_media(coop_client, session_state["csrf_token"])
    first = make_published_link(t07_session, name=unique_name("A"), avatar_media_id=media["id"])
    make_published_link(t07_session, name=unique_name("B"), avatar_media_id=media["id"])
    wiring.register()

    with anonymous_client(
        t07_settings, t07_session, ("auth", auth_router), ("coop", coop_router), ("media", media_router)
    ) as client:
        service.unpublish_link(t07_session, first)
        assert media_status(client, media["id"]) == 200


def test_avatar_degrades_to_null_when_media_is_missing_or_gone(coop_client, t07_session):
    """头像缺失 / 失败都不能让卡片坏掉：公开响应里 `avatar` 为 null（验收第 4 条）。"""
    from tests.auth.helpers import make_admin
    from tests.media.helpers import make_media_row

    owner = make_admin(t07_session)

    # 1) 根本没设置头像
    bare = make_published_link(t07_session, name=unique_name("没头像"))
    assert coop_client.get(f"/api/v1/coop/links/{bare.id}").json()["avatar"] is None

    # 2) 指向一条**已撤回**的媒体：服务端给 null，而不是给出一个必然 404 的地址
    removed = make_media_row(t07_session, owner_id=owner.id, deleted_at=datetime.now(UTC))
    with_removed = make_published_link(
        t07_session, name=unique_name("图被撤回"), avatar_media_id=removed.id
    )
    assert coop_client.get(f"/api/v1/coop/links/{with_removed.id}").json()["avatar"] is None

    # 3) 指向一条还没处理完的媒体：同样是 null（不给坏图）
    pending = make_media_row(t07_session, owner_id=owner.id, status="processing")
    with_pending = make_published_link(
        t07_session, name=unique_name("图未就绪"), avatar_media_id=pending.id
    )
    detail = coop_client.get(f"/api/v1/coop/links/{with_pending.id}").json()
    assert detail["avatar"] is None
    # 卡片本身照常返回（不因为头像缺失被过滤掉），列表里仍有它。
    assert str(with_pending.id) in {
        item["id"] for item in coop_client.get("/api/v1/coop/links").json()["items"]
    }


def test_wiring_self_check_and_duplicate_registration(coop_client, t07_session):
    wiring.register()
    wiring.verify_contributions()
    assert wiring.registered_contributions() == ("media:coop",)

    with pytest.raises(public_refs.DuplicateCheckerError):
        wiring.register()

    wiring.unregister()
    assert "coop" not in public_refs.registered()
