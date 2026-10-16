"""相册 / 照片墙路由（05 §6 / §7、07 §5）。

公开（匿名只读，`Cache-Control: no-store`）：

  GET  /gallery/albums                  kind、cursor、limit → `{items, next_cursor}`
  GET  /gallery/albums/{slug}           相册详情 + 有序照片；草稿 / 撤回 / 删除 / 不存在 404
  GET  /gallery/photos                  scope=global|album、album、kind、year、month、
                                        cursor、limit → `{items, next_cursor, total}`
  GET  /gallery/photos/years            照片墙可用的年份（只统计有拍摄日期的照片）

管理（站主 + CSRF/Origin + `If-Match`，`Cache-Control: private, no-store`）：

  GET    /admin/albums                  管理列表（草稿与已发布都在）
  GET    /admin/albums/{id}             草稿 / 预览数据，响应带 `version` 与 `ETag`
  POST   /admin/albums                  新建草稿（201）
  PATCH  /admin/albums/{id}             更新；传 photos 时完整替换有序关系
  POST   /admin/albums/{id}/publish     发布（门槛：至少 1 张 ready 照片）
  POST   /admin/albums/{id}/unpublish   撤回回到 draft
  DELETE /admin/albums/{id}             软删除（204）
  DELETE /admin/albums/{id}/photos/{media_id}
                                        **单处撤回**：只移除相册这一处引用（204）

要点：

  - **公开地址用 slug，管理地址用 UUID**（与 projects 一致）。
  - `/gallery/photos` 的 `scope=album` 必须同时给 `album`；给了 `month` 没给 `year`
    是字段错误 422，不静默忽略。
  - `/gallery/photos/years` 必须注册在 `/{album...}` 之前，否则会被当成一个 slug
    （这里没有 `/{slug}` 形式的照片路由，因此只是顺序上的防御性写法）。
  - 撤回 / 删除一张照片**不会**让仍被其他公开内容引用的媒体变得不可读（05 §11）。
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
from app.modules.gallery import service
from app.modules.gallery.models import ALBUM_KINDS, ALBUM_STATUSES, Album
from app.modules.gallery.schemas import (
    AlbumAdminListOut,
    AlbumAdminOut,
    AlbumCreateIn,
    AlbumDetailOut,
    AlbumListOut,
    AlbumUpdateIn,
    PhotoItemOut,
    PhotoListOut,
    wall_album_out,
)

public_router = APIRouter(prefix="/gallery", tags=["gallery"])
admin_router = APIRouter(prefix="/admin/albums", tags=["admin-albums"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

ENTITY_TYPE = "album"
AUDIT_CREATE = "album.create"
AUDIT_UPDATE = "album.update"
AUDIT_PUBLISH = "album.publish"
AUDIT_UNPUBLISH = "album.unpublish"
AUDIT_DELETE = "album.delete"
AUDIT_PHOTO_REMOVE = "album.photo_remove"

MAX_YEAR = 9999
MIN_YEAR = 1900


def _parse_album_id(album_id: str) -> uuid.UUID:
    """相册 ID 必须是 UUID；格式不对与「不存在」同形 404（不给探测信号）。"""
    try:
        return uuid.UUID(album_id)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _parse_media_id(media_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(media_id)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _audit(
    session: Session,
    *,
    action: str,
    album: Album,
    context: AdminContext,
    request: Request,
    extra: dict[str, Any] | None = None,
) -> None:
    """发布 / 撤回 / 删除属于管理动作，按 05 §3 记审计（不含说明与文件名）。"""
    auth_service.record_audit(
        session,
        action=action,
        entity_type=ENTITY_TYPE,
        entity_id=album.id,
        actor_id=context.user.id,
        request_id=_request_id(request),
        extra={"status": album.status, "version": album.version, **(extra or {})},
        commit=True,
    )


def _admin_payload(session: Session, album: Album) -> AlbumAdminOut:
    return service.admin_album_out(session, album)


def _load_or_404(session: Session, album_id: str) -> Album:
    album = service.get_admin_album(session, _parse_album_id(album_id))
    if album is None:
        raise service.not_found()
    return album


def _photo_out(
    session: Session,
    scope: str,
    album_slug: str | None,
    kind: str | None,
    year: int | None,
    month: int | None,
    cursor: str | None,
    limit: int,
):
    if scope not in service.SCOPES:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "scope 不合法",
            status_code=422,
            fields={"scope": [f"只能是 {' / '.join(service.SCOPES)}"]},
        )
    if scope == service.SCOPE_ALBUM and not album_slug:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "按相册浏览时必须指定 album",
            status_code=422,
            fields={"album": ["scope=album 时必须给出 album slug"]},
        )
    if month is not None and year is None:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "只给 month 无法筛选",
            status_code=422,
            fields={"year": ["按月份筛选时必须同时给出 year"]},
        )
    if year is not None and (year < MIN_YEAR or year > MAX_YEAR):
        raise ApiError(
            CODE_UNPROCESSABLE,
            "year 不合法",
            status_code=422,
            fields={"year": [f"年份需在 {MIN_YEAR}–{MAX_YEAR} 之间"]},
        )
    if month is not None and (month < 1 or month > 12):
        raise ApiError(
            CODE_UNPROCESSABLE,
            "month 不合法",
            status_code=422,
            fields={"month": ["月份需在 1–12 之间"]},
        )
    if kind is not None and kind not in ALBUM_KINDS:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "类型筛选不合法",
            status_code=422,
            fields={"kind": [f"只能是 {' / '.join(ALBUM_KINDS)}"]},
        )

    items, next_cursor, total = service.list_wall_photos(
        session,
        scope=scope,
        album_slug=album_slug,
        kind=kind,
        year=year,
        month=month,
        cursor=cursor,
        limit=limit,
    )
    return items, next_cursor, total


# --- 公开 -----------------------------------------------------------------


@public_router.get("/albums", response_model=AlbumListOut, summary="公开相册列表")
def list_albums(
    response: Response,
    kind: str | None = Query(default=None, max_length=16),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> AlbumListOut:
    no_store(response)
    if kind is not None and kind not in ALBUM_KINDS:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "类型筛选不合法",
            status_code=422,
            fields={"kind": [f"只能是 {' / '.join(ALBUM_KINDS)}"]},
        )
    albums, next_cursor = service.list_public_albums(
        session, kind=kind, cursor=cursor, limit=limit
    )
    return AlbumListOut(
        items=service.public_album_summaries(session, albums), next_cursor=next_cursor
    )


@public_router.get("/photos", response_model=PhotoListOut, summary="照片墙（跨相册 / 单相册）")
def list_photos(
    response: Response,
    scope: str = Query(default=service.SCOPE_GLOBAL, max_length=16),
    album: str | None = Query(default=None, max_length=200),
    kind: str | None = Query(default=None, max_length=16),
    year: int | None = Query(default=None, ge=MIN_YEAR, le=MAX_YEAR),
    month: int | None = Query(default=None, ge=1, le=12),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=24, ge=1, le=60),
    session: Session = Depends(get_session),
) -> PhotoListOut:
    no_store(response)
    items, next_cursor, total = _photo_out(
        session, scope, album, kind, year, month, cursor, limit
    )
    return PhotoListOut(
        items=[
            PhotoItemOut(photo=photo, album=wall_album_out(album_row))
            for album_row, photo in items
        ],
        next_cursor=next_cursor,
        total=total,
    )


@public_router.get("/photos/years", response_model=list[int], summary="照片墙可用的年份")
def list_photo_years(
    response: Response, session: Session = Depends(get_session)
) -> list[int]:
    no_store(response)
    return service.wall_filter_years(session)


@public_router.get("/albums/{slug}", response_model=AlbumDetailOut, summary="公开相册详情")
def read_album(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> AlbumDetailOut:
    no_store(response)
    album = service.get_public_album(session, slug)
    if album is None:
        # 草稿、已撤回、已删除与不存在完全同形（05 §6）。
        raise service.not_found()
    return service.public_album_detail(session, album)


# --- 管理 -----------------------------------------------------------------


@admin_router.get(
    "",
    response_model=AlbumAdminListOut,
    summary="管理列表（含草稿）",
    dependencies=[Depends(private_no_store)],
)
def list_admin_albums(
    status: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> AlbumAdminListOut:
    if status is not None and status not in ALBUM_STATUSES:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "状态筛选不合法",
            status_code=422,
            fields={"status": [f"只能是 {' / '.join(ALBUM_STATUSES)}"]},
        )
    if kind is not None and kind not in ALBUM_KINDS:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "类型筛选不合法",
            status_code=422,
            fields={"kind": [f"只能是 {' / '.join(ALBUM_KINDS)}"]},
        )
    albums, next_cursor = service.list_admin_albums(
        session, status=status, kind=kind, cursor=cursor, limit=limit
    )
    return AlbumAdminListOut(
        items=service.admin_album_list_out(session, albums), next_cursor=next_cursor
    )


@admin_router.get(
    "/{album_id}",
    response_model=AlbumAdminOut,
    summary="读取相册（草稿 / 预览）",
    dependencies=[Depends(private_no_store)],
)
def read_admin_album(
    album_id: str,
    response: Response,
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> AlbumAdminOut:
    album = _load_or_404(session, album_id)
    response.headers["ETag"] = f'"{album.version}"'
    return _admin_payload(session, album)


@admin_router.post(
    "",
    response_model=AlbumAdminOut,
    status_code=201,
    summary="新建相册草稿",
    dependencies=[Depends(private_no_store)],
)
def create_album(
    payload: AlbumCreateIn,
    request: Request,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> AlbumAdminOut:
    # `exclude_unset=True` 是**必须的**：`AlbumCreateIn.position` 有默认值 0，
    # 用普通 `model_dump()` 会把「调用方没给 position」变成「调用方要求 position=0」，
    # 于是每本新相册都落在 0 上（真实浏览器联调会看到管理列表顺序全乱）。
    # 排除未设置的字段后，`service.create_album(position=None)` 才会按同类型最大值 +1。
    album = service.create_album(session, **payload.model_dump(exclude_unset=True))
    _audit(session, action=AUDIT_CREATE, album=album, context=context, request=request)
    response.headers["ETag"] = f'"{album.version}"'
    return _admin_payload(session, album)


@admin_router.patch(
    "/{album_id}",
    response_model=AlbumAdminOut,
    summary="更新相册",
    dependencies=[Depends(private_no_store)],
)
def update_album(
    album_id: str,
    payload: AlbumUpdateIn,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> AlbumAdminOut:
    album = _load_or_404(session, album_id)
    patch = payload.model_dump(exclude_unset=True)
    service.update_album(session, album, patch=patch, if_match=if_match)
    _audit(session, action=AUDIT_UPDATE, album=album, context=context, request=request)
    response.headers["ETag"] = f'"{album.version}"'
    return _admin_payload(session, album)


@admin_router.post(
    "/{album_id}/publish",
    response_model=AlbumAdminOut,
    summary="发布相册",
    dependencies=[Depends(private_no_store)],
)
def publish_album(
    album_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> AlbumAdminOut:
    album = _load_or_404(session, album_id)
    service.publish_album(session, album, if_match=if_match)
    _audit(
        session,
        action=AUDIT_PUBLISH,
        album=album,
        context=context,
        request=request,
        extra={"published_at": album.published_at.isoformat() if album.published_at else None},
    )
    response.headers["ETag"] = f'"{album.version}"'
    return _admin_payload(session, album)


@admin_router.post(
    "/{album_id}/unpublish",
    response_model=AlbumAdminOut,
    summary="撤回相册",
    dependencies=[Depends(private_no_store)],
)
def unpublish_album(
    album_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> AlbumAdminOut:
    album = _load_or_404(session, album_id)
    service.unpublish_album(session, album, if_match=if_match)
    _audit(session, action=AUDIT_UNPUBLISH, album=album, context=context, request=request)
    response.headers["ETag"] = f'"{album.version}"'
    return _admin_payload(session, album)


@admin_router.delete(
    "/{album_id}",
    status_code=204,
    summary="软删除相册",
    dependencies=[Depends(private_no_store)],
)
def delete_album(
    album_id: str,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    album = _load_or_404(session, album_id)
    service.soft_delete_album(session, album, if_match=if_match)
    _audit(session, action=AUDIT_DELETE, album=album, context=context, request=request)
    return Response(status_code=204)


@admin_router.delete(
    "/{album_id}/photos/{media_id}",
    status_code=204,
    summary="从相册移除一张照片（单处撤回）",
    dependencies=[Depends(private_no_store)],
)
def remove_album_photo(
    album_id: str,
    media_id: str,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    """**只移除这一处引用**。返回 204；该媒体仍被其他公开内容引用时继续匿名可读。

    媒体本身（文件与 `media` 行）不动：它可能还被动态、作品或另一个相册引用
    （05 §11：「管理端应提示，而不是声称一次撤回收回所有副本」）。
    """
    album = _load_or_404(session, album_id)
    service.remove_photo(session, album, _parse_media_id(media_id), if_match=if_match)
    _audit(
        session,
        action=AUDIT_PHOTO_REMOVE,
        album=album,
        context=context,
        request=request,
        extra={"media_id": media_id},
    )
    return Response(status_code=204)
