"""异世界导航路由（05 §6 公开 / §7 管理）。

公开（`/api/v1/nav/*`）：

    GET  /nav/palaces              可进入的专题列表；cursor、limit（默认 12、最大 30）
    GET  /nav/palaces/{slug}       公开专题详情：标准关键词 + 有序公开文章；无公开文章 404
    POST /nav/resolve              认知定位；返回 found / ambiguous / not_found，**无副作用**
    GET  /nav/search               普通搜索；q、kind、tag、cursor、limit（默认 20、最大 30）

管理（`/api/v1/admin/nav/palaces/*`，全部要求站主会话）：

    GET    /admin/nav/palaces                 管理列表（含草稿与冲突提示）
    GET    /admin/nav/palaces/{id}            管理详情（预览用，含草稿关系）+ ETag
    POST   /admin/nav/palaces                 新建草稿（201）
    PATCH  /admin/nav/palaces/{id}            更新；关系列表完整替换
    POST   /admin/nav/palaces/{id}/publish    发布（至少一篇公开文章，否则 409）
    POST   /admin/nav/palaces/{id}/unpublish  撤回
    DELETE /admin/nav/palaces/{id}            软删除（不删除文章，204）

边界（与 05 / SHARED-CONTRACTS 一致）：

  - 公开端点在 SQL 层过滤草稿、软删除、未到发布时间与「没有公开文章」的专题；
    站主登录后读公开端点也不会多拿草稿（预览只用管理接口）。
  - 修改 / 发布 / 撤回 / 删除都带 `If-Match`：缺失 428、版本不符 412（core.preconditions）。
  - 写操作统一走 `require_admin_write`（站主 + 同源 Origin + CSRF）。
  - `POST /nav/resolve` 是**公开读取**：不需要登录、不写库、不产生足迹（05 §5）。
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
from app.modules.nav import ratelimit, schemas, service
from app.modules.nav.models import Palace

public_router = APIRouter(prefix="/nav", tags=["nav"])
admin_router = APIRouter(
    prefix="/admin/nav/palaces",
    tags=["admin-nav"],
    dependencies=[Depends(private_no_store)],
)

# 单个模块一个 router：T00 以 `("nav", "app.modules.nav.router")` 登记，
# 内部自己组合公开 / 管理两条前缀（与 media 模块同样的做法）。
router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

# `If-Match` 由 core.preconditions 统一解析：缺失 428、版本不符 412、通配 400。
def if_match_header(if_match: str | None = Header(default=None, alias="If-Match")) -> str | None:
    """读取 `If-Match` 请求头。"""
    return if_match


# --- 公开 -------------------------------------------------------------------


@public_router.get("/palaces", response_model=schemas.PalaceListOut, summary="可进入的专题列表")
def list_palaces(
    response: Response,
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> schemas.PalaceListOut:
    """默认入口：站主已经整理好的专题卡片（04 §4A）。

    「已发现」是叙事名称，不代表必须先解谜解锁 —— 所有公开专题都在这里。
    """
    no_store(response)
    palaces, next_cursor = service.list_public_palaces(session, cursor=cursor, limit=limit)
    return schemas.PalaceListOut(
        items=service.summary_list_out(session, palaces), next_cursor=next_cursor
    )


@public_router.get(
    "/palaces/{slug}", response_model=schemas.PalaceDetailOut, summary="公开专题详情"
)
def read_palace(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> schemas.PalaceDetailOut:
    """草稿、已删除、未发布、没有公开文章与不存在**完全同形**（统一 404）。"""
    no_store(response)
    palace = service.get_public_palace(session, slug)
    if palace is None:
        raise service.not_found()
    return service.detail_out(session, palace)


@public_router.post(
    "/resolve",
    response_model=schemas.ResolveOut,
    summary="认知定位（三关键词匹配）",
    dependencies=[Depends(ratelimit.resolve_rate_limit)],
)
def resolve(
    payload: schemas.ResolveIn,
    response: Response,
    session: Session = Depends(get_session),
) -> schemas.ResolveOut:
    """三字段求交集，**确定性地**返回 found / ambiguous / not_found。

    不写足迹、不写统计、不需要登录：这是一次普通读取（05 §5）。
    """
    no_store(response)
    return service.resolve_out(
        session, name=payload.name, location=payload.location, cognition=payload.cognition
    )


@public_router.get(
    "/search",
    response_model=schemas.SearchListOut,
    summary="普通搜索（公开文章与公开专题）",
    dependencies=[Depends(ratelimit.search_rate_limit)],
)
def search(
    response: Response,
    q: str = Query(min_length=1, max_length=80),
    kind: schemas.SearchKind | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=80),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=service.SEARCH_DEFAULT_LIMIT, ge=1, le=service.SEARCH_MAX_LIMIT),
    session: Session = Depends(get_session),
) -> schemas.SearchListOut:
    """首版不检索草稿、图片 EXIF、原始上传名或管理员字段（04 §6）。"""
    no_store(response)
    rows, next_cursor = service.search_public(
        session, q=q, kind=kind, tag=tag, cursor=cursor, limit=limit
    )
    return schemas.SearchListOut(
        items=[service.search_item_out(row) for row in rows], next_cursor=next_cursor
    )


# --- 管理 -------------------------------------------------------------------


def _admin_not_found() -> ApiError:
    return ApiError(CODE_NOT_FOUND, "专题不存在", status_code=404)


def _load_palace(session: Session, palace_id: uuid.UUID, if_match: str | None) -> Palace:
    palace = service.get_admin_palace(session, palace_id)
    if palace is None:
        raise _admin_not_found()
    # 缺失 If-Match → 428；版本不符 → 412（并行编辑不丢数据）。
    require_version(int(palace.version), if_match)
    return palace


@admin_router.get("", response_model=schemas.PalaceAdminListOut, summary="管理专题列表")
def admin_list_palaces(
    response: Response,
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.PalaceAdminListOut:
    """含草稿与别名冲突提示。按站主手动维护的规模设计，不做批量优化。"""
    no_store(response)
    palaces, next_cursor = service.list_admin_palaces(session, cursor=cursor, limit=limit)
    return schemas.PalaceAdminListOut(
        items=[service.admin_detail_out(session, palace) for palace in palaces],
        next_cursor=next_cursor,
    )


@admin_router.get(
    "/{palace_id}", response_model=schemas.PalaceAdminOut, summary="管理专题详情（预览）"
)
def admin_read_palace(
    palace_id: uuid.UUID,
    response: Response,
    context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> schemas.PalaceAdminOut:
    palace = service.get_admin_palace(session, palace_id)
    if palace is None:
        raise _admin_not_found()
    apply_etag(response, int(palace.version))
    return service.admin_detail_out(session, palace)


@admin_router.post(
    "",
    response_model=schemas.PalaceAdminOut,
    status_code=201,
    summary="新建专题（草稿）",
)
def admin_create_palace(
    payload: schemas.PalaceCreateIn,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.PalaceAdminOut:
    """新建总是草稿：是否公开由 `publish` 决定（至少一篇公开文章）。"""
    aliases = service.normalize_alias_payload(payload.aliases)
    post_ids = service.normalize_post_ids(payload.post_ids)
    palace = service.create_palace(
        session,
        slug=payload.slug,
        title=payload.title,
        summary=payload.summary,
        keywords=payload.keywords,
        aliases=aliases,
        post_ids=post_ids,
    )
    apply_etag(response, int(palace.version))
    return service.admin_detail_out(session, palace)


@admin_router.patch(
    "/{palace_id}", response_model=schemas.PalaceAdminOut, summary="更新专题（关系完整替换）"
)
def admin_update_palace(
    palace_id: uuid.UUID,
    payload: schemas.PalaceUpdateIn,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.PalaceAdminOut:
    palace = _load_palace(session, palace_id, if_match)

    changes: dict[str, object] = {}
    if "title" in payload.model_fields_set:
        changes["title"] = payload.title
    if "summary" in payload.model_fields_set:
        changes["summary"] = payload.summary
    if "keywords" in payload.model_fields_set:
        changes["keywords"] = payload.keywords
    if "aliases" in payload.model_fields_set:
        changes["aliases"] = service.normalize_alias_payload(payload.aliases or [])
    if "post_ids" in payload.model_fields_set:
        changes["post_ids"] = service.normalize_post_ids(payload.post_ids or [])

    if changes:
        palace = service.update_palace(session, palace, changes=changes)
    # 没有任何可改字段时：不改就是不改，版本不动、ETag 保持当前值。
    apply_etag(response, int(palace.version))
    return service.admin_detail_out(session, palace)


@admin_router.post(
    "/{palace_id}/publish", response_model=schemas.PalaceAdminOut, summary="发布专题"
)
def admin_publish_palace(
    palace_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.PalaceActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.PalaceAdminOut:
    palace = _load_palace(session, palace_id, if_match)
    palace = service.publish_palace(session, palace)
    apply_etag(response, int(palace.version))
    return service.admin_detail_out(session, palace)


@admin_router.post(
    "/{palace_id}/unpublish", response_model=schemas.PalaceAdminOut, summary="撤回专题"
)
def admin_unpublish_palace(
    palace_id: uuid.UUID,
    response: Response,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.PalaceActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> schemas.PalaceAdminOut:
    palace = _load_palace(session, palace_id, if_match)
    palace = service.unpublish_palace(session, palace)
    apply_etag(response, int(palace.version))
    return service.admin_detail_out(session, palace)


@admin_router.delete("/{palace_id}", status_code=204, summary="软删除专题")
def admin_delete_palace(
    palace_id: uuid.UUID,
    if_match: str | None = Depends(if_match_header),
    payload: schemas.PalaceActionIn | None = None,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    """软删除专题，**不删除其中的文章**（05 §7）。"""
    palace = _load_palace(session, palace_id, if_match)
    service.soft_delete_palace(session, palace)
    return Response(status_code=204)
