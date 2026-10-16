"""手记测试辅助：造日记、图片关系与站主登录。

纪律（与 nav / moments 的辅助一致）：

  - 每个用例用唯一标题 / 唯一日期偏移，即使临时库里还留着别的用例提交过的记录，
    断言也不会串味；
  - 管理端一律走真实 HTTP 登录流程（复用 `tests.auth.helpers`），不伪造会话。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.journal.models import (
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
    JournalEntry,
    journal_entry_media,
)
from tests.auth.helpers import csrf_headers, login_ok, make_admin, read_session  # noqa: F401

UTC = timezone.utc


def unique_title(prefix: str = "手记") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def make_entry(
    session: Session,
    *,
    entry_date: date | None = None,
    title: str | None = None,
    content_md: str = "今天把手机应用接好了。",
    mood: str = "平静",
    location: str = "四轩茶屋",
    status: str = STATUS_DRAFT,
    visibility: str = VISIBILITY_PRIVATE,
    post_id=None,
    images: tuple[tuple[object, int, str], ...] = (),
    published_at: datetime | None = None,
    deleted_at: datetime | None = None,
    commit: bool = False,
) -> JournalEntry:
    entry = JournalEntry(
        entry_date=entry_date or date(2026, 10, 16),
        title=title if title is not None else unique_title(),
        content_md=content_md,
        mood=mood,
        location=location,
        status=status,
        visibility=visibility,
        post_id=post_id,
        published_at=published_at,
        deleted_at=deleted_at,
    )
    session.add(entry)
    session.flush()
    for media, position, alt in images:
        session.execute(
            journal_entry_media.insert().values(
                entry_id=entry.id, media_id=media.id, position=position, alt=alt
            )
        )
    session.flush()
    if commit:
        session.commit()
    return entry


def make_public_entry(session: Session, **kwargs) -> JournalEntry:
    """公开可见的日记：published + public + 未删除。"""
    kwargs.setdefault("status", STATUS_PUBLISHED)
    kwargs.setdefault("visibility", VISIBILITY_PUBLIC)
    kwargs.setdefault("published_at", datetime.now(UTC) - timedelta(hours=1))
    return make_entry(session, **kwargs)


def admin_login(client: TestClient, session: Session, **kwargs) -> dict:
    """建站主 → 走预登录 → 登录，返回登录后的会话状态（含 csrf_token）。

    `kwargs` 同时用于建号与登录，因此调用方可以传 `username=` 让每个用例用**唯一**
    用户（临时库在会话内是共享的，重名会撞唯一约束）。
    """
    make_admin(session, **kwargs)
    return login_ok(client, **kwargs)


# --- 错误契约断言（与 tests/core/t01_db.py 同形，避免跨包导入 T01 的私有夹具） ----


def error_code(response) -> str | None:
    try:
        payload = response.json()
    except Exception:  # pragma: no cover - 非 JSON 响应
        return None
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        return payload["error"].get("code")
    return None


def assert_error(response, *, status: int, code: str) -> dict:
    """断言错误契约（状态码 + code + 信封形状），并返回响应体。"""
    payload = response.json()
    assert response.status_code == status, f"期望 {status}，实际 {response.status_code}：{payload}"
    assert set(payload) == {"error", "request_id"}, payload
    assert set(payload["error"]) == {"code", "message", "fields"}, payload
    assert payload["error"]["code"] == code, payload
    assert isinstance(payload["error"]["fields"], dict), payload
    assert payload["request_id"], payload
    return payload


def create_payload(**overrides) -> dict:
    """管理端新建手记的合法请求体。

    **没有** status / visibility 字段：新建永远是 draft + private（07 §3）。
    """
    payload = {
        "entry_date": "2026-10-16",
        "title": unique_title(),
        "content_md": "## 今天\n\n把追番记录接上了。",
        "mood": "还不错",
        "location": "四轩茶屋",
        "images": [],
    }
    payload.update(overrides)
    return payload
