"""图文动态路由（05 §6 / §7，03 §7）。

公开（匿名只读，`Cache-Control: no-store`）：

  GET  /moments               tag、cursor、limit（默认 12、最大 30）→ `{items, next_cursor}`
  GET  /moments/{id}          完整动态与有序图片；草稿 / 撤回 / 删除 / 不存在统一 404

管理（站主 + CSRF/Origin + `If-Match`，`Cache-Control: private, no-store`）：

  GET    /admin/moments                 管理列表（草稿与已发布都在）
  GET    /admin/moments/{id}            读取草稿 / 预览数据，响应带 `version` 与 `ETag`
  POST   /admin/moments                 新建草稿（201）
  PATCH  /admin/moments/{id}            更新；传 images 时完整替换有序关系
  POST   /admin/moments/{id}/publish    发布（门槛：1–9 张 ready 图片）
  POST   /admin/moments/{id}/unpublish  撤回回到 draft
  DELETE /admin/moments/{id}            软删除（204）

要点：
  - 动态 ID 强制 UUID：格式不对与「不存在」同形 404（不给 UUID 探测信号）。
  - 公开响应不因站主登录就顺便返回草稿（05 §7）：公开端点只用 `MomentOut`。
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
from app.modules.moments import service
from app.modules.moments.models import MOMENT_STATUSES, Moment
from app.modules.moments.schemas import (
    MomentAdminListOut,
    MomentAdminOut,
    MomentCreateIn,
    MomentListOut,
    MomentOut,
    MomentUpdateIn,
    moment_admin_out,
    moment_out,
)

public_router = APIRouter(prefix="/moments", tags=["moments"])
admin_router = APIRouter(prefix="/admin/moments", tags=["admin-moments"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

ENTITY_TYPE = "moment"
AUDIT_CREATE = "moment.create"
AUDIT_UPDATE = "moment.update"
AUDIT_PUBLISH = "moment.publish"
AUDIT_UNPUBLISH = "moment.unpublish"
AUDIT_DELETE = "moment.delete"


def _parse_moment_id(moment_id: str) -> uuid.UUID:
    """动态 ID 必须是 UUID；格式不对与「不存在」统一 404。"""
    try:
        return uuid.UUID(moment_id)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _audit(
    session: Session,
    *,
    action: str,
    moment: Moment,
    context: AdminContext,
    request: Request,
    extra: dict[str, Any] | None = None,
) -> None:
    """发布 / 撤回 / 删除属于管理动作，按 05 §3 记审计（不含正文与文件名）。"""
    auth_service.record_audit(
        session,
        action=action,
        entity_type=ENTITY_TYPE,
        entity_id=moment.id,
        actor_id=context.user.id,
        request_id=_request_id(request),
        extra={"status": moment.status, "version": moment.version, **(extra or {})},
        commit=True,
    )


def _public_payload(session: Session, moment: Moment) -> MomentOut:
    tags = service.tags_for_moments(session, [moment.id]).get(moment.id, [])
    images = service.images_for_moments(session, [moment.id]).get(moment.id, [])
    return moment_out(moment, tags=tags, images=images)


def _admin_payload(session: Session, moment: Moment) -> MomentAdminOut:
    tags = service.tags_for_moments(session, [moment.id]).get(moment.id, [])
    # 管理回执用**完整**的关系（不静默过滤不 ready 的图）：表单要能看到并提示。
    refs = service.image_refs_for_moments(session, [moment.id]).get(moment.id, [])
    media_by_id = {media.id: media for media in service.load_media_for_preview(session, refs)}
    images = [
        (media_by_id[media_id], position, alt)
        for media_id, position, alt in refs
        if media_id in media_by_id
    ]
    return moment_admin_out(moment, tags=tags, images=images)


def _load_or_404(session: Session, moment_id: str) -> Moment:
    moment = service.get_moment(session, _parse_moment_id(moment_id))
    if moment is None:
        raise service.not_found()
    return moment


# --- 公开 -----------------------------------------------------------------


@public_router.get("", response_model=MomentListOut, summary="公开图文列表")
def list_moments(
    response: Response,
    tag: str | None = Query(default=None, max_length=80),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> MomentListOut:
    no_store(response)
    moments, next_cursor = service.list_public_moments(
        session, tag=tag, cursor=cursor, limit=limit
    )
    ids = [moment.id for moment in moments]
    tags_map = service.tags_for_moments(session, ids)
    images_map = service.images_for_moments(session, ids)
    return MomentListOut(
        items=[
            moment_out(moment, tags=tags_map.get(moment.id, []), images=images_map.get(moment.id, []))
            for moment in moments
        ],
        next_cursor=next_cursor,
    )


@public_router.get("/{moment_id}", response_model=MomentOut, summary="公开图文详情")
def read_moment(
    moment_id: str,
    response: Response,
    session: Session = Depends(get_session),
) -> MomentOut:
    no_store(response)
    moment = service.get_public_moment(session, _parse_moment_id(moment_id))
    if moment is None:
        # 草稿、已撤回、已删除与不存在完全同形（05 §6）。
        raise service.not_found()
    return _public_payload(session, moment)


# --- 管理 -----------------------------------------------------------------


@admin_router.get(
    "",
    response_model=MomentAdminListOut,
    summary="管理列表（含草稿）",
    dependencies=[Depends(private_no_store)],
)
def list_admin_moments(
    status: str | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> MomentAdminListOut:
    if status is not None and status not in MOMENT_STATUSES:
        # 非法筛选按字段错误返回，不静默当成「全部」。
        raise ApiError(
            CODE_UNPROCESSABLE,
            "状态筛选不合法",
            status_code=422,
            fields={"status": [f"只能是 {' / '.join(MOMENT_STATUSES)}"]},
        )
    moments, next_cursor = service.list_admin_moments(session, status=status, cursor=cursor, limit=limit)
    return MomentAdminListOut(
        items=[_admin_payload(session, moment) for moment in moments],
        next_cursor=next_cursor,
    )


@admin_router.get(
    "/{moment_id}",
    response_model=MomentAdminOut,
    summary="读取动态（草稿 / 预览）",
    dependencies=[Depends(private_no_store)],
)
def read_admin_moment(
    moment_id: str,
    response: Response,
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> MomentAdminOut:
    moment = _load_or_404(session, moment_id)
    # ETag 与持久化行同源，保证「读到的 version」与「If-Match 要求的版本」不会漂移。
    response.headers["ETag"] = f'"{moment.version}"'
    return _admin_payload(session, moment)


@admin_router.post(
    "",
    response_model=MomentAdminOut,
    status_code=201,
    summary="新建草稿",
    dependencies=[Depends(private_no_store)],
)
def create_moment(
    payload: MomentCreateIn,
    request: Request,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> MomentAdminOut:
    moment = service.create_moment(
        session,
        author_id=context.user.id,
        text=payload.text,
        images=payload.images,
        tags=payload.tags,
    )
    _audit(session, action=AUDIT_CREATE, moment=moment, context=context, request=request)
    response.headers["ETag"] = f'"{moment.version}"'
    return _admin_payload(session, moment)


@admin_router.patch(
    "/{moment_id}",
    response_model=MomentAdminOut,
    summary="更新动态",
    dependencies=[Depends(private_no_store)],
)
def update_moment(
    moment_id: str,
    payload: MomentUpdateIn,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> MomentAdminOut:
    moment = _load_or_404(session, moment_id)
    patch = payload.model_dump(exclude_unset=True)
    service.update_moment(session, moment, patch=patch, if_match=if_match)
    _audit(session, action=AUDIT_UPDATE, moment=moment, context=context, request=request)
    response.headers["ETag"] = f'"{moment.version}"'
    return _admin_payload(session, moment)


@admin_router.post(
    "/{moment_id}/publish",
    response_model=MomentAdminOut,
    summary="发布动态",
    dependencies=[Depends(private_no_store)],
)
def publish_moment(
    moment_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> MomentAdminOut:
    moment = _load_or_404(session, moment_id)
    service.publish_moment(session, moment, if_match=if_match)
    _audit(
        session,
        action=AUDIT_PUBLISH,
        moment=moment,
        context=context,
        request=request,
        extra={"published_at": moment.published_at.isoformat() if moment.published_at else None},
    )
    response.headers["ETag"] = f'"{moment.version}"'
    return _admin_payload(session, moment)


@admin_router.post(
    "/{moment_id}/unpublish",
    response_model=MomentAdminOut,
    summary="撤回动态",
    dependencies=[Depends(private_no_store)],
)
def unpublish_moment(
    moment_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> MomentAdminOut:
    moment = _load_or_404(session, moment_id)
    service.unpublish_moment(session, moment, if_match=if_match)
    _audit(session, action=AUDIT_UNPUBLISH, moment=moment, context=context, request=request)
    response.headers["ETag"] = f'"{moment.version}"'
    return _admin_payload(session, moment)


@admin_router.delete(
    "/{moment_id}",
    status_code=204,
    summary="软删除动态",
    dependencies=[Depends(private_no_store)],
)
def delete_moment(
    moment_id: str,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    moment = _load_or_404(session, moment_id)
    # 先记审计再软删除：删除后 moment 行仍在，但语义上已不可见。
    service.soft_delete_moment(session, moment, if_match=if_match)
    _audit(session, action=AUDIT_DELETE, moment=moment, context=context, request=request)
    return Response(status_code=204)
