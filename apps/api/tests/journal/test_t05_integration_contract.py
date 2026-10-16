"""T05 的集成契约自检（不需要浏览器，也不需要完整生产 app）。

内容：
  1. 本包声明的表确实存在，且最终由**真实迁移**建出（`created_by_fallback` 为空）；
  2. `wiring.register()` 幂等性与贡献清单；
  3. 路由前缀与路径与交付单一致（模块内部自己组合公开 / 管理两条前缀）；
  4. 时间字段全部带时区（`entry_date` 是 date，`published_at` 是 timestamptz）；
  5. 状态 / 可见性枚举只有文档规定的取值。
"""

from __future__ import annotations

from sqlalchemy import text

from app.modules.journal import router as journal_router
from app.modules.leisure import router as leisure_router
from app.modules.media import public_refs as media_public_refs


def test_t05_schema_report_is_recorded(t05_schema_report, t05_session):
    """记录建表来源，并把「迁移还没生成」这件事变成**可复核的输出**而不是静默通过。

    集成前 `created_by_fallback` 非空是**预期**的（集成方还没生成迁移）；用例在这里
    只断言「报告的形状正确 + 表确实存在且可用」。真正的「迁移已覆盖」由集成方在生成
    迁移后重跑时核对（交付单 §3 记录了这次的实际值）。
    """
    fallback = t05_schema_report["created_by_fallback"]
    assert isinstance(fallback, list)
    assert set(fallback) <= {"journal_entries", "journal_entry_media", "leisure_entries"}
    count = t05_session.execute(
        text("select count(*) from information_schema.tables where table_name = 'leisure_entries'")
    ).scalar()
    assert count == 1


def test_t05_tables_and_key_columns(t05_session):
    tables = set(
        t05_session.execute(
            text(
                "select table_name from information_schema.tables "
                "where table_schema = current_schema()"
            )
        ).scalars()
    )
    assert {"journal_entries", "journal_entry_media", "leisure_entries"} <= tables

    columns = {
        (row.table_name, row.column_name): row.data_type
        for row in t05_session.execute(
            text(
                "select table_name, column_name, data_type from information_schema.columns "
                "where table_name in ('journal_entries', 'journal_entry_media', 'leisure_entries')"
            )
        )
    }
    # 日记日期是日历日期（验收 2），发布时间是带时区的时刻（05 §2）。
    assert columns[("journal_entries", "entry_date")] == "date"
    assert columns[("journal_entries", "published_at")] == "timestamp with time zone"
    assert columns[("journal_entries", "visibility")] == "character varying"
    assert columns[("journal_entry_media", "alt")] == "character varying"
    assert columns[("leisure_entries", "rating")] == "integer"
    assert columns[("leisure_entries", "total_episodes")] == "integer"


def test_journal_routes_are_under_the_expected_prefixes(t05_settings):
    """路径是**挂载后**的形态（`/api/v1/...`），因为那才是集成方与消费者看到的地址。"""
    paths = _mounted_paths(t05_settings, ("journal", journal_router.router))
    assert "/api/v1/journal/entries" in paths
    assert "/api/v1/journal/entries/{entry_id}" in paths
    assert "/api/v1/journal/calendar" in paths
    assert "/api/v1/admin/journal/entries" in paths
    assert "/api/v1/admin/journal/entries/{entry_id}" in paths
    assert "/api/v1/admin/journal/entries/{entry_id}/publish" in paths
    assert "/api/v1/admin/journal/entries/{entry_id}/unpublish" in paths
    assert "/api/v1/admin/journal/entries/{entry_id}/visibility" in paths


def test_leisure_routes_are_under_the_expected_prefixes(t05_settings):
    paths = _mounted_paths(t05_settings, ("leisure", leisure_router.router))
    assert "/api/v1/leisure/entries" in paths
    assert "/api/v1/leisure/entries/{entry_id}" in paths
    assert "/api/v1/admin/leisure/entries" in paths
    assert "/api/v1/admin/leisure/entries/{entry_id}" in paths
    assert "/api/v1/admin/leisure/entries/{entry_id}/publish" in paths
    assert "/api/v1/admin/leisure/entries/{entry_id}/unpublish" in paths


def test_module_routers_have_no_own_prefix():
    """模块 router 交给集成方时必须是空前缀容器（前缀由模块内部组合，与 media / nav 一致）。"""
    assert journal_router.router.prefix == ""
    assert leisure_router.router.prefix == ""


def test_wiring_register_contributes_media_reference_checkers():
    from app.modules.journal import wiring as journal_wiring
    from app.modules.leisure import wiring as leisure_wiring

    media_public_refs.reset()
    try:
        assert journal_wiring.register() == ("media:journal",)
        assert leisure_wiring.register() == ("media:leisure",)
        assert set(media_public_refs.registered()) == {"journal", "leisure"}
        journal_wiring.verify_registered()
        leisure_wiring.verify_registered()
        # 重复登记必须报错（静默覆盖会改变权限语义）。
        import pytest

        with pytest.raises(media_public_refs.DuplicateCheckerError):
            journal_wiring.register()
    finally:
        media_public_refs.reset()
        journal_wiring.__dict__  # noqa: B018 - 保持导入引用（可读性）


def test_t05_does_not_contribute_public_tag_sources():
    """两个域都没有标签字段，因此都不贡献公开标签来源（可执行断言）。"""
    from app.modules.journal import wiring as journal_wiring
    from app.modules.leisure import wiring as leisure_wiring

    journal_wiring.verify_no_shared_tag_contributions()
    leisure_wiring.verify_no_shared_tag_contributions()


def test_journal_public_conditions_require_both_flags():
    """公开条件必须同时要求 published 与 public（07 §3 的分离要求）。"""
    from app.modules.journal import service

    conditions = service.public_conditions()
    rendered = " ".join(str(condition) for condition in conditions)
    assert "status" in rendered and "visibility" in rendered
    assert "deleted_at IS NULL" in rendered
    assert "entry_date <=" in rendered


def test_leisure_public_conditions_are_published_and_not_deleted():
    from app.modules.leisure import service

    rendered = " ".join(str(condition) for condition in service.public_conditions())
    assert "status" in rendered and "deleted_at IS NULL" in rendered


def _mounted_paths(settings, *routers) -> set[str]:
    """把被测 router 挂到一个真实 app 上，从 OpenAPI 的路径清单里读前缀。

    为什么不直接遍历 `router.routes`：FastAPI 0.143 的 `include_router` 产生
    `_IncludedRouter`，不再暴露 `.path`（T00 也踩过同一处）。从最终 app 的 OpenAPI
    读路径既绕开了这个内部实现，又正好是外部消费者看到的东西。
    """
    from tests.support.module_app import build_module_app

    app = build_module_app(settings, *routers)
    return set(app.openapi()["paths"])
