"""边界与集成声明：服务故障、模块形状、与共享注册表的关系（05 §6/§9、SHARED-CONTRACTS §3/§5）。

这些用例存在的意义是把「导航模块不参与共享注册表」「数据库故障不是 404 / 空列表」
「路由就是 05 规定的那 9 条」变成会失败的断言，而不是交付单里的一句话。
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.db import create_session_factory
from app.core.deps import get_session
from app.modules.nav import wiring
from tests.nav.conftest import module_api_client
from tests.nav.helpers import assert_error, make_published_palace, unique_slug
from tests.support.module_app import build_module_app
from tests.posts.helpers import make_post

EXPECTED_PATHS = {
    "/api/v1/nav/palaces",
    "/api/v1/nav/palaces/{slug}",
    "/api/v1/nav/resolve",
    "/api/v1/nav/search",
    "/api/v1/admin/nav/palaces",
    "/api/v1/admin/nav/palaces/{palace_id}",
    "/api/v1/admin/nav/palaces/{palace_id}/publish",
    "/api/v1/admin/nav/palaces/{palace_id}/unpublish",
}


def test_route_shape_matches_the_documented_contract(t04_settings, t04_session: Session):
    """路由前缀与路径就是 05 §6 / §7 规定的那几条（供 T00 登记时核对）。"""
    from app.modules.nav.router import router

    app = build_module_app(t04_settings, ("nav", router))
    paths = {path for path in app.openapi()["paths"] if path.startswith("/api/v1/nav") or "nav" in path}
    assert paths == EXPECTED_PATHS, paths


def test_wiring_declares_no_shared_contributions():
    """nav 不登记媒体公开引用检查，也不登记公开标签来源。"""
    assert wiring.register() == ()
    assert wiring.registered_contributions() == ()
    wiring.verify_no_shared_contributions()


def test_nav_does_not_appear_in_shared_registries():
    """即使调用了 register()，共享注册表里也不会多出 nav 条目（默认拒绝 / 不贡献）。"""
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    before_media = public_refs.registered()
    before_tags = tags_service.registered_public_tag_sources()
    wiring.register()
    assert "nav" not in public_refs.registered()
    assert public_refs.registered() == before_media
    assert tags_service.registered_public_tag_sources() == before_tags


def test_database_failure_is_503_not_404_or_empty(t04_settings, t04_session: Session):
    """数据库不可用：列表 / 详情 / 定位 / 搜索都必须 503，不能伪装成 404 或空结果。"""
    broken_engine = create_engine(
        "postgresql+psycopg://pl@127.0.0.1:55433/pl_test_unreachable",
        connect_args={"connect_timeout": 2},
    )
    session = create_session_factory(broken_engine)()
    from app.modules.nav.router import router as nav_router

    try:
        app = build_module_app(t04_settings, ("nav", nav_router))
        app.dependency_overrides[get_session] = lambda: session
        with TestClient(app, raise_server_exceptions=False) as client:
            assert_error(
                client.get("/api/v1/nav/palaces"), status=503, code="SERVICE_UNAVAILABLE"
            )
            assert_error(
                client.get("/api/v1/nav/palaces/anything"),
                status=503,
                code="SERVICE_UNAVAILABLE",
            )
            assert_error(
                client.post(
                    "/api/v1/nav/resolve",
                    json={"name": "a", "location": "b", "cognition": "c"},
                ),
                status=503,
                code="SERVICE_UNAVAILABLE",
            )
            assert_error(
                client.get("/api/v1/nav/search", params={"q": "a"}),
                status=503,
                code="SERVICE_UNAVAILABLE",
            )
    finally:
        session.close()
        broken_engine.dispose()


def test_slug_cannot_be_changed_by_update(nav_client, t04_session: Session):
    """公开 URL 必须稳定：PATCH 里带 slug 是 422，不是静默忽略（05 §2）。"""
    from tests.nav.helpers import admin_login, create_payload

    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    created = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(), "csrf_token": csrf},
        headers=headers,
    ).json()
    response = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{created['id']}",
        json={"slug": "new-slug", "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert_error(response, status=422, code="UNPROCESSABLE")
    assert nav_client.get(f"/api/v1/admin/nav/palaces/{created['id']}").json()["slug"] == created["slug"]


def test_related_public_palaces_facade_for_other_modules(t04_session: Session):
    """T06 / T09 的组合入口：按文章找公开专题、按 slug 取公开专题、取选择器列表。"""
    from app.modules.nav import service

    post = make_post(t04_session)
    other = make_post(t04_session)
    public = make_published_palace(t04_session, posts=(post,), title="公开专题")
    draft = make_published_palace(t04_session, posts=(other,), title="另一个专题")
    draft.status = "draft"
    t04_session.flush()

    related = service.related_public_palaces_for_post(t04_session, post.id)
    assert [palace.slug for palace in related] == [public.slug]
    assert service.related_public_palaces_for_post(t04_session, other.id) == []
    assert service.public_palace_by_slug(t04_session, public.slug) is not None
    assert service.public_palace_by_slug(t04_session, draft.slug) is None
    assert [palace.slug for palace in service.public_palace_options(t04_session)] == [public.slug]


def test_module_test_client_only_mounts_nav(t04_settings, t04_session: Session):
    """模块测试 app 只挂被测模块：不会因为别人的模块坏掉而失败（SHARED-CONTRACTS §3）。"""
    from app.modules.nav.router import router as nav_router

    with module_api_client(t04_settings, t04_session, ("nav", nav_router)) as client:
        assert client.get("/api/v1/nav/palaces").status_code == 200
        assert client.get("/api/v1/posts").status_code == 404
        assert client.get("/api/v1/health/live").status_code == 200


def test_public_search_never_returns_admin_only_fields(public_client, t04_session: Session):
    post = make_post(t04_session, title="字段隔离检查")
    make_published_palace(t04_session, posts=(post,), title="字段隔离殿堂")
    response = public_client.get("/api/v1/nav/search", params={"q": "字段隔离"})
    body = response.text
    for leaked in ("version", "storage_key", "deleted_at", "status", "created_at"):
        assert leaked not in body, leaked
