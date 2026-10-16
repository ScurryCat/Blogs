"""放课后路由（07 §3、05 §6 / §7）。

公开（`/api/v1/leisure/*`）：

    GET  /leisure/entries            公开列表；kind、progress、cursor、limit
    GET  /leisure/entries/{id}       单条详情；草稿 / 已删除统一 404

管理（`/api/v1/admin/leisure/entries/*`，全部要求站主会话）：

    GET    /admin/leisure/entries              管理列表（含草稿）
    GET    /admin/leisure/entries/{id}         管理详情 + `ETag: "<version>"`
    POST   /admin/leisure/entries              新建（总是草稿，201）
    PATCH  /admin/leisure/entries/{id}         更新（只改出现过的字段）
    POST   /admin/leisure/entries/{id}/publish    发布
    POST   /admin/leisure/entries/{id}/unpublish  撤回
    DELETE /admin/leisure/entries/{id}         软删除（204）

边界：

  - 草稿不出现在任何公开端点，站主登录读公开端点也不会多拿草稿（预览走管理端点）。
  - 公开长评引用只给**公开文章**：草稿长评的标题不会从娱乐记录里泄漏。
  - 修改 / 发布 / 撤回 / 删除都要求 `If-Match`（缺 428、不符 412）。
  - **进度更新不写任何其它内容域**：不会自动生成 INS 动态（07 §3、任务卡「不做」）。

「追番 / 游戏」两个页签共用同一组端点，用 `kind` 筛选 —— 与 07 §3「两个页签共享
封面、状态、短评和筛选交互，保留各自的进度字段」一致。
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
from app.modules.leisure import schemas, service
from app.modules.leisure.models import KIND_ANIME, KIND_GAME, LeisureEntry

public_router = APIRouter(prefix="/leisure", tags=["leisure"])
admin_router = APIRouter(
    prefix="/admin/leisure/entries",
    tags=["admin-leisure"],
    dependencies=[Depends(private_no_store)],
)

# 单个模块一个 router：集成方以 `("leisure", "app.modules.leisure.router")` 登记，
# 内部自己组合公开 / 管理两条前缀（与 media / nav / journal 同样的做法）。
router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

KindQuery = Query(default=None, pattern=f"^({KIND_ANIME}|{KIND_GAME})$")


def if_match_header(if_match: str | None = Header(default=None, alias="If-Match")) -> str | None:
    return if_match


# --- 公开 -------------------------------------------------------------------


@public_router.get(
    "/entries", response_model=schemas.LeisureListOut, summary="公开追番 / 游戏列表"
)
def list_entries(
    response: Response,
    kind: str | None = KindQuery,
    progress: str | None = Query(default=None, max_length=16),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> schemas.LeisureListOut:
    no_store(response)
    entries, next_cursor = service.list_public_entries(
        session, kind=kind, progress=progress, cursor=cursor, limit=limit
    )
    return schemas.LeisureListOut(
        items=service.entries_out(session, entries), next_cursor=next_cursor
    )


@public_router.get(
    "/entries/{entry_id}", response_model=schemas.LeisureEntryOut, summary="公开条目详情"
)
def read_entry(
    entry_id: uuid.UUID,
    response: Response,
    session: Session = Depends(get_session),
) -> schemas.LeisureEntryOut:
    no_store(response)
    entry = service.get_public_entry(session, entry_id)
    if entry is None:
        raise service.not_found()
    return service.entry_out(session, entry)


# --- 管理 -------------------------------------------------------------------


def _admin_not_found() -> ApiError:
    return ApiError(CODE_NOT_FOUND, "这条记录不存在", status_code=404)


def _load_entry(session: Session, entry_id: uuid.UUID, if_match: str | None) -> LeisureEntry:
    entry = service.get_admin_entry(session, entry_id)
    if entry is None:
        raise _admin_not_found()
    require_version(int(entry.version), if_match)
    return entry


@admin_router.get("", response_model=schemas.LeisureAdminListOut, summary="管理列表")
def admin_list_entries(
    response: Response,
    kind: str | None = KindQuery,
    status: schemas.LeisureStatus | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.LeisureAdminListOut:
    no_store(response)
    entries, next_cursor = service.list_admin_entries(
        session, kind=kind, status=status, cursor=cursor, limit=limit
    )
    return schemas.LeisureAdminListOut(
        items=service.admin_entries_out(session, entries), next_cursor=next_cursor
    )


@admin_router.get(
    "/{entry_id}", response_model=schemas.LeisureAdminOut, summary="管理详情（预览）"
)
def admin_read_entry(
    entry_id: uuid.UUID,
    response: Response,
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.LeisureAdminOut:
    entry = service.get_admin_entry(session, entry_id)
    if entry is None:
        raise _admin_not_found()
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "", response_model=schemas.LeisureAdminOut, status_code=201, summary="新建（草稿）"
)
def admin_create_entry(
    payload: schemas.LeisureCreateIn,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.LeisureAdminOut:
    extras = {
        name: getattr(payload, name)
        for name in (
            "season",
            "total_episodes",
            "episodes_watched",
            "last_watched_on",
            "airing",
            "platform",
            "playtime_minutes",
            "started_on",
            "completed_on",
            "all_achievements",
        )
    }
    entry = service.create_entry(
        session,
        kind=payload.kind,
        title=payload.title,
        progress=payload.progress,
        rating=payload.rating,
        notes=payload.notes,
        notes_have_spoilers=payload.notes_have_spoilers,
        cover_media_id=payload.cover_media_id,
        review_post_id=payload.review_post_id,
        extras=extras,
    )
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.patch("/{entry_id}", response_model=schemas.LeisureAdminOut, summary="更新")
def admin_update_entry(
    entry_id: uuid.UUID,
    payload: schemas.LeisureUpdateIn,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.LeisureAdminOut:
    entry = _load_entry(session, entry_id, if_match)
    changes = payload.changed_fields()
    if changes:
        entry = service.update_entry(session, entry, changes=changes)
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "/{entry_id}/publish", response_model=schemas.LeisureAdminOut, summary="发布"
)
def admin_publish_entry(
    entry_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.LeisureActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.LeisureAdminOut:
    entry = _load_entry(session, entry_id, if_match)
    entry = service.publish_entry(session, entry)
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.post(
    "/{entry_id}/unpublish", response_model=schemas.LeisureAdminOut, summary="撤回"
)
def admin_unpublish_entry(
    entry_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.LeisureActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.LeisureAdminOut:
    entry = _load_entry(session, entry_id, if_match)
    entry = service.unpublish_entry(session, entry)
    apply_etag(response, int(entry.version))
    return service.admin_entry_out(session, entry)


@admin_router.delete("/{entry_id}", status_code=204, summary="软删除")
def admin_delete_entry(
    entry_id: uuid.UUID,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.LeisureActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    entry = _load_entry(session, entry_id, if_match)
    service.soft_delete_entry(session, entry)
    return Response(status_code=204)
