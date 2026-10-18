"""P5-C1 测试辅助：真实 HTTP 管理流程 + 直接构造读取用例需要的行。

管理用例都走真实端点（`GET /auth/session` → `POST /auth/login` → 写请求带
Origin + CSRF + If-Match），因此 CSRF / Origin / 版本 / 双版本检查是被真的
执行过的，而不是被测试绕过。

只有「读取 / 公开条件 / 迁移」类用例才直接插行（明确标注），写路径一律走 HTTP。
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import AdminUser
from app.modules.gallery.models import Album
from app.modules.journal.models import (
    JournalEntry,
    journal_entry_media,
)
from app.modules.media.models import Media
from app.modules.moments.models import Moment, moment_media
from tests.auth.helpers import ORIGIN, login_ok, make_admin, read_session
from tests.core.t01_db import module_api_client
from tests.media.helpers import make_media_row

UTC = timezone.utc

WORK_DRAFTS_PATH = "/api/v1/admin/work-drafts"
MEDIA_PATH = "/api/v1/admin/media"
PUBLIC_MEDIA_PATH = "/api/v1/media"

DEFAULT_PASSWORD = "c1-owner-password-123"


# --- 请求辅助 ---------------------------------------------------------------


def write_headers(csrf_token: str, *, draft_version: int | None = None) -> dict[str, str]:
    """写请求公共头：同源 Origin + CSRF（可选 If-Match 草稿版本）。"""
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf_token}
    if draft_version is not None:
        headers["If-Match"] = f'"{draft_version}"'
    return headers


def create_draft(
    client: TestClient,
    csrf_token: str,
    *,
    content_type: str,
    target_id: str | None = None,
    data: dict | None = None,
    images: list | None = None,
):
    body: dict = {"content_type": content_type}
    if target_id is not None:
        body["target_id"] = target_id
    if data is not None:
        body["data"] = data
    if images is not None:
        body["images"] = images
    return client.post(WORK_DRAFTS_PATH, json=body, headers=write_headers(csrf_token))


def patch_draft(
    client: TestClient,
    csrf_token: str,
    draft_id: str,
    *,
    draft_version: int,
    data: dict | None = None,
    images: list | None = None,
):
    body: dict = {}
    if data is not None:
        body["data"] = data
    if images is not None:
        body["images"] = images
    return client.patch(
        f"{WORK_DRAFTS_PATH}/{draft_id}",
        json=body,
        headers=write_headers(csrf_token, draft_version=draft_version),
    )


def commit_draft(
    client: TestClient,
    csrf_token: str,
    draft_id: str,
    *,
    draft_version: int,
    action: str,
    expected_target_version: int | None = None,
    commit_key: str | None = None,
):
    body: dict = {
        "action": action,
        "commit_key": commit_key or str(uuid.uuid4()),
    }
    if expected_target_version is not None:
        body["expected_target_version"] = expected_target_version
    return client.post(
        f"{WORK_DRAFTS_PATH}/{draft_id}/commit",
        json=body,
        headers=write_headers(csrf_token, draft_version=draft_version),
    )


def discard_draft(client: TestClient, csrf_token: str, draft_id: str):
    return client.delete(
        f"{WORK_DRAFTS_PATH}/{draft_id}", headers=write_headers(csrf_token)
    )


# --- 数据构造（读取用例专用） ------------------------------------------------


def make_media(session: Session, owner: AdminUser, **kwargs) -> Media:
    """插一条媒体记录（默认 ready，不写磁盘）。"""
    return make_media_row(session, owner_id=owner.id, **kwargs)


def make_album(
    session: Session,
    *,
    title: str = "测试相册",
    status: str = "draft",
    deleted_at: datetime | None = None,
) -> Album:
    album = Album(
        slug=f"c1-album-{uuid.uuid4().hex[:10]}",
        title=title,
        status=status,
        deleted_at=deleted_at,
    )
    session.add(album)
    session.flush()
    return album


def make_moment(
    session: Session,
    owner: AdminUser,
    *,
    text: str = "已有动态",
    status: str = "draft",
    published_at: datetime | None = None,
    deleted_at: datetime | None = None,
) -> Moment:
    """直接插一条正式动态（读取 / 编辑目标用例专用，写路径一律走 commit）。"""
    if status == "published" and published_at is None:
        published_at = datetime.now(UTC) - timedelta(minutes=5)
    moment = Moment(
        author_id=owner.id,
        text=text,
        status=status,
        published_at=published_at,
        deleted_at=deleted_at,
    )
    session.add(moment)
    session.flush()
    return moment


def attach_moment_images(
    session: Session, moment: Moment, refs: list[tuple[uuid.UUID, int, str]]
) -> None:
    for media_id, position, alt in refs:
        session.execute(
            moment_media.insert().values(
                moment_id=moment.id, media_id=media_id, position=position, alt=alt
            )
        )
    session.flush()


def make_journal_entry(
    session: Session,
    *,
    entry_date: date | None = None,
    title: str = "已有手记",
    content_md: str = "已有正文",
    status: str = "draft",
    visibility: str = "private",
    deleted_at: datetime | None = None,
) -> JournalEntry:
    entry = JournalEntry(
        entry_date=entry_date or date(2026, 10, 18),
        title=title,
        content_md=content_md,
        status=status,
        visibility=visibility,
        published_at=(
            datetime.now(UTC) - timedelta(minutes=5) if status == "published" else None
        ),
        deleted_at=deleted_at,
    )
    session.add(entry)
    session.flush()
    return entry


def attach_journal_images(
    session: Session, entry: JournalEntry, refs: list[tuple[uuid.UUID, int, str]]
) -> None:
    for media_id, position, alt in refs:
        session.execute(
            journal_entry_media.insert().values(
                entry_id=entry.id, media_id=media_id, position=position, alt=alt
            )
        )
    session.flush()


# --- 已登录站主客户端 -------------------------------------------------------


@contextmanager
def admin_client(
    settings,
    session: Session,
    *,
    username: str = "owner",
    password: str = DEFAULT_PASSWORD,
    extra_routers: tuple = (),
) -> Iterator[tuple[TestClient, AdminUser, str]]:
    """已登录站主客户端：`(client, admin_user, csrf_token)`。

    挂真实 auth router：Cookie 与 CSRF token 都来自真实登录响应，
    因此 CSRF / Origin / 会话轮换是被真的执行过的。
    """
    from app.modules.auth.router import router as auth_router
    from app.modules.media.router import router as media_router
    from app.modules.work_drafts.router import router as work_drafts_router

    # 同一个测试里可能多次打开同一站主的客户端：已存在就直接复用。
    user = session.execute(
        select(AdminUser).where(AdminUser.username == username)
    ).scalars().first()
    if user is None:
        user = make_admin(session, username=username, password=password)
    with module_api_client(
        settings,
        session,
        ("auth", auth_router),
        ("media", media_router),
        ("work-drafts", work_drafts_router),
        *extra_routers,
    ) as client:
        payload = login_ok(client, username=username, password=password)
        yield client, user, payload["csrf_token"]
