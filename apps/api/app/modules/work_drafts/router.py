"""工作草稿路由（P5 第一批 · 设计书 §3.5、契约 §3.2）。

全部在管理前缀下（`require_admin` 读 / `require_admin_write` 写，CSRF 走
`X-CSRF-Token` 请求头或 body 字段），响应统一 `Cache-Control: private, no-store`：

  POST   /admin/work-drafts              创建或恢复（已有内容复用有效草稿）
                                         200 = 复用 `{draft, reused:true}`
                                         201 = 新建 `{draft, reused:false}`
  GET    /admin/work-drafts              列表（仅本人 active；content_type 过滤 + 分页）
  GET    /admin/work-drafts/{id}         详情（带 ETag: "<draft_version>"）
  PATCH  /admin/work-drafts/{id}         保存工作副本（If-Match 草稿版本）
  POST   /admin/work-drafts/{id}/commit  显式提交（双版本检查 + 事务 + 幂等）
  DELETE /admin/work-drafts/{id}         丢弃（204；不影响正式内容与媒体文件）

错误码：401 未登录、404 非本人 / 不存在、409 状态冲突、412 VERSION_CONFLICT、
428 PRECONDITION_REQUIRED、422 VALIDATION_FAILED（字段级）。详见 service.py。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import get_session
from app.core.errors import CODE_UNPROCESSABLE, ApiError
from app.core.http import private_no_store
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT
from app.core.preconditions import format_etag
from app.modules.auth.deps import AdminContext, require_admin, require_admin_write
from app.modules.work_drafts import service
from app.modules.work_drafts.models import CONTENT_TYPES
from app.modules.work_drafts.schemas import (
    CommitResultOut,
    WorkDraftCommitIn,
    WorkDraftCreateIn,
    WorkDraftCreateOut,
    WorkDraftListOut,
    WorkDraftOut,
    WorkDraftUpdateIn,
)

router = APIRouter(
    prefix="/admin/work-drafts",
    tags=["admin-work-drafts"],
    dependencies=[Depends(private_no_store)],
)


def _parse_draft_id(value: str) -> uuid.UUID:
    """草稿 ID 必须是 UUID；格式不对与「不存在」同形 404（不给 UUID 探测信号）。"""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


@router.post(
    "",
    response_model=WorkDraftCreateOut,
    summary="创建或恢复工作草稿",
)
def create_work_draft(
    payload: WorkDraftCreateIn,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> WorkDraftCreateOut:
    """已有 target 且存在 active 草稿 → 返回既有草稿（200, reused=true）。

    新建返回 201。新内容（无 target）允许同时存在多份草稿。
    """
    draft, reused = service.create_draft(
        session,
        owner_id=context.user.id,
        content_type=payload.content_type,
        target_id=payload.target_id,
        data=payload.data,
        images=payload.images,
    )
    response.status_code = 200 if reused else 201
    response.headers["ETag"] = format_etag(draft.draft_version)
    return WorkDraftCreateOut(draft=service.draft_out(session, draft), reused=reused)


@router.get(
    "",
    response_model=WorkDraftListOut,
    summary="工作草稿列表（仅本人 active）",
)
def list_work_drafts(
    content_type: str | None = Query(default=None, max_length=16),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> WorkDraftListOut:
    if content_type is not None and content_type not in CONTENT_TYPES:
        # 非法筛选按字段错误返回，不静默当成「全部」。
        raise ApiError(
            CODE_UNPROCESSABLE,
            "内容类型筛选不合法",
            status_code=422,
            fields={"content_type": [f"只能是 {' / '.join(CONTENT_TYPES)}"]},
        )
    drafts, next_cursor = service.list_drafts(
        session,
        owner_id=_context.user.id,
        content_type=content_type,
        cursor=cursor,
        limit=limit,
    )
    return WorkDraftListOut(
        items=service.drafts_out(session, drafts), next_cursor=next_cursor
    )


@router.get(
    "/{draft_id}",
    response_model=WorkDraftOut,
    summary="读取工作草稿",
)
def read_work_draft(
    draft_id: str,
    response: Response,
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> WorkDraftOut:
    draft = service.get_draft(
        session, owner_id=context.user.id, draft_id=_parse_draft_id(draft_id)
    )
    response.headers["ETag"] = format_etag(draft.draft_version)
    return service.draft_out(session, draft)


@router.patch(
    "/{draft_id}",
    response_model=WorkDraftOut,
    summary="保存工作副本（If-Match 草稿版本）",
)
def update_work_draft(
    draft_id: str,
    payload: WorkDraftUpdateIn,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> WorkDraftOut:
    """只写工作副本：`data` 浅合并、`images` 给出时整组替换；If-Match 缺失 428 / 不符 412。"""
    draft = service.patch_draft(
        session,
        owner_id=context.user.id,
        draft_id=_parse_draft_id(draft_id),
        data=payload.data,
        images=payload.images,
        if_match=if_match,
    )
    response.headers["ETag"] = format_etag(draft.draft_version)
    return service.draft_out(session, draft)


@router.post(
    "/{draft_id}/commit",
    response_model=CommitResultOut,
    summary="提交工作草稿（事务 + 双版本检查 + 幂等）",
)
def commit_work_draft(
    draft_id: str,
    payload: WorkDraftCommitIn,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> CommitResultOut:
    """显式提交：同一 `commit_key` 重试回放上次结果（`idempotent_replay:true`）。"""
    return service.commit_draft(
        session,
        owner_id=context.user.id,
        draft_id=_parse_draft_id(draft_id),
        action=payload.action,
        expected_target_version=payload.expected_target_version,
        commit_key=payload.commit_key,
        if_match=if_match,
        request_id=_request_id(request),
    )


@router.delete(
    "/{draft_id}",
    status_code=204,
    summary="丢弃工作草稿",
)
def delete_work_draft(
    draft_id: str,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    """active → discarded（204）。只解除媒体保留关系，不删除文件与正式内容。"""
    service.discard_draft(
        session, owner_id=context.user.id, draft_id=_parse_draft_id(draft_id)
    )
    return Response(status_code=204)
