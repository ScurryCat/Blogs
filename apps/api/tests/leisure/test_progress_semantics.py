"""放课后的进度语义与数据库约束（验收 3）。

验收 3 的三条：
  - 总集数空：显示「看到第 6 集」，**不计算完成率**；
  - 弃坑 / 搁置 / 零评分 / 未评分：展示正确，未评分不等于 0 分；
  - 无第三方同步暗示：接口里没有任何「同步自 Steam / Bangumi」的字段或状态。

外加数据库级的类型 / 字段归属约束：绕过 API 也写不进「追番带平台」这种脏数据。
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.leisure import rules, schemas
from app.modules.leisure.models import LeisureEntry
from tests.leisure.helpers import make_anime, make_game, make_public_anime, make_public_game

PUBLIC_KEYS = {
    "id",
    "kind",
    "title",
    "progress",
    "progress_label",
    "rating",
    "notes",
    "notes_have_spoilers",
    "cover",
    "anime",
    "game",
    "review",
    "updated_at",
}


def test_unknown_total_episodes_has_no_completion_ratio():
    """总数未知 → 标签是「看到第 6 集」，完成率是 None（不是 0，也不是 1）。"""
    assert rules.episodes_label(6, None) == "看到第 6 集"
    assert rules.completion_ratio(6, None) is None


def test_known_total_episodes_computes_the_ratio():
    assert rules.episodes_label(6, 12) == "看到第 6 / 12 集"
    assert rules.completion_ratio(6, 12) == 0.5


def test_no_progress_recorded_is_not_zero():
    """一条都没记录时是「还没记录进度」，不是「看到第 0 集」。"""
    assert rules.episodes_label(None, None) == "还没记录进度"
    assert rules.episodes_label(None, 12) == "共 12 集"
    assert rules.completion_ratio(None, 12) is None
    # 总集数为 0 是脏数据，不产生除零，也不产生假的 100%。
    assert rules.completion_ratio(0, 0) is None


def test_playtime_label_is_explicit_about_missing_data():
    assert rules.playtime_label(None) == "未记录时长"
    assert rules.playtime_label(45) == "45 分"
    assert rules.playtime_label(60) == "1 小时"
    assert rules.playtime_label(95) == "1 小时 35 分"


def test_progress_labels_differ_per_kind():
    """同一个 `cleared` 在游戏里是「通关」；追番的 `finished` 是「看完」。"""
    assert rules.progress_label("anime", "finished") == "看完"
    assert rules.progress_label("game", "cleared") == "通关"
    assert rules.progress_label("anime", "dropped") == "弃坑"
    assert rules.progress_label("game", "on_hold") == "搁置"
    assert rules.progress_label("anime", "watching") == "在看"
    assert rules.progress_label("game", "playing") == "在玩"


def test_cleared_does_not_imply_all_achievements():
    """通关 ≠ 全成就：两个字段独立，规则层没有任何推导。"""
    assert not hasattr(rules, "achievements_from_completion")


def test_public_anime_payload_when_total_unknown(public_leisure_client, t05_session: Session):
    entry = make_public_anime(
        t05_session, total_episodes=None, episodes_watched=6, rating=None, title="总数不明"
    )
    response = public_leisure_client.get(f"/api/v1/leisure/entries/{entry.id}")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert set(payload) == PUBLIC_KEYS
    assert payload["anime"]["episodes_label"] == "看到第 6 集"
    assert payload["anime"]["completion_ratio"] is None
    assert payload["rating"] is None, "未评分必须是 null，不是 0"
    assert payload["game"] is None
    # 响应里不能出现任何第三方同步的暗示。
    text_body = response.text
    for leaked in ("steam", "Steam", "bangumi", "Bangumi", "sync", "synced"):
        assert leaked not in text_body, f"响应里出现了第三方同步暗示：{leaked}"


def test_zero_rating_is_not_the_same_as_unrated(public_leisure_client, t05_session: Session):
    rated = make_public_anime(t05_session, rating=8, title="打了分")
    unrated = make_public_anime(t05_session, rating=None, title="没打分")

    assert public_leisure_client.get(
        f"/api/v1/leisure/entries/{rated.id}"
    ).json()["rating"] == 8
    assert public_leisure_client.get(
        f"/api/v1/leisure/entries/{unrated.id}"
    ).json()["rating"] is None


def test_game_payload_reports_completion_and_achievements_separately(
    public_leisure_client, t05_session: Session
):
    """通关与全成就分开返回：`cleared` + `completed_on` 不推导 `all_achievements`。"""
    entry = make_public_game(
        t05_session,
        title="通关了但没全成就",
        progress="cleared",
        completed_on=date(2026, 9, 1),
        all_achievements=False,
        playtime_minutes=None,
    )
    response = public_leisure_client.get(f"/api/v1/leisure/entries/{entry.id}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["game"]["completed_on"] == "2026-09-01"
    assert payload["game"]["all_achievements"] is False
    assert payload["game"]["playtime_label"] == "未记录时长"
    assert payload["anime"] is None


def test_achievements_unknown_is_null_not_false(public_leisure_client, t05_session: Session):
    """没记录全成就状态时是 `null`（不知道），不是 `false`（明确没拿到）。"""
    entry = make_public_game(t05_session, progress="playing", all_achievements=None)
    payload = public_leisure_client.get(f"/api/v1/leisure/entries/{entry.id}").json()
    assert payload["game"]["all_achievements"] is None


def test_spoiler_flag_is_preserved(public_leisure_client, t05_session: Session):
    entry = make_public_anime(t05_session, notes="结局是……", notes_have_spoilers=True)
    payload = public_leisure_client.get(f"/api/v1/leisure/entries/{entry.id}").json()
    assert payload["notes_have_spoilers"] is True


# --- 数据库约束（真实 PostgreSQL）-------------------------------------------


def _rejected(session: Session, factory) -> None:
    """在 SAVEPOINT 里跑一次注定失败的插入：断言数据库真的拒绝，且外层事务仍可用。

    为什么用 SAVEPOINT 而不是「插入 → rollback」：`IntegrityError` 会让整个事务进入
    失败状态，之后的语句全部报 `InFailedSqlTransaction`，后面的断言就测不到东西了。
    """
    savepoint = session.begin_nested()
    with pytest.raises(IntegrityError):
        factory()
        session.flush()
    savepoint.rollback()


def test_database_rejects_game_fields_on_anime(t05_session: Session):
    """追番行带上游戏字段 → 数据库 CHECK 直接拒绝（不靠表单自觉）。"""
    _rejected(t05_session, lambda: make_anime(t05_session, extras={"platform": "PC"}))


def test_database_rejects_anime_fields_on_game(t05_session: Session):
    _rejected(t05_session, lambda: make_game(t05_session, extras={"total_episodes": 12}))


def test_database_rejects_wrong_progress_for_kind(t05_session: Session):
    """「追番：通关」这种无意义状态在数据库层面就不存在。"""
    _rejected(t05_session, lambda: make_anime(t05_session, progress="cleared"))
    _rejected(t05_session, lambda: make_game(t05_session, progress="finished"))


def test_database_rejects_rating_out_of_range(t05_session: Session):
    _rejected(t05_session, lambda: make_anime(t05_session, rating=11))
    _rejected(t05_session, lambda: make_anime(t05_session, rating=0))


def test_database_rejects_episodes_over_total_when_total_is_known(t05_session: Session):
    _rejected(t05_session, lambda: make_anime(t05_session, total_episodes=12, episodes_watched=13))


def test_database_allows_episodes_over_unknown_total(t05_session: Session):
    """总集数未知时「看到第 6 集」必须能存（验收 3）。"""
    entry = make_anime(t05_session, total_episodes=None, episodes_watched=6)
    t05_session.flush()
    assert entry.episodes_watched == 6 and entry.total_episodes is None


def test_check_constraints_are_really_in_the_database(t05_session: Session):
    """约束由真实 PostgreSQL 执行：从 information_schema 里核对它们的存在。"""
    names = set(
        t05_session.execute(
            text(
                "select conname from pg_constraint "
                "where conrelid = 'leisure_entries'::regclass and contype = 'c'"
            )
        ).scalars()
    )
    for expected in (
        "ck_leisure_entries_kind_valid",
        "ck_leisure_entries_status_valid",
        "ck_leisure_entries_progress_matches_kind",
        "ck_leisure_entries_rating_range",
        "ck_leisure_entries_game_has_no_anime_fields",
        "ck_leisure_entries_anime_has_no_game_fields",
        "ck_leisure_entries_episodes_within_total",
    ):
        assert expected in names, f"缺少数据库约束 {expected}：{sorted(names)}"


def test_public_listing_partial_index_exists(t05_session: Session):
    definition = t05_session.execute(
        text("select indexdef from pg_indexes where indexname = 'ix_leisure_entries_public_listing'")
    ).scalar_one()
    # PostgreSQL 会把定义规范化（`(status)::text = 'published'::text`），因此按
    # 语义片段断言而不是逐字比较。
    assert "'published'" in definition
    assert "deleted_at IS NULL" in definition
    assert "kind" in definition and "updated_at" in definition


def test_dto_rejects_cross_kind_fields_at_the_api_layer(
    public_leisure_client, t05_session: Session
):
    """DTO 层的同类规则：给追番传 `platform` 是**字段级 422**，不是 500。"""
    payload = schemas.LeisureCreateIn.model_validate(
        {"kind": "anime", "title": "只有追番字段", "season": "2026 春"}
    )
    assert payload.season == "2026 春"

    with pytest.raises(Exception) as excinfo:
        schemas.LeisureCreateIn.model_validate(
            {"kind": "anime", "title": "混进了游戏字段", "platform": "PC"}
        )
    assert "平台" in str(excinfo.value)


def test_dto_rejects_unknown_episode_progress():
    with pytest.raises(Exception):
        schemas.LeisureCreateIn.model_validate(
            {"kind": "game", "title": "游戏用了追番的状态", "progress": "finished"}
        )
    # 合法的组合可以通过。
    assert (
        schemas.LeisureCreateIn.model_validate(
            {"kind": "game", "title": "正常", "progress": "cleared"}
        ).progress
        == "cleared"
    )


def test_entry_id_is_a_real_uuid_primary_key(t05_session: Session):
    entry = make_anime(t05_session)
    assert isinstance(entry.id, uuid.UUID)
    fetched = t05_session.get(LeisureEntry, entry.id)
    assert fetched is not None
