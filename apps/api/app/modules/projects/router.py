"""作品路由（05 §6 / §7、07 §5）。

公开（匿名只读，`Cache-Control: no-store`）：

  GET  /projects                 maintenance、tech、cursor、limit → `{items, next_cursor}`
  GET  /projects/{slug}          完整作品与有序图片；草稿 / 撤回 / 删除 / 不存在统一 404

管理（站主 + CSRF/Origin + `If-Match`，`Cache-Control: private, no-store`）：

  GET    /admin/projects                 管理列表（草稿与已发布都在）
  GET    /admin/projects/{id}            草稿 / 预览数据，响应带 `version` 与 `ETag`
  POST   /admin/projects                 新建草稿（201）
  PATCH  /admin/projects/{id}            更新；传 images 时完整替换有序关系
  POST   /admin/projects/{id}/publish    发布（门槛：至少 1 张 ready 图片 + 一句话用途）
  POST   /admin/projects/{id}/unpublish  撤回回到 draft（**不删除关联专题**）
  DELETE /admin/projects/{id}            软删除（204）

要点：

  - **公开地址用 slug，管理地址用 UUID**：slug 是分享 / SEO 的稳定标识（05 §2），
    UUID 是管理端的主键；两者不在同一个端点上混用，避免「改 slug 就换 URL」。
  - 公开响应不因站主登录就顺便返回草稿（05 §7）：公开端点只用 `ProjectDetailOut`。
  - 关联专题撤回**不连带删除作品**（验收 5）：`palace` 字段在专题不公开时是 `null`。
  - `If-Match` 缺失 428、版本不符 412，由 `app.core.preconditions` 统一处理。
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import get_session
from app.core.errors import CODE_UNPROCESSABLE, ApiError
from app.core.http import no_store, private_no_store
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT
from app.modules.auth import service as auth_service
from app.modules.auth.deps import AdminContext, require_admin, require_admin_write
from app.modules.projects import service
from app.modules.projects.models import MAINTENANCE_STATES, PROJECT_STATUSES, Project
from app.modules.projects.schemas import (
    ProjectAdminListOut,
    ProjectAdminOut,
    ProjectCreateIn,
    ProjectDetailOut,
    ProjectListOut,
    ProjectUpdateIn,
    admin_out,
)

public_router = APIRouter(prefix="/projects", tags=["projects"])
admin_router = APIRouter(prefix="/admin/projects", tags=["admin-projects"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

ENTITY_TYPE = "project"
AUDIT_CREATE = "project.create"
AUDIT_UPDATE = "project.update"
AUDIT_PUBLISH = "project.publish"
AUDIT_UNPUBLISH = "project.unpublish"
AUDIT_DELETE = "project.delete"


def _parse_project_id(project_id: str) -> uuid.UUID:
    """作品 ID 必须是 UUID；格式不对与「不存在」同形 404（不给探测信号）。"""
    try:
        return uuid.UUID(project_id)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _audit(
    session: Session,
    *,
    action: str,
    project: Project,
    context: AdminContext,
    request: Request,
    extra: dict[str, Any] | None = None,
) -> None:
    """发布 / 撤回 / 删除属于管理动作，按 05 §3 记审计（不含正文与文件名）。"""
    auth_service.record_audit(
        session,
        action=action,
        entity_type=ENTITY_TYPE,
        entity_id=project.id,
        actor_id=context.user.id,
        request_id=_request_id(request),
        extra={"status": project.status, "version": project.version, **(extra or {})},
        commit=True,
    )


def _admin_payload(session: Session, project: Project) -> ProjectAdminOut:
    images = service.admin_images_for_projects(session, [project.id]).get(project.id, [])
    return admin_out(project, images=images)


def _load_or_404(session: Session, project_id: str) -> Project:
    project = service.get_admin_project(session, _parse_project_id(project_id))
    if project is None:
        raise service.not_found()
    return project


# --- 公开 -----------------------------------------------------------------


@public_router.get("", response_model=ProjectListOut, summary="公开作品列表")
def list_projects(
    response: Response,
    maintenance: str | None = Query(default=None, max_length=16),
    tech: str | None = Query(default=None, max_length=40),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> ProjectListOut:
    no_store(response)
    if maintenance is not None and maintenance not in MAINTENANCE_STATES:
        # 非法筛选按字段错误返回，不静默当成「全部」。
        raise ApiError(
            CODE_UNPROCESSABLE,
            "维护状态筛选不合法",
            status_code=422,
            fields={"maintenance": [f"只能是 {' / '.join(MAINTENANCE_STATES)}"]},
        )
    projects, next_cursor = service.list_public_projects(
        session, maintenance=maintenance, tech=tech, cursor=cursor, limit=limit
    )
    return ProjectListOut(
        items=service.public_list_out(session, projects), next_cursor=next_cursor
    )


@public_router.get("/{slug}", response_model=ProjectDetailOut, summary="公开作品详情")
def read_project(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> ProjectDetailOut:
    no_store(response)
    project = service.get_public_project(session, slug)
    if project is None:
        # 草稿、已撤回、已删除与不存在完全同形（05 §6）。
        raise service.not_found()
    return service.public_detail_out(session, project)


# --- 管理 -----------------------------------------------------------------


@admin_router.get(
    "",
    response_model=ProjectAdminListOut,
    summary="管理列表（含草稿）",
    dependencies=[Depends(private_no_store)],
)
def list_admin_projects(
    status: str | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> ProjectAdminListOut:
    if status is not None and status not in PROJECT_STATUSES:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "状态筛选不合法",
            status_code=422,
            fields={"status": [f"只能是 {' / '.join(PROJECT_STATUSES)}"]},
        )
    projects, next_cursor = service.list_admin_projects(
        session, status=status, cursor=cursor, limit=limit
    )
    return ProjectAdminListOut(
        items=[_admin_payload(session, project) for project in projects],
        next_cursor=next_cursor,
    )


@admin_router.get(
    "/{project_id}",
    response_model=ProjectAdminOut,
    summary="读取作品（草稿 / 预览）",
    dependencies=[Depends(private_no_store)],
)
def read_admin_project(
    project_id: str,
    response: Response,
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> ProjectAdminOut:
    project = _load_or_404(session, project_id)
    # ETag 与持久化行同源，保证「读到的 version」与「If-Match 要求的版本」不会漂移。
    response.headers["ETag"] = f'"{project.version}"'
    return _admin_payload(session, project)


@admin_router.post(
    "",
    response_model=ProjectAdminOut,
    status_code=201,
    summary="新建草稿",
    dependencies=[Depends(private_no_store)],
)
def create_project(
    payload: ProjectCreateIn,
    request: Request,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> ProjectAdminOut:
    # `exclude_unset=True`：只把调用方**真的给过**的字段传给 service。
    # 这样「没写 palace_id」与「显式写了 palace_id: null」在语义上一致（都是不关联），
    # 但将来如果某个字段的默认值不再是「无操作」，也不会被静默当成显式输入。
    project = service.create_project(session, **payload.model_dump(exclude_unset=True))
    _audit(session, action=AUDIT_CREATE, project=project, context=context, request=request)
    response.headers["ETag"] = f'"{project.version}"'
    return _admin_payload(session, project)


@admin_router.patch(
    "/{project_id}",
    response_model=ProjectAdminOut,
    summary="更新作品",
    dependencies=[Depends(private_no_store)],
)
def update_project(
    project_id: str,
    payload: ProjectUpdateIn,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> ProjectAdminOut:
    project = _load_or_404(session, project_id)
    patch = payload.model_dump(exclude_unset=True)
    service.update_project(session, project, patch=patch, if_match=if_match)
    _audit(session, action=AUDIT_UPDATE, project=project, context=context, request=request)
    response.headers["ETag"] = f'"{project.version}"'
    return _admin_payload(session, project)


@admin_router.post(
    "/{project_id}/publish",
    response_model=ProjectAdminOut,
    summary="发布作品",
    dependencies=[Depends(private_no_store)],
)
def publish_project(
    project_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> ProjectAdminOut:
    project = _load_or_404(session, project_id)
    service.publish_project(session, project, if_match=if_match)
    _audit(
        session,
        action=AUDIT_PUBLISH,
        project=project,
        context=context,
        request=request,
        extra={
            "published_at": project.published_at.isoformat() if project.published_at else None
        },
    )
    response.headers["ETag"] = f'"{project.version}"'
    return _admin_payload(session, project)


@admin_router.post(
    "/{project_id}/unpublish",
    response_model=ProjectAdminOut,
    summary="撤回作品",
    dependencies=[Depends(private_no_store)],
)
def unpublish_project(
    project_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> ProjectAdminOut:
    project = _load_or_404(session, project_id)
    service.unpublish_project(session, project, if_match=if_match)
    _audit(session, action=AUDIT_UNPUBLISH, project=project, context=context, request=request)
    response.headers["ETag"] = f'"{project.version}"'
    return _admin_payload(session, project)


@admin_router.delete(
    "/{project_id}",
    status_code=204,
    summary="软删除作品",
    dependencies=[Depends(private_no_store)],
)
def delete_project(
    project_id: str,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    project = _load_or_404(session, project_id)
    service.soft_delete_project(session, project, if_match=if_match)
    _audit(session, action=AUDIT_DELETE, project=project, context=context, request=request)
    return Response(status_code=204)
