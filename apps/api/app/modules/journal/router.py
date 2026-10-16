"""手记路由（07 §3、05 §6 / §7）。

公开（`/api/v1/journal/*`）：

    GET    /journal/entries                  公开列表；year / month / cursor / limit
    GET    /journal/entries/{id}             公开正文；草稿 / 私密 / 已撤回 / 未来日期统一 404
    GET    /journal/calendar                 公开日历；只聚合真正公开的记录

管理（`/api/v1/admin/journal/entries/*`，全部要求站主会话）：

    GET    /admin/journal/entries            管理列表（含草稿与私密）
    GET    /admin/journal/entries/{id}       管理详情 + `ETag: "<version>"`
    POST   /admin/journal/entries            新建（**总是 draft + private**，201）
    PATCH  /admin/journal/entries/{id}       更新；`images` 传入时完整替换
    POST   /admin/journal/entries/{id}/publish     发布（缺标题 / 正文 → 409）
    POST   /admin/journal/entries/{id}/unpublish   撤回
    POST   /admin/journal/entries/{id}/visibility  切 public / private（立即生效）
    DELETE /admin/journal/entries/{id}       软删除（204）

边界：

  - 公开端点不区分「不存在」与「无权」：草稿、私密、已撤回、未来日期与真的不存在
    返回**完全同形**的 404，不泄漏标题、正文、图片或计数。
  - 站主登录后读公开端点也不会多拿草稿：预览一律走管理端点。
  - 修改 / 发布 / 撤回 / 切可见性 / 删除都要求 `If-Match`（缺 428、不符 412）。
  - 公开响应 `no-store`；管理响应由 core 的私有缓存中间件兜底为 `private, no-store`。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.core.deps import get_session
from app.core.errors import CODE_NOT_FOUND, ApiError
from app.core.http import no_store, private_no_store
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT
from app.core.preconditions import apply_etag, require_version
from app.modules.auth.deps import AdminContext, require_admin, require_admin_write
from app.modules.journal import schemas, service
from app.modules.journal.models import JournalEntry

public_router = APIRouter(prefix="/journal", tags=["journal"])
admin_router = APIRouter(
    prefix="/admin/journal/entries",
    tags=["admin-journal"],
    dependencies=[Depends(private_no_store)],
)

# 单个模块一个 router：集成方以 `("journal", "app.modules.journal.router")` 登记，
# 内部自己组合公开 / 管理两条前缀（与 media / nav 同样的做法）。
router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)


def if_match_header(if_match: str | None = Header(default=None, alias="If-Match")) -> str | None:
    """读取 `If-Match` 请求头（由 core.preconditions 统一解析语义）。"""
    return if_match


# --- 公开 -------------------------------------------------------------------


@public_router.get(
    "/entries", response_model=schemas.JournalEntryListOut, summary="公开手记列表"
)
def list_entries(
    response: Response,
    year: int | None = Query(default=None, ge=1970, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> schemas.JournalEntryListOut:
    """按日期倒序的存档卡列表。只返回已发布且 public 的记录。"""
    no_store(response)
    entries, next_cursor = service.list_public_entries(
        session, year=year, month=month, cursor=cursor, limit=limit
    )
    return schemas.JournalEntryListOut(
        items=service.summary_list_out(session, entries), next_cursor=next_cursor
    )


@public_router.get(
    "/calendar", response_model=schemas.JournalCalendarOut, summary="公开日历（只含公开记录）"
)
def read_calendar(
    response: Response,
    year: int | None = Query(default=None, ge=1970, le=9999),
    month: int | None = Query(default=None, ge=1, le=12),
    session: Session = Depends(get_session),
) -> schemas.JournalCalendarOut:
    """与列表**同一份数据**：空日期就是空日期，不显示被隐藏记录的数量。"""
    no_store(response)
    return service.public_calendar(session, year=year, month=month)


@public_router.get(
    "/entries/{entry_id}", response_model=schemas.JournalEntryDetailOut, summary="公开手记正文"
)
def read_entry(
    entry_id: uuid.UUID,
    response: Response,
    session: Session = Depends(get_session),
) -> schemas.JournalEntryDetailOut:
    no_store(response)
    entry = service.get_public_entry(session, entry_id)
    if entry is None:
        raise service.not_found()
    return service.detail_out(session, entry)


# --- 管理 -------------------------------------------------------------------


def _admin_not_found() -> ApiError:
    return ApiError(CODE_NOT_FOUND, "这篇手记不存在", status_code=404)


def _load_entry(session: Session, entry_id: uuid.UUID, if_match: str | None) -> JournalEntry:
    entry = service.get_admin_entry(session, entry_id)
    if entry is None:
        raise _admin_not_found()
    # 缺失 If-Match → 428；版本不符 → 412（并行编辑不丢数据）。
    require_version(int(entry.version), if_match)
    return entry


@admin_router.get("", response_model=schemas.JournalAdminListOut, summary="管理手记列表")
def admin_list_entries(
    response: Response,
    status: schemas.JournalStatus | None = Query(default=None),
    visibility: schemas.JournalVisibility | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminListOut:
    no_store(response)
    entries, next_cursor = service.list_admin_entries(
        session, status=status, visibility=visibility, cursor=cursor, limit=limit
    )
    return schemas.JournalAdminListOut(
        items=[service.admin_entry_out(session, entry) for entry in entries],
        next_cursor=next_cursor,
    )


@admin_router.get(
    "/{entry_id}", response_model=schemas.JournalAdminOut, summary="管理手记详情（预览）"
)
def admin_read_entry(
    entry_id: uuid.UUID,
    response: Response,
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminOut:
    entry = service.get_admin_entry(session, entry_id)
    if entry is None:
        raise _admin_not_found()
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "",
    response_model=schemas.JournalAdminOut,
    status_code=201,
    summary="新建手记（草稿 + 仅自己可见）",
)
def admin_create_entry(
    payload: schemas.JournalCreateIn,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminOut:
    """新建**总是** draft + private：公开必须先显式发布，再显式切为 public。"""
    entry = service.create_entry(
        session,
        entry_date=payload.entry_date,
        title=payload.title,
        content_md=payload.content_md,
        mood=payload.mood,
        location=payload.location,
        post_id=payload.post_id,
        images=payload.images,
    )
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.patch(
    "/{entry_id}", response_model=schemas.JournalAdminOut, summary="更新手记（图片完整替换）"
)
def admin_update_entry(
    entry_id: uuid.UUID,
    payload: schemas.JournalUpdateIn,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminOut:
    entry = _load_entry(session, entry_id, if_match)

    changes: dict[str, object] = {}
    for field in ("entry_date", "title", "content_md", "mood", "location", "post_id", "images"):
        if field in payload.model_fields_set:
            changes[field] = getattr(payload, field)

    if changes:
        entry = service.update_entry(session, entry, changes=changes)
    # 没有任何可改字段时：不改就是不改，版本不动、ETag 保持当前值。
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "/{entry_id}/publish", response_model=schemas.JournalAdminOut, summary="发布手记"
)
def admin_publish_entry(
    entry_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.JournalVisibilityIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminOut:
    entry = _load_entry(session, entry_id, if_match)
    entry = service.publish_entry(session, entry)
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "/{entry_id}/unpublish", response_model=schemas.JournalAdminOut, summary="撤回手记"
)
def admin_unpublish_entry(
    entry_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.JournalVisibilityIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminOut:
    entry = _load_entry(session, entry_id, if_match)
    entry = service.unpublish_entry(session, entry)
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "/{entry_id}/visibility",
    response_model=schemas.JournalAdminOut,
    summary="切换可见性（public / private，立即生效）",
)
def admin_set_visibility(
    entry_id: uuid.UUID,
    visibility: schemas.JournalVisibility,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.JournalVisibilityIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.JournalAdminOut:
    """切换后公开端点**立即**遵守（验收 1）：没有缓存需要失效。"""
    entry = _load_entry(session, entry_id, if_match)
    entry = service.set_visibility(session, entry, visibility)
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.delete("/{entry_id}", status_code=204, summary="软删除手记")
def admin_delete_entry(
    entry_id: uuid.UUID,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.JournalVisibilityIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    entry = _load_entry(session, entry_id, if_match)
    service.soft_delete_entry(session, entry)
    return Response(status_code=204)
