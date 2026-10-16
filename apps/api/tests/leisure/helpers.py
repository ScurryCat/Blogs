"""放课后测试辅助：造追番 / 游戏条目与站主登录。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.leisure.models import STATUS_DRAFT, STATUS_PUBLISHED, LeisureEntry
from tests.auth.helpers import login_ok, make_admin, read_session  # noqa: F401

UTC = timezone.utc


def unique_title(prefix: str = "条目") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def make_anime(
    session: Session,
    *,
    title: str | None = None,
    progress: str = "watching",
    rating: int | None = None,
    notes: str = "",
    notes_have_spoilers: bool = False,
    season: str | None = "2026 春",
    total_episodes: int | None = 12,
    episodes_watched: int | None = 6,
    last_watched_on: date | None = None,
    airing: bool | None = True,
    status: str = STATUS_DRAFT,
    published_at: datetime | None = None,
    cover_media_id=None,
    deleted_at: datetime | None = None,
    commit: bool = False,
    extras: dict | None = None,
) -> LeisureEntry:
    entry = LeisureEntry(
        kind="anime",
        title=title or unique_title("追番"),
        progress=progress,
        rating=rating,
        notes=notes,
        notes_have_spoilers=notes_have_spoilers,
        season=season,
        total_episodes=total_episodes,
        episodes_watched=episodes_watched,
        last_watched_on=last_watched_on,
        airing=airing,
        status=status,
        published_at=published_at,
        cover_media_id=cover_media_id,
        deleted_at=deleted_at,
    )
    # `extras` 只给约束测试用：故意写入「另一类型专属」的字段，验证数据库 CHECK
    # 真的拦得住（正常路径永远用不到它）。
    for name, value in (extras or {}).items():
        setattr(entry, name, value)
    session.add(entry)
    session.flush()
    if commit:
        session.commit()
    return entry


def make_game(
    session: Session,
    *,
    title: str | None = None,
    progress: str = "playing",
    rating: int | None = None,
    notes: str = "",
    notes_have_spoilers: bool = False,
    platform: str = "PC",
    playtime_minutes: int | None = None,
    started_on: date | None = None,
    completed_on: date | None = None,
    all_achievements: bool | None = None,
    status: str = STATUS_DRAFT,
    published_at: datetime | None = None,
    cover_media_id=None,
    deleted_at: datetime | None = None,
    commit: bool = False,
    extras: dict | None = None,
) -> LeisureEntry:
    entry = LeisureEntry(
        kind="game",
        title=title or unique_title("游戏"),
        progress=progress,
        rating=rating,
        notes=notes,
        notes_have_spoilers=notes_have_spoilers,
        platform=platform,
        playtime_minutes=playtime_minutes,
        started_on=started_on,
        completed_on=completed_on,
        all_achievements=all_achievements,
        status=status,
        published_at=published_at,
        cover_media_id=cover_media_id,
        deleted_at=deleted_at,
    )
    # `extras` 只给约束测试用：故意写入「另一类型专属」的字段，验证数据库 CHECK
    # 真的拦得住（正常路径永远用不到它）。
    for name, value in (extras or {}).items():
        setattr(entry, name, value)
    session.add(entry)
    session.flush()
    if commit:
        session.commit()
    return entry


def make_public_anime(session: Session, **kwargs) -> LeisureEntry:
    kwargs.setdefault("status", STATUS_PUBLISHED)
    kwargs.setdefault("published_at", datetime.now(UTC) - timedelta(hours=1))
    return make_anime(session, **kwargs)


def make_public_game(session: Session, **kwargs) -> LeisureEntry:
    kwargs.setdefault("status", STATUS_PUBLISHED)
    kwargs.setdefault("published_at", datetime.now(UTC) - timedelta(hours=1))
    return make_game(session, **kwargs)


def admin_login(client: TestClient, session: Session, **kwargs) -> dict:
    """建站主 → 走预登录 → 登录（`kwargs` 同时用于建号与登录，便于用唯一用户名）。"""
    make_admin(session, **kwargs)
    return login_ok(client, **kwargs)


def error_code(response) -> str | None:
    try:
        payload = response.json()
    except Exception:  # pragma: no cover
        return None
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        return payload["error"].get("code")
    return None


def assert_error(response, *, status: int, code: str) -> dict:
    payload = response.json()
    assert response.status_code == status, f"期望 {status}，实际 {response.status_code}：{payload}"
    assert set(payload) == {"error", "request_id"}, payload
    assert set(payload["error"]) == {"code", "message", "fields"}, payload
    assert payload["error"]["code"] == code, payload
    assert isinstance(payload["error"]["fields"], dict), payload
    assert payload["request_id"], payload
    return payload


def anime_payload(**overrides) -> dict:
    payload = {
        "kind": "anime",
        "title": unique_title("追番"),
        "progress": "watching",
        "season": "2026 春",
        "total_episodes": 12,
        "episodes_watched": 3,
    }
    payload.update(overrides)
    return payload


def game_payload(**overrides) -> dict:
    payload = {
        "kind": "game",
        "title": unique_title("游戏"),
        "progress": "playing",
        "platform": "PC",
    }
    payload.update(overrides)
    return payload
