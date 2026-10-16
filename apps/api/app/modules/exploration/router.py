"""问题记录路由（05 §6 / §7、07 §6「印象空间」）。

公开（匿名只读，`Cache-Control: no-store`）：

  GET  /exploration/records                公开列表；work_status、cursor、limit
  GET  /exploration/records/stats          公开工作状态统计（只算公开记录）
  GET  /exploration/records/{slug}         公开详情：背景、尝试、结果、验证链接、关联

管理（站主 + CSRF/Origin + `If-Match`，`Cache-Control: private, no-store`）：

  GET    /admin/exploration/records            管理列表（草稿与已发布都在）
  GET    /admin/exploration/records/{id}       草稿 / 预览数据，带 `version` 与 `ETag`
  POST   /admin/exploration/records            新建草稿（201）
  PATCH  /admin/exploration/records/{id}       更新；传 posts / projects 时完整替换
  POST   /admin/exploration/records/{id}/publish    发布（门槛：标题 + 背景说明）
  POST   /admin/exploration/records/{id}/unpublish  撤回（**不改工作状态**）
  DELETE /admin/exploration/records/{id}       软删除（204）

**保留 T04 的分类探索**（任务卡执行清单「保留 T04 分类探索，不把新模块当替代实现」）：
本模块只提供「站主整理的问题记录」这一层数据与页面，**不**接管
`GET /posts?category=`、`GET /nav/search` 或 T04 的印象空间分类屏。
`/apps/metanav`（T04）的「印象空间」屏与 `/apps/metanav/mementos`（本包）是两个入口，
前者按文章分类往下翻，后者是站主的问题日志，导航上互相链接而不是互相替代。

要点：

  - **工作状态与发布状态相互独立**：`work_status` 不是发布条件，
    「已解决但仍是草稿」与「待探索但已发布」都合法（各有测试）。
  - 公开详情里关联的文章 / 作品只在**当前公开**时出现，撤回后整条消失，
    不泄漏隐藏标题（验收 3）。
  - `/exploration/records/stats` 必须注册在 `/exploration/records/{slug}` **之前**，
    否则 `stats` 会被当成一条记录的 slug。
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
from app.modules.exploration import service
from app.modules.exploration.models import (
    RECORD_STATUSES,
    WORK_STATUSES,
    ExplorationRecord,
)
from app.modules.exploration.schemas import (
    RecordAdminListOut,
    RecordAdminOut,
    RecordCreateIn,
    RecordDetailOut,
    RecordListOut,
    RecordStatsOut,
    RecordUpdateIn,
    admin_out,
    detail_out,
    summary_out,
)

public_router = APIRouter(prefix="/exploration/records", tags=["exploration"])
admin_router = APIRouter(prefix="/admin/exploration/records", tags=["admin-exploration"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

ENTITY_TYPE = "exploration_record"
AUDIT_CREATE = "exploration.create"
AUDIT_UPDATE = "exploration.update"
AUDIT_PUBLISH = "exploration.publish"
AUDIT_UNPUBLISH = "exploration.unpublish"
AUDIT_DELETE = "exploration.delete"


def _parse_record_id(record_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(record_id)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _audit(
    session: Session,
    *,
    action: str,
    record: ExplorationRecord,
    context: AdminContext,
    request: Request,
    extra: dict[str, Any] | None = None,
) -> None:
    """工作状态入审计（07 §6 的状态流转是可追溯的管理动作）；不含正文。"""
    auth_service.record_audit(
        session,
        action=action,
        entity_type=ENTITY_TYPE,
        entity_id=record.id,
        actor_id=context.user.id,
        request_id=_request_id(request),
        extra={
            "status": record.status,
            "work_status": record.work_status,
            "version": record.version,
            **(extra or {}),
        },
        commit=True,
    )


def _admin_payload(session: Session, record: ExplorationRecord) -> RecordAdminOut:
    posts, projects = service.admin_relations_out(session, [record.id])
    return admin_out(
        record,
        posts=posts.get(record.id, []),
        projects=projects.get(record.id, []),
    )


def _load_or_404(session: Session, record_id: str) -> ExplorationRecord:
    record = service.get_admin_record(session, _parse_record_id(record_id))
    if record is None:
        raise service.not_found()
    return record


def _reject_unknown(value: str | None, allowed: tuple[str, ...], field: str, label: str) -> None:
    if value is not None and value not in allowed:
        raise ApiError(
            CODE_UNPROCESSABLE,
            f"{label}筛选不合法",
            status_code=422,
            fields={field: [f"只能是 {' / '.join(allowed)}"]},
        )


# --- 公开 -----------------------------------------------------------------


@public_router.get("", response_model=RecordListOut, summary="公开问题记录列表")
def list_records(
    response: Response,
    work_status: str | None = Query(default=None, max_length=16),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> RecordListOut:
    no_store(response)
    _reject_unknown(work_status, WORK_STATUSES, "work_status", "工作状态")
    records, next_cursor = service.list_public_records(
        session, work_status=work_status, cursor=cursor, limit=limit
    )
    counts = service.public_counts_for_records(session, [record.id for record in records])
    return RecordListOut(
        items=[
            summary_out(
                record,
                post_count=counts.get(record.id, (0, 0))[0],
                project_count=counts.get(record.id, (0, 0))[1],
            )
            for record in records
        ],
        next_cursor=next_cursor,
    )


@public_router.get("/stats", response_model=RecordStatsOut, summary="公开工作状态统计")
def read_stats(
    response: Response,
    session: Session = Depends(get_session),
) -> RecordStatsOut:
    """只统计**当前公开**的记录：与列表里能看到的条数完全一致。

    草稿不参与统计，因此读者不会从「待探索 3 / 已解决 1」里推断出
    「站主还藏了几条没发布的问题」（验收 3）。
    """
    no_store(response)
    counts = service.public_work_status_counts(session)
    return RecordStatsOut(total=sum(counts.values()), by_work_status=counts)


@public_router.get("/{slug}", response_model=RecordDetailOut, summary="公开问题记录详情")
def read_record(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> RecordDetailOut:
    no_store(response)
    record = service.get_public_record(session, slug)
    if record is None:
        # 草稿、已撤回、已删除、未到发布时间与不存在完全同形（05 §6）。
        raise service.not_found()
    posts = service.public_posts_for_records(session, [record.id]).get(record.id, [])
    projects = service.public_projects_for_records(session, [record.id]).get(record.id, [])
    return detail_out(record, posts=posts, projects=projects)


# --- 管理 -----------------------------------------------------------------


@admin_router.get(
    "",
    response_model=RecordAdminListOut,
    summary="管理列表（含草稿）",
    dependencies=[Depends(private_no_store)],
)
def list_admin_records(
    status: str | None = Query(default=None),
    work_status: str | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> RecordAdminListOut:
    _reject_unknown(status, RECORD_STATUSES, "status", "状态")
    _reject_unknown(work_status, WORK_STATUSES, "work_status", "工作状态")
    records, next_cursor = service.list_admin_records(
        session, status=status, work_status=work_status, cursor=cursor, limit=limit
    )
    return RecordAdminListOut(
        items=[_admin_payload(session, record) for record in records],
        next_cursor=next_cursor,
    )


@admin_router.get(
    "/{record_id}",
    response_model=RecordAdminOut,
    summary="读取问题记录（草稿 / 预览）",
    dependencies=[Depends(private_no_store)],
)
def read_admin_record(
    record_id: str,
    response: Response,
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> RecordAdminOut:
    record = _load_or_404(session, record_id)
    response.headers["ETag"] = f'"{record.version}"'
    return _admin_payload(session, record)


@admin_router.post(
    "",
    response_model=RecordAdminOut,
    status_code=201,
    summary="新建草稿",
    dependencies=[Depends(private_no_store)],
)
def create_record(
    payload: RecordCreateIn,
    request: Request,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> RecordAdminOut:
    record = service.create_record(session, **payload.model_dump(exclude_unset=True))
    _audit(session, action=AUDIT_CREATE, record=record, context=context, request=request)
    response.headers["ETag"] = f'"{record.version}"'
    return _admin_payload(session, record)


@admin_router.patch(
    "/{record_id}",
    response_model=RecordAdminOut,
    summary="更新问题记录",
    dependencies=[Depends(private_no_store)],
)
def update_record(
    record_id: str,
    payload: RecordUpdateIn,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> RecordAdminOut:
    record = _load_or_404(session, record_id)
    service.update_record(
        session, record, patch=payload.model_dump(exclude_unset=True), if_match=if_match
    )
    _audit(session, action=AUDIT_UPDATE, record=record, context=context, request=request)
    response.headers["ETag"] = f'"{record.version}"'
    return _admin_payload(session, record)


@admin_router.post(
    "/{record_id}/publish",
    response_model=RecordAdminOut,
    summary="发布问题记录",
    dependencies=[Depends(private_no_store)],
)
def publish_record(
    record_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> RecordAdminOut:
    record = _load_or_404(session, record_id)
    service.publish_record(session, record, if_match=if_match)
    _audit(session, action=AUDIT_PUBLISH, record=record, context=context, request=request)
    response.headers["ETag"] = f'"{record.version}"'
    return _admin_payload(session, record)


@admin_router.post(
    "/{record_id}/unpublish",
    response_model=RecordAdminOut,
    summary="撤回问题记录",
    dependencies=[Depends(private_no_store)],
)
def unpublish_record(
    record_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> RecordAdminOut:
    record = _load_or_404(session, record_id)
    service.unpublish_record(session, record, if_match=if_match)
    _audit(session, action=AUDIT_UNPUBLISH, record=record, context=context, request=request)
    response.headers["ETag"] = f'"{record.version}"'
    return _admin_payload(session, record)


@admin_router.delete(
    "/{record_id}",
    status_code=204,
    summary="软删除问题记录",
    dependencies=[Depends(private_no_store)],
)
def delete_record(
    record_id: str,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    record = _load_or_404(session, record_id)
    service.soft_delete_record(session, record, if_match=if_match)
    _audit(session, action=AUDIT_DELETE, record=record, context=context, request=request)
    return Response(status_code=204)
