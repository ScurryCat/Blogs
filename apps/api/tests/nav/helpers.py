"""T04 测试辅助：造专题、别名、有序文章关系与站主登录。

刻意保留两条纪律：

  - 每个用例用**唯一 slug**（`unique_slug()`），即使临时库里还留着别的用例提交过的
    专题，断言也不会串味；
  - 管理端一律走真实 HTTP 登录流程（复用 `tests.auth.helpers`），不伪造会话。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.text import normalize_for_match
from app.modules.nav.models import STATUS_DRAFT, STATUS_PUBLISHED, Palace, PalaceAlias, PalacePost
from app.modules.posts.models import Post
from tests.auth.helpers import csrf_headers, login_ok, make_admin, read_session  # noqa: F401

UTC = timezone.utc


def unique_slug(prefix: str = "palace") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def unique_keyword(prefix: str = "值") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def make_palace(
    session: Session,
    *,
    slug: str | None = None,
    title: str = "测试殿堂",
    summary: str = "简介",
    name: str = "ScurryCat",
    location: str = "个人博客",
    cognition: str = "据点",
    status: str = STATUS_DRAFT,
    published_at: datetime | None = None,
    aliases: tuple[tuple[str, str], ...] = (),
    posts: tuple[Post, ...] = (),
    deleted_at: datetime | None = None,
    commit: bool = False,
) -> Palace:
    palace = Palace(
        slug=slug or unique_slug(),
        title=title,
        summary=summary,
        name=name,
        location=location,
        cognition=cognition,
        status=status,
        published_at=published_at,
        deleted_at=deleted_at,
    )
    session.add(palace)
    session.flush()
    for field, value in aliases:
        session.add(
            PalaceAlias(
                palace_id=palace.id,
                field=field,
                value=value,
                normalized_value=normalize_for_match(value),
            )
        )
    for position, post in enumerate(posts):
        session.add(PalacePost(palace_id=palace.id, post_id=post.id, position=position))
    session.flush()
    if commit:
        session.commit()
    return palace


def make_published_palace(session: Session, *, posts: tuple[Post, ...], **kwargs) -> Palace:
    """已发布 + 已到发布时间的专题（公开可见的前提是有公开文章）。"""
    kwargs.setdefault("status", STATUS_PUBLISHED)
    kwargs.setdefault("published_at", datetime.now(UTC) - timedelta(hours=1))
    return make_palace(session, posts=posts, **kwargs)


def admin_login(client: TestClient, session: Session, **kwargs) -> dict:
    """建站主 → 走预登录 → 登录，返回登录后的会话状态（含 csrf_token）。"""
    make_admin(session, **kwargs)
    return login_ok(client)


def write_headers(csrf_token: str) -> dict[str, str]:
    return csrf_headers(csrf_token)


# --- 错误契约断言（与 tests/core/t01_db.py 同形，避免跨包导入 T01 的私有夹具） ----


def error_code(response) -> str | None:
    """取错误响应里的 code，便于断言而不依赖文案。"""
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
    """管理端新建专题的合法请求体（用例只覆盖自己关心的字段）。"""
    payload = {
        "slug": unique_slug(),
        "title": "怪盗据点工程",
        "summary": "把博客改造成怪盗的基地",
        "keywords": {"name": "ScurryCat", "location": "个人博客", "cognition": "据点"},
        "aliases": [
            {"field": "name", "value": "PHANTOM"},
            {"field": "cognition", "value": "Hideout"},
        ],
        "post_ids": [],
    }
    payload.update(overrides)
    return payload
