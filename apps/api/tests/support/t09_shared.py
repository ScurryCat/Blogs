"""T09 共享测试辅助：建技能、建问题记录、走真实 HTTP 管理流程（技能 + 问题记录）。

刻意不做「直接伪造会话」或「直接改 status 字段」的捷径：管理用例都通过真实端点
（`GET /auth/session` → `POST /auth/login` → 写请求带 Origin + CSRF + If-Match），
因此 CSRF / 版本 / 发布门槛是被真的执行过的（与 T03 / T06 的 helpers 同形）。

依赖 T06 的作品与 T01 的文章：两者都通过真实模型插行（读取用例），
写接口的用例走真实 HTTP（`create_skill` / `create_record`）。
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.auth.models import AdminUser
from app.modules.exploration.models import (
    STATUS_DRAFT as RECORD_DRAFT,
)
from app.modules.exploration.models import (
    STATUS_PUBLISHED as RECORD_PUBLISHED,
)
from app.modules.exploration.models import (
    WORK_INVESTIGATING,
    WORK_PENDING,
    WORK_RESOLVED,
    ExplorationRecord,
    exploration_record_posts,
    exploration_record_projects,
)
from app.modules.projects.models import Project
from app.modules.skills.models import (
    STATUS_DRAFT as SKILL_DRAFT,
)
from app.modules.skills.models import (
    STATUS_PUBLISHED as SKILL_PUBLISHED,
)
from app.modules.skills.models import Skill, project_skills
from tests.auth.helpers import ORIGIN, login_ok, make_admin, read_session  # noqa: F401
from tests.posts.helpers import make_post  # noqa: F401  —— 供探索用例造关联文章

UTC = timezone.utc

SKILLS_PATH = "/api/v1/skills"
ADMIN_SKILLS_PATH = "/api/v1/admin/skills"
RECORDS_PATH = "/api/v1/exploration/records"
ADMIN_RECORDS_PATH = "/api/v1/admin/exploration/records"


def unique_slug(prefix: str = "skill") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def write_headers(csrf_token: str, version: int | None = None) -> dict[str, str]:
    """写请求的公共头：同源 Origin + CSRF（可选 If-Match）。"""
    headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf_token}
    if version is not None:
        headers["If-Match"] = f'"{version}"'
    return headers


# --- 直接插行（读取 / 公开条件的用例；写用例走 HTTP）-----------------------


def make_skill(
    session: Session,
    *,
    slug: str,
    name: str = "算法与数据结构",
    domain: str = "algorithm",
    scope: str = "能独立完成常见数据结构与基础图论实现。",
    evidence: str = "ACM 训练与题解记录。",
    links: list[dict] | None = None,
    position: int = 0,
    status: str = SKILL_DRAFT,
    published_at: datetime | None = None,
    deleted_at: datetime | None = None,
    created_at: datetime | None = None,
) -> Skill:
    """直接插一条技能行。写接口的用例请走真实 HTTP，不要用它绕过校验。"""
    skill = Skill(
        slug=slug,
        name=name,
        domain=domain,
        scope=scope,
        evidence=evidence,
        links=list(links or []),
        position=position,
        status=status,
        published_at=(
            published_at
            if published_at is not None
            else (datetime.now(UTC) - timedelta(minutes=5) if status == SKILL_PUBLISHED else None)
        ),
        deleted_at=deleted_at,
    )
    if created_at is not None:
        skill.created_at = created_at
    session.add(skill)
    session.flush()
    return skill


def attach_projects(
    session: Session, skill: Skill, pairs: list[tuple[Project, int]]
) -> None:
    """把技能关联到若干作品（读取用例用；写用例走 HTTP）。"""
    for project, position in pairs:
        session.execute(
            project_skills.insert().values(
                skill_id=skill.id, project_id=project.id, position=position
            )
        )
    session.flush()


def make_record(
    session: Session,
    *,
    slug: str,
    title: str = "为什么动画结束后无法点击页面",
    background: str = "过渡遮罩结束后指针事件没有恢复。",
    attempts: str = "检查了遮罩的卸载时机与事件监听注册顺序。",
    outcome: str = "",
    evidence_links: list[dict] | None = None,
    work_status: str = WORK_PENDING,
    status: str = RECORD_DRAFT,
    published_at: datetime | None = None,
    resolved_at: datetime | None = None,
    deleted_at: datetime | None = None,
    created_at: datetime | None = None,
) -> ExplorationRecord:
    """直接插一条问题记录行（读取 / 公开条件的用例）。

    注意：这里**不**替调用方补齐「已解决必须有结果说明」的语义约束 ——
    模型层没有那条 CHECK（它是跨行的），夹具照实插入，由 service 用例去验证行为。
    """
    record = ExplorationRecord(
        slug=slug,
        title=title,
        background=background,
        attempts=attempts,
        outcome=outcome,
        evidence_links=list(evidence_links or []),
        work_status=work_status,
        resolved_at=resolved_at,
        status=status,
        published_at=(
            published_at
            if published_at is not None
            else (datetime.now(UTC) - timedelta(minutes=5) if status == RECORD_PUBLISHED else None)
        ),
        deleted_at=deleted_at,
    )
    if created_at is not None:
        record.created_at = created_at
    session.add(record)
    session.flush()
    return record


def attach_record_posts(
    session: Session, record: ExplorationRecord, pairs: list[tuple[uuid.UUID, int]]
) -> None:
    for post_id, position in pairs:
        session.execute(
            exploration_record_posts.insert().values(
                record_id=record.id, post_id=post_id, position=position
            )
        )
    session.flush()


def attach_record_projects(
    session: Session, record: ExplorationRecord, pairs: list[tuple[Project, int]]
) -> None:
    for project, position in pairs:
        session.execute(
            exploration_record_projects.insert().values(
                record_id=record.id, project_id=project.id, position=position
            )
        )
    session.flush()


# --- 真实 HTTP 管理客户端 ---------------------------------------------------


def t09_routers() -> tuple[tuple[str, object], ...]:
    """T09 的两个 router，按固定顺序返回（写法与 T06 的 `t06_routers()` 一致）。"""
    from app.modules.exploration.router import router as exploration_router
    from app.modules.skills.router import router as skills_router

    return (("skills", skills_router), ("exploration", exploration_router))


def _site_owner(session: Session, *, username: str, password: str) -> AdminUser:
    """取或建一个站主：同一用例里可以开两次 `admin_client`（「另一个浏览器」场景）。"""
    from sqlalchemy import select

    existing = (
        session.execute(select(AdminUser).where(AdminUser.username == username)).scalars().first()
    )
    if existing is not None:
        return existing
    return make_admin(session, username=username, password=password)


@contextmanager
def admin_client(
    settings,
    session: Session,
    *routers,
    username: str = "owner",
    password: str = "t09-owner-password-123",
) -> Iterator[tuple[TestClient, AdminUser, str]]:
    """已登录站主的测试客户端，返回 `(client, admin_user, csrf_token)`。"""
    from app.modules.auth.router import router as auth_router
    from tests.core.t01_db import module_api_client

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


# --- 真实 HTTP 写操作 -------------------------------------------------------


def create_skill(
    client: TestClient,
    csrf_token: str,
    *,
    slug: str,
    name: str = "前端工程",
    domain: str = "frontend",
    scope: str = "能独立完成响应式页面与前端构建配置。",
    evidence: str = "这个博客的前端与手机宿主。",
    links: list[dict] | None = None,
    position: int = 0,
    projects: list[dict] | None = None,
):
    body: dict[str, object] = {
        "slug": slug,
        "name": name,
        "domain": domain,
        "scope": scope,
        "evidence": evidence,
        "position": position,
    }
    if links is not None:
        body["links"] = links
    if projects is not None:
        body["projects"] = projects
    return client.post(ADMIN_SKILLS_PATH, json=body, headers=write_headers(csrf_token))


def publish_skill(client: TestClient, csrf_token: str, skill_id: str, version: int):
    return client.post(
        f"{ADMIN_SKILLS_PATH}/{skill_id}/publish",
        headers=write_headers(csrf_token, version),
    )


def create_record(
    client: TestClient,
    csrf_token: str,
    *,
    slug: str,
    title: str = "为什么动画结束后无法点击页面",
    background: str = "过渡遮罩结束后指针事件没有恢复，页面像被冻住。",
    attempts: str = "检查遮罩卸载时机与事件监听注册顺序，排除了 CSS 的 pointer-events。",
    outcome: str = "",
    work_status: str = "pending",
    evidence_links: list[dict] | None = None,
    posts: list[dict] | None = None,
    projects: list[dict] | None = None,
):
    body: dict[str, object] = {
        "slug": slug,
        "title": title,
        "background": background,
        "attempts": attempts,
        "outcome": outcome,
        "work_status": work_status,
    }
    if evidence_links is not None:
        body["evidence_links"] = evidence_links
    if posts is not None:
        body["posts"] = posts
    if projects is not None:
        body["projects"] = projects
    return client.post(ADMIN_RECORDS_PATH, json=body, headers=write_headers(csrf_token))


def publish_record(client: TestClient, csrf_token: str, record_id: str, version: int):
    return client.post(
        f"{ADMIN_RECORDS_PATH}/{record_id}/publish",
        headers=write_headers(csrf_token, version),
    )


__all__ = [
    "ADMIN_RECORDS_PATH",
    "ADMIN_SKILLS_PATH",
    "RECORDS_PATH",
    "SKILLS_PATH",
    "UTC",
    "WORK_INVESTIGATING",
    "WORK_PENDING",
    "WORK_RESOLVED",
    "admin_client",
    "anonymous_client",
    "attach_projects",
    "attach_record_posts",
    "attach_record_projects",
    "create_record",
    "create_skill",
    "login_ok",
    "make_admin",
    "make_post",
    "make_record",
    "make_skill",
    "publish_record",
    "publish_skill",
    "read_session",
    "t09_routers",
    "unique_slug",
    "write_headers",
]
