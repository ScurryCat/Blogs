"""T06 共享测试辅助：建站主、建媒体、建作品 / 相册、走真实 HTTP 管理流程。

刻意不做「直接伪造会话」或「直接改 status 字段」的捷径：管理用例都通过真实端点
（`GET /auth/session` → `POST /auth/login` → 写请求带 Origin + CSRF + If-Match），
因此 CSRF / 版本 / 发布门槛是被真的执行过的（与 T03 的 helpers 同形）。
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Iterator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.auth.models import AdminUser
from app.modules.gallery.models import STATUS_DRAFT as ALBUM_DRAFT
from app.modules.gallery.models import STATUS_PUBLISHED as ALBUM_PUBLISHED
from app.modules.gallery.models import Album, album_media, album_media_sources
from app.modules.projects.models import STATUS_DRAFT, STATUS_PUBLISHED, Project, project_media
from tests.auth.helpers import ORIGIN, login_ok, make_admin, read_session  # noqa: F401
from tests.media.helpers import make_media_row

UTC = timezone.utc

PROJECTS_PATH = "/api/v1/projects"
ADMIN_PROJECTS_PATH = "/api/v1/admin/projects"
ALBUMS_PATH = "/api/v1/gallery/albums"
PHOTOS_PATH = "/api/v1/gallery/photos"
ADMIN_ALBUMS_PATH = "/api/v1/admin/albums"
MEDIA_PATH = "/api/v1/media"


def unique_slug(prefix: str = "project") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def write_headers(csrf_token: str, version: int | None = None) -> dict[str, str]:
    """写请求的公共头：同源 Origin + CSRF（可选 If-Match）。"""
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf_token}
    if version is not None:
        headers["If-Match"] = f'"{version}"'
    return headers


def make_media(session: Session, owner: AdminUser, *, status: str = "ready", **kwargs):
    """插一条媒体记录（默认 ready）。**不写磁盘**：读取字节的用例自己传 root。"""
    return make_media_row(session, owner_id=owner.id, status=status, **kwargs)


def make_project(
    session: Session,
    *,
    slug: str,
    title: str = "测试作品",
    summary: str = "一句话用途",
    status: str = STATUS_DRAFT,
    published_at: datetime | None = None,
    palace_id: uuid.UUID | None = None,
    tech_stack: list[str] | None = None,
    links: list[dict] | None = None,
    maintenance: str = "maintained",
    deleted_at: datetime | None = None,
    created_at: datetime | None = None,
) -> Project:
    """直接插一条作品行（用于读取 / 公开条件的用例）。

    写接口的用例请走真实 HTTP（`create_project`），不要用这个函数绕过校验。
    """
    project = Project(
        slug=slug,
        title=title,
        summary=summary,
        role="发起与实现",
        problem="问题描述",
        tradeoffs="取舍描述",
        outcomes="成果描述",
        tech_stack=list(tech_stack or ["Next.js"]),
        links=list(links or []),
        maintenance=maintenance,
        palace_id=palace_id,
        status=status,
        published_at=(
            published_at
            if published_at is not None
            else (datetime.now(UTC) - timedelta(minutes=5) if status == STATUS_PUBLISHED else None)
        ),
        deleted_at=deleted_at,
    )
    if created_at is not None:
        project.created_at = created_at
    session.add(project)
    session.flush()
    return project


def attach_images(
    session: Session,
    project: Project,
    images: list[tuple[uuid.UUID, int, str]],
) -> None:
    """直接挂图片关系（读取用例用；写用例走 HTTP）。元组是 `(media_id, position, kind)`。"""
    for media_id, position, kind in images:
        session.execute(
            project_media.insert().values(
                project_id=project.id,
                media_id=media_id,
                position=position,
                kind=kind,
                alt=f"图片 {position}",
                caption="",
                taken_on=None,
            )
        )
    session.flush()


def make_album(
    session: Session,
    *,
    slug: str,
    title: str = "测试相册",
    description: str = "说明",
    kind: str = "photo",
    position: int = 0,
    status: str = ALBUM_DRAFT,
    published_at: datetime | None = None,
    deleted_at: datetime | None = None,
    created_at: datetime | None = None,
) -> Album:
    """直接插一条相册行（读取用例用；写用例走 HTTP）。"""
    album = Album(
        slug=slug,
        title=title,
        description=description,
        kind=kind,
        position=position,
        status=status,
        published_at=(
            published_at
            if published_at is not None
            else (datetime.now(UTC) - timedelta(minutes=5) if status == ALBUM_PUBLISHED else None)
        ),
        deleted_at=deleted_at,
    )
    if created_at is not None:
        album.created_at = created_at
    session.add(album)
    session.flush()
    return album


def attach_photos(
    session: Session,
    album: Album,
    photos: list[tuple[uuid.UUID, int, str, date | None]],
    *,
    independent: bool = True,
) -> None:
    """直接挂照片关系。元组是 `(media_id, position, caption, taken_on)`。

    `independent=True`（默认）同时补一条**独立收录来源** —— 对应「相册管理端显式加入」
    与「迁移前已存在的相册图片回填」两种真实状态。第三轮起 `album_media` 只是显示关系，
    没有来源的照片对公众不可见，读取用例必须显式说明来源。
    """
    for media_id, position, caption, taken_on in photos:
        session.execute(
            album_media.insert().values(
                album_id=album.id,
                media_id=media_id,
                position=position,
                alt=f"照片 {position}",
                caption=caption,
                taken_on=taken_on,
            )
        )
        if independent:
            session.execute(
                album_media_sources.insert().values(
                    album_id=album.id,
                    media_id=media_id,
                    moment_id=None,
                )
            )
    session.flush()


def _site_owner(session: Session, *, username: str, password: str) -> AdminUser:
    """取或建一个站主。

    `admin_users.username` 有唯一约束，而每个用例只回滚自己那份事务 ——
    但**同一个用例里可以开两次** `admin_client`（例如「另一个浏览器」场景），
    第二次 `make_admin` 会撞唯一键。这里先查一次，存在就复用，
    避免把「夹具重复建用户」伪装成被测代码的失败。
    """
    from sqlalchemy import select

    existing = session.execute(
        select(AdminUser).where(AdminUser.username == username)
    ).scalars().first()
    if existing is not None:
        return existing
    return make_admin(session, username=username, password=password)


@contextmanager
def admin_client(
    settings,
    session: Session,
    *routers,
    username: str = "owner",
    password: str = "t06-owner-password-123",
    unique: bool = False,
) -> Iterator[tuple[TestClient, AdminUser, str]]:
    """已登录站主的测试客户端，返回 `(client, admin_user, csrf_token)`。

    额外挂上**真实的 auth router**：会话与 CSRF token 都来自真实端点，
    因此 CSRF / Origin / 轮换是被真的执行过的，而不是被测试绕过。

    `unique=True` 时用一个随机用户名，供「同一用例里开两个站主会话」的场景使用。
    """
    from app.modules.auth.router import router as auth_router
    from tests.core.t01_db import module_api_client

    if unique:
        username = f"{username}-{uuid.uuid4().hex[:8]}"
    user = _site_owner(session, username=username, password=password)
    with module_api_client(settings, session, ("auth", auth_router), *routers) as client:
        payload = login_ok(client, username=username, password=password)
        yield client, user, payload["csrf_token"]


@contextmanager
def anonymous_client(settings, session: Session, *routers) -> Iterator[TestClient]:
    """匿名访客客户端：挂真实 auth router，但**不读** `/auth/session`。"""
    from app.modules.auth.router import router as auth_router
    from tests.core.t01_db import module_api_client

    with module_api_client(settings, session, ("auth", auth_router), *routers) as client:
        yield client


def t06_routers() -> tuple[tuple[str, object], ...]:
    """T06 的两个 router，按固定顺序返回。

    用法：`anonymous_client(settings, session, *t06_routers())`。
    刻意不是生成器 / 上下文管理器 —— 那样 `*t06_routers()` 会炸
    （`TypeError: Value after * must be an iterable, not _GeneratorContextManager`）。
    """
    from app.modules.gallery.router import router as gallery_router
    from app.modules.projects.router import router as projects_router

    return (("projects", projects_router), ("gallery", gallery_router))


def create_project(
    client: TestClient,
    csrf_token: str,
    *,
    slug: str,
    title: str = "新作品",
    summary: str = "一句话用途",
    images: list[dict] | None = None,
    tech_stack: list[str] | None = None,
    links: list[dict] | None = None,
    palace_id: str | None = None,
    maintenance: str = "maintained",
):
    body: dict[str, object] = {
        "slug": slug,
        "title": title,
        "summary": summary,
        "maintenance": maintenance,
    }
    if images is not None:
        body["images"] = images
    if tech_stack is not None:
        body["tech_stack"] = tech_stack
    if links is not None:
        body["links"] = links
    if palace_id is not None:
        body["palace_id"] = palace_id
    return client.post(ADMIN_PROJECTS_PATH, json=body, headers=write_headers(csrf_token))


def publish_project(client: TestClient, csrf_token: str, project_id: str, version: int):
    return client.post(
        f"{ADMIN_PROJECTS_PATH}/{project_id}/publish",
        headers=write_headers(csrf_token, version),
    )


def unpublish_project(client: TestClient, csrf_token: str, project_id: str, version: int):
    return client.post(
        f"{ADMIN_PROJECTS_PATH}/{project_id}/unpublish",
        headers=write_headers(csrf_token, version),
    )


def image_payload(
    media_ids: list[uuid.UUID], *, kinds: list[str] | None = None, alt_prefix: str = "图"
) -> list[dict]:
    kinds = kinds or ["detail"] * len(media_ids)
    return [
        {
            "media_id": str(media_id),
            "position": index,
            "kind": kinds[index] if index < len(kinds) else "detail",
            "alt": f"{alt_prefix}{index + 1}",
        }
        for index, media_id in enumerate(media_ids)
    ]


def photo_payload(
    media_ids: list[uuid.UUID], *, taken_on: list[str | None] | None = None
) -> list[dict]:
    return [
        {
            "media_id": str(media_id),
            "position": index,
            "alt": f"照片 {index + 1}",
            "caption": f"说明 {index + 1}",
            "taken_on": (taken_on[index] if taken_on and index < len(taken_on) else None),
        }
        for index, media_id in enumerate(media_ids)
    ]


__all__ = [
    "ADMIN_ALBUMS_PATH",
    "ADMIN_PROJECTS_PATH",
    "ALBUMS_PATH",
    "ALBUM_DRAFT",
    "ALBUM_PUBLISHED",
    "MEDIA_PATH",
    "ORIGIN",
    "PHOTOS_PATH",
    "PROJECTS_PATH",
    "admin_client",
    "anonymous_client",
    "attach_images",
    "attach_photos",
    "create_project",
    "image_payload",
    "login_ok",
    "make_admin",
    "make_album",
    "make_media",
    "make_project",
    "photo_payload",
    "publish_project",
    "read_session",
    "t06_routers",
    "unique_slug",
    "unpublish_project",
    "write_headers",
]
