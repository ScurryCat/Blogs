"""T09 集成边界（SHARED-CONTRACTS §2 / §5、任务卡执行清单）。

守两件事：

  1. **T09 不向任何共享注册表贡献条目**：技能没有自己的媒体，问题记录也没有。
     `wiring.CONTRIBUTIONS` 是空元组，且注册表里没有 T09 的名字 ——
     这样集成负责人**不需要**在 `app/main.py` 里加 T09 的 `register()`。
  2. **T09 不接管 T04 的分类探索**：`/nav/*` 的路由表与 `GET /posts?category=`
     仍然由 T04 / T01 提供，T09 只增加 `/skills` 与 `/exploration/records`
     两条互不重叠的命名空间；`/apps/metanav` 的分类屏（前端）也仍在。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.main import create_app
from app.modules.exploration import wiring as exploration_wiring
from app.modules.skills import wiring as skills_wiring
from tests.exploration.helpers import t09_routers


def test_skills_contributes_nothing_to_shared_registries(t09_session) -> None:
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    skills_wiring.register()
    assert skills_wiring.registered_contributions() == ()
    assert "skills" not in public_refs.registered()
    assert not any(
        name.startswith("skills") for name in tags_service.registered_public_tag_sources()
    )
    skills_wiring.verify_no_shared_contributions()


def test_exploration_contributes_nothing_to_shared_registries(t09_session) -> None:
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    exploration_wiring.register()
    assert exploration_wiring.registered_contributions() == ()
    assert "exploration" not in public_refs.registered()
    assert not any(
        name.startswith("exploration") for name in tags_service.registered_public_tag_sources()
    )
    exploration_wiring.verify_no_shared_contributions()


def test_t09_routes_are_mounted_under_api_v1(t09_settings) -> None:
    app = create_app(settings=t09_settings, module_routers=dict(t09_routers()))
    paths = set(app.openapi()["paths"])

    assert {
        "/api/v1/skills",
        "/api/v1/skills/combo",
        "/api/v1/skills/projects/{slug}",
        "/api/v1/skills/{slug}",
        "/api/v1/admin/skills",
        "/api/v1/admin/skills/{skill_id}",
        "/api/v1/admin/skills/{skill_id}/publish",
        "/api/v1/admin/skills/{skill_id}/unpublish",
        "/api/v1/exploration/records",
        "/api/v1/exploration/records/stats",
        "/api/v1/exploration/records/{slug}",
        "/api/v1/admin/exploration/records",
        "/api/v1/admin/exploration/records/{record_id}",
        "/api/v1/admin/exploration/records/{record_id}/publish",
        "/api/v1/admin/exploration/records/{record_id}/unpublish",
    } <= paths


def _declared_paths(router) -> list[str]:
    """模块 router 内部声明的路径顺序（`include_router` 已把子前缀并入 path）。"""
    return [route.path for route in router.routes]


def test_combo_is_registered_before_the_generic_skill_slug(t09_settings) -> None:
    """`/skills/combo` 必须排在 `/skills/{slug}` 之前，否则会被当成一个技能 slug。"""
    from app.modules.skills.router import public_router

    declared = _declared_paths(public_router)
    assert "/skills" in declared, declared
    assert declared.index("/skills/combo") < declared.index("/skills/{slug}")
    assert declared.index("/skills/projects/{slug}") < declared.index("/skills/{slug}")


def test_exploration_stats_is_registered_before_the_slug_route() -> None:
    from app.modules.exploration.router import public_router

    declared = _declared_paths(public_router)
    assert "/exploration/records/stats" in declared, declared
    assert declared.index("/exploration/records/stats") < declared.index(
        "/exploration/records/{slug}"
    )


def test_t09_does_not_claim_nav_or_posts_namespace(t09_settings) -> None:
    """**保留 T04 的分类探索**：T09 的路径不占用 /nav/* 与 /posts*。"""
    from app.modules.exploration.router import router as exploration_router
    from app.modules.skills.router import router as skills_router

    prefixes: set[str] = set()
    for module_router in (skills_router, exploration_router):
        # `include_router()` 把子 router 包成 `_IncludedRouter`，真实路径在
        # `original_router` 里（且子前缀已并入 path）。
        for included in module_router.routes:
            inner = getattr(included, "original_router", None)
            for route in getattr(inner, "routes", []):
                path = getattr(route, "path", None)
                if path is not None:
                    prefixes.add(path)

    assert prefixes, "路由表为空时下面的断言会空过"
    assert not any(path.startswith("/nav") for path in prefixes), sorted(prefixes)
    assert not any(path.startswith("/posts") for path in prefixes), sorted(prefixes)


def test_t09_routers_can_coexist_with_t04_nav_router(t09_settings) -> None:
    """T09 与 T04 的 router 能同时挂载，前缀不冲突（真实 create_app 路径）。"""
    from app.modules.nav.router import router as nav_router

    app = create_app(
        settings=t09_settings,
        module_routers={"nav": nav_router, **dict(t09_routers())},
    )
    paths = set(app.openapi()["paths"])
    assert "/api/v1/nav/palaces" in paths
    assert "/api/v1/skills" in paths
    assert "/api/v1/exploration/records" in paths


def test_module_routers_are_plain_api_routers() -> None:
    for _name, module_router in t09_routers():
        assert isinstance(module_router, APIRouter)
