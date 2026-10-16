"""T03 测试辅助：建站主、建媒体、建动态、走真实 HTTP 管理流程。

刻意不做「直接伪造会话」或「直接改 status 字段」的捷径：管理用例都通过真实端点
（`GET /auth/session` → `POST /auth/login` → 写请求带 Origin + CSRF + If-Match），
因此 CSRF / 版本 / 发布门槛是被真的执行过的。
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.auth.models import AdminUser
from app.modules.moments.models import STATUS_DRAFT, STATUS_PUBLISHED, Moment, moment_media, moment_tags
from app.modules.tags import service as tags_service
from tests.auth.helpers import ORIGIN, login_ok, make_admin, read_session
from tests.media.helpers import make_media_row

UTC = timezone.utc

MOMENTS_PATH = "/api/v1/moments"
ADMIN_MOMENTS_PATH = "/api/v1/admin/moments"


def unique_tag(prefix: str = "T03标签") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def write_headers(csrf_token: str, version: int | None = None) -> dict[str, str]:
    """写请求的公共头：同源 Origin + CSRF（可选 If-Match）。"""
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf_token}
    if version is not None:
        headers["If-Match"] = f'"{version}"'
    return headers


def make_media(session: Session, owner: AdminUser, *, status: str = "ready", **kwargs):
    """插一条媒体记录（默认 ready）。**不写磁盘**：读取字节的用例自己传 root。"""
    return make_media_row(session, owner_id=owner.id, status=status, **kwargs)


def make_moment(
    session: Session,
    owner: AdminUser,
    *,
    text: str = "测试动态",
    status: str = STATUS_DRAFT,
    published_at: datetime | None = None,
    tags: tuple[str, ...] = (),
    deleted_at: datetime | None = None,
    created_at: datetime | None = None,
) -> Moment:
    """直接插一条动态行（用于读取 / 公开条件的用例）。

    写接口的用例请走真实 HTTP（`create_draft`），不要用这个函数绕过校验。
    """
    moment = Moment(
        author_id=owner.id,
        text=text,
        status=status,
        published_at=(
            published_at
            if published_at is not None
            else (datetime.now(UTC) - timedelta(minutes=5) if status == STATUS_PUBLISHED else None)
        ),
        deleted_at=deleted_at,
    )
    if created_at is not None:
        moment.created_at = created_at
    session.add(moment)
    session.flush()
    if tags:
        for tag in tags_service.get_or_create_tags(session, list(tags)):
            session.execute(
                moment_tags.insert().values(moment_id=moment.id, tag_id=tag.id)
            )
    session.flush()
    return moment


def attach_images(session: Session, moment: Moment, images: list[tuple[uuid.UUID, int, str]]) -> None:
    """直接挂图片关系（读取用例用；写用例走 HTTP）。"""
    for media_id, position, alt in images:
        session.execute(
            moment_media.insert().values(
                moment_id=moment.id, media_id=media_id, position=position, alt=alt
            )
        )
    session.flush()


@contextmanager
def admin_client(
    settings,
    session: Session,
    *routers,
    username: str = "owner",
    password: str = "t03-owner-password-123",
) -> Iterator[tuple[TestClient, AdminUser, str]]:
    """已登录站主的测试客户端。

    返回 `(client, admin_user, csrf_token)`；CSRF token 来自真实登录响应。

    这里额外挂上**真实的 auth router**：会话与 CSRF token 都来自真实端点
    （`GET /auth/session` → `POST /auth/login`），因此 CSRF / Origin / 轮换
    是被真的执行过的，而不是被测试绕过。auth 不是被测对象，只是登录手段。
    """
    from app.modules.auth.router import router as auth_router
    from tests.core.t01_db import module_api_client

    user = make_admin(session, username=username, password=password)
    with module_api_client(settings, session, ("auth", auth_router), *routers) as client:
        payload = login_ok(client, username=username, password=password)
        yield client, user, payload["csrf_token"]


@contextmanager
def anonymous_client(settings, session: Session, *routers) -> Iterator[TestClient]:
    """匿名访客客户端：挂真实 auth router，但**不读** `/auth/session`。

    因此连预登录 Cookie 都没有 —— 「未登录上传 / 编辑被拒绝」测的就是这个状态。
    """
    from app.modules.auth.router import router as auth_router
    from tests.core.t01_db import module_api_client

    with module_api_client(settings, session, ("auth", auth_router), *routers) as client:
        yield client


def create_draft(
    client: TestClient,
    csrf_token: str,
    *,
    text: str = "",
    images: list[dict] | None = None,
    tags: list[str] | None = None,
):
    body: dict[str, object] = {"text": text}
    if images is not None:
        body["images"] = images
    if tags is not None:
        body["tags"] = tags
    return client.post(
        ADMIN_MOMENTS_PATH, json=body, headers=write_headers(csrf_token)
    )


def publish(client: TestClient, csrf_token: str, moment_id: str, version: int):
    return client.post(
        f"{ADMIN_MOMENTS_PATH}/{moment_id}/publish",
        headers=write_headers(csrf_token, version),
    )


def unpublish(client: TestClient, csrf_token: str, moment_id: str, version: int):
    return client.post(
        f"{ADMIN_MOMENTS_PATH}/{moment_id}/unpublish",
        headers=write_headers(csrf_token, version),
    )


def image_payload(media_ids: list[uuid.UUID], *, alt_prefix: str = "图") -> list[dict]:
    return [
        {"media_id": str(media_id), "position": index, "alt": f"{alt_prefix}{index + 1}"}
        for index, media_id in enumerate(media_ids)
    ]


__all__ = [
    "ADMIN_MOMENTS_PATH",
    "MOMENTS_PATH",
    "ORIGIN",
    "admin_client",
    "anonymous_client",
    "attach_images",
    "create_draft",
    "image_payload",
    "login_ok",
    "make_admin",
    "make_media",
    "make_moment",
    "publish",
    "read_session",
    "unique_tag",
    "unpublish",
    "write_headers",
]
