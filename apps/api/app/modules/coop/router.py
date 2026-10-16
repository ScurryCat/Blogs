"""COOP 友链路由（05 §6 公开 / §7 管理；任务卡 T07）。

公开（`/api/v1/coop/*`）：

    GET  /coop/links              已发布友链列表；tag、cursor、limit（默认 12、最大 30）
    GET  /coop/links/{id}         公开详情（含相识故事）；草稿 / 已删除 / 不存在统一 404
    GET  /coop/tags               已发布友链用到的标签（筛选器用，无计数、无排名）

管理（`/api/v1/admin/friends/*`，全部要求站主会话）：

    GET    /admin/friends                  管理列表（含草稿与已删除）
    GET    /admin/friends/{id}             管理详情 + ETag
    POST   /admin/friends                  新建草稿（201）
    PATCH  /admin/friends/{id}             更新；tags 传入即完整替换
    POST   /admin/friends/{id}/publish     发布
    POST   /admin/friends/{id}/unpublish   撤回
    DELETE /admin/friends/{id}             软删除（204，不删除媒体）

边界：

  - 公开端点在 SQL 层过滤草稿、软删除与未到发布时间；站主登录后读公开端点也不会多拿草稿
    （预览只用管理接口）。
  - 修改 / 发布 / 撤回 / 删除都带 `If-Match`：缺失 428、版本不符 412（core.preconditions）。
  - 写操作统一走 `require_admin_write`（站主 + 同源 Origin + CSRF）。
  - 公开响应 `no-store`；管理响应由 core 的私有缓存中间件兜底为 `private, no-store`。
  - 没有「申请友链」写接口：申请入口指向站内已有联系方式 / 留言板（验收第 6 条），
    本站不建匿名自动发布的申请库。
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
from app.modules.coop import schemas, service

public_router = APIRouter(prefix="/coop", tags=["coop"])
admin_router = APIRouter(
    prefix="/admin/friends",
    tags=["admin-friends"],
    dependencies=[Depends(private_no_store)],
)

# 单个模块一个 router：T00 以 `("coop", "app.modules.coop.router")` 登记，
# 内部自己组合公开 / 管理两条前缀（与 media、nav 同样的做法）。
router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)


def if_match_header(if_match: str | None = Header(default=None, alias="If-Match")) -> str | None:
    """读取 `If-Match` 请求头（解析与 428 / 412 由 core.preconditions 统一处理）。"""
    return if_match


def _admin_not_found() -> ApiError:
    return ApiError(CODE_NOT_FOUND, "友链不存在", status_code=404)


def _load_link(session: Session, link_id: uuid.UUID, if_match: str | None):
    link = service.get_admin_link(session, link_id)
    if link is None:
        raise _admin_not_found()
    require_version(int(link.version), if_match)
    return link


# --- 公开 -------------------------------------------------------------------


@public_router.get("/links", response_model=schemas.FriendLinkListOut, summary="友链列表")
def list_links(
    response: Response,
    tag: str | None = Query(default=None, max_length=40),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkListOut:
    """按站主手动排序返回已发布友链；`tag` 为精确（规范化后）筛选。"""
    no_store(response)
    links, next_cursor = service.list_public_links(
        session, tag=tag, cursor=cursor, limit=limit
    )
    return schemas.FriendLinkListOut(
        items=service.summary_list_out(session, links), next_cursor=next_cursor
    )


@public_router.get(
    "/links/{link_id}", response_model=schemas.FriendLinkDetailOut, summary="友链详情"
)
def read_link(
    link_id: uuid.UUID,
    response: Response,
    session: Session = Depends(get_session),
) -> schemas.FriendLinkDetailOut:
    """草稿、已删除与不存在**完全同形**（统一 404），不泄漏「这条存在但没发布」。"""
    no_store(response)
    link = service.get_public_link(session, link_id)
    if link is None:
        raise service.not_found()
    return service.detail_out(session, link)


@public_router.get("/tags", response_model=schemas.FriendTagListOut, summary="友链标签")
def list_tags(response: Response, session: Session = Depends(get_session)) -> schemas.FriendTagListOut:
    """只返回已发布友链用到的标签；不返回数量，也不按热度排序。"""
    no_store(response)
    return schemas.FriendTagListOut(
        items=[
            schemas.FriendTagOut(name=name, normalized=normalized)
            for name, normalized in service.list_public_tags(session)
        ]
    )


# --- 管理 -------------------------------------------------------------------


@admin_router.get("", response_model=schemas.FriendLinkAdminListOut, summary="管理友链列表")
def admin_list_links(
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkAdminListOut:
    """含草稿与已删除（`deleted_at` 非空即为已删除，便于管理端区分）。"""
    links, next_cursor = service.list_admin_links(session, cursor=cursor, limit=limit)
    return schemas.FriendLinkAdminListOut(
        items=service.admin_list_out(session, links), next_cursor=next_cursor
    )


@admin_router.get(
    "/{link_id}", response_model=schemas.FriendLinkAdminOut, summary="管理友链详情"
)
def admin_read_link(
    link_id: uuid.UUID,
    response: Response,
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkAdminOut:
    link = service.get_admin_link(session, link_id)
    if link is None:
        raise _admin_not_found()
    apply_etag(response, int(link.version))
    return service.admin_detail_out(session, link)


@admin_router.post(
    "", response_model=schemas.FriendLinkAdminOut, status_code=201, summary="新建友链（草稿）"
)
def admin_create_link(
    payload: schemas.FriendLinkCreateIn,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkAdminOut:
    """新建总是草稿；地址在这里就被限制为 http(s)（非法 scheme → 422）。"""
    link = service.create_link(
        session,
        name=payload.name,
        url=payload.url,
        summary=payload.summary,
        story=payload.story,
        arcana=payload.arcana,
        tags=service.normalize_tags(payload.tags),
        avatar_media_id=payload.avatar_media_id,
        position=payload.position,
    )
    apply_etag(response, int(link.version))
    return service.admin_detail_out(session, link)


@admin_router.patch(
    "/{link_id}", response_model=schemas.FriendLinkAdminOut, summary="更新友链（tags 完整替换）"
)
def admin_update_link(
    link_id: uuid.UUID,
    payload: schemas.FriendLinkUpdateIn,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkAdminOut:
    link = _load_link(session, link_id, if_match)

    changes: dict[str, object] = {}
    for field in ("name", "url", "summary", "story", "arcana", "position"):
        if field in payload.model_fields_set:
            changes[field] = getattr(payload, field)
    if "tags" in payload.model_fields_set:
        changes["tags"] = service.normalize_tags(payload.tags or [])
    if "avatar_media_id" in payload.model_fields_set:
        changes["avatar_media_id"] = payload.avatar_media_id

    if changes:
        link = service.update_link(session, link, changes=changes)
    # 没有任何可改字段时：不改就是不改，版本不动、ETag 保持当前值。
    apply_etag(response, int(link.version))
    return service.admin_detail_out(session, link)


@admin_router.post("/{link_id}/publish", response_model=schemas.FriendLinkAdminOut, summary="发布友链")
def admin_publish_link(
    link_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.FriendLinkActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkAdminOut:
    link = _load_link(session, link_id, if_match)
    link = service.publish_link(session, link)
    apply_etag(response, int(link.version))
    return service.admin_detail_out(session, link)


@admin_router.post(
    "/{link_id}/unpublish", response_model=schemas.FriendLinkAdminOut, summary="撤回友链"
)
def admin_unpublish_link(
    link_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.FriendLinkActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.FriendLinkAdminOut:
    link = _load_link(session, link_id, if_match)
    link = service.unpublish_link(session, link)
    apply_etag(response, int(link.version))
    return service.admin_detail_out(session, link)


@admin_router.delete("/{link_id}", status_code=204, summary="软删除友链")
def admin_delete_link(
    link_id: uuid.UUID,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.FriendLinkActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    """软删除该友链；**不删除媒体对象**，也不影响同一张图在其他公开内容里的引用。"""
    link = _load_link(session, link_id, if_match)
    service.soft_delete_link(session, link)
    return Response(status_code=204)
