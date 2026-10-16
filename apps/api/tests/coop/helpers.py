"""T07 测试辅助：造友链、造标签、走真实站主登录流程。

两条纪律（与 T04 一致）：

  - 每个用例的站名 / 标签都带随机后缀，即使临时库里还留着别的用例提交过的数据，
    断言也不会串味；
  - 管理端一律走真实 HTTP 登录流程（复用 `tests.auth.helpers`），不伪造会话。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.text import normalize_for_match
from app.modules.coop.models import (
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    FriendLink,
    FriendLinkTag,
)
from tests.auth.helpers import csrf_headers, login_ok, make_admin, read_session  # noqa: F401

UTC = timezone.utc

SAFE_URL = "https://example.com/"


def unique_name(prefix: str = "友链") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def unique_tag(prefix: str = "标签") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def make_link(
    session: Session,
    *,
    name: str | None = None,
    url: str = SAFE_URL,
    summary: str = "一个真实的测试站点",
    story: str | None = None,
    arcana: str | None = None,
    tags: tuple[str, ...] = (),
    avatar_media_id: uuid.UUID | None = None,
    position: int = 0,
    status: str = STATUS_DRAFT,
    published_at: datetime | None = None,
    deleted_at: datetime | None = None,
    commit: bool = False,
) -> FriendLink:
    link = FriendLink(
        name=name or unique_name(),
        url=url,
        summary=summary,
        story=story,
        arcana=arcana,
        # 与 service.resolve_avatar_media_id 的返回值同型：UUID 而不是字符串。
        avatar_media_id=uuid.UUID(str(avatar_media_id)) if avatar_media_id else None,
        position=position,
        status=status,
        published_at=published_at,
        deleted_at=deleted_at,
    )
    session.add(link)
    session.flush()
    for tag in tags:
        session.add(
            FriendLinkTag(
                friend_link_id=link.id, name=tag, normalized=normalize_for_match(tag)
            )
        )
    session.flush()
    if commit:
        session.commit()
    return link


def make_published_link(session: Session, **kwargs) -> FriendLink:
    """已发布 + 已到发布时间的友链（公开可见的最小条件）。"""
    kwargs.setdefault("status", STATUS_PUBLISHED)
    kwargs.setdefault("published_at", datetime.now(UTC) - timedelta(hours=1))
    return make_link(session, **kwargs)


def admin_login(client: TestClient, session: Session, **kwargs) -> dict:
    """建站主 → 走预登录 → 登录，返回登录后的会话状态（含 csrf_token）。"""
    make_admin(session, **kwargs)
    return login_ok(client)


def write_headers(csrf_token: str) -> dict[str, str]:
    return csrf_headers(csrf_token)


# --- 错误契约断言（与 tests/nav/helpers.py 同形，避免跨包导入别人的私有夹具） ----


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
    """管理端新建友链的合法请求体（用例只覆盖自己关心的字段）。"""
    payload = {
        "name": unique_name(),
        "url": SAFE_URL,
        "summary": "写前端与算法笔记的个人站点",
        "tags": [unique_tag("前端"), unique_tag("生活")],
        "position": 0,
    }
    payload.update(overrides)
    return payload
