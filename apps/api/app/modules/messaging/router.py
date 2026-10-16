"""角色消息路由（08 §2 的 URL 形态 + §7 的访问规则）。

**没有** `/api/v1/admin/...` 之外的管理写接口 —— 剧本是仓库文件，不通过 API 编辑。

公开（匿名可读，`Cache-Control: no-store`；不建会话、无副作用）：

  GET  /messaging/status                        运行状态与限额（不含密钥、不含身份）

访客（匿名会话，写操作走同源 + CSRF 闸门）：

  POST   /messaging/session                     建立 / 续期访客会话，返回 CSRF token
  DELETE /messaging/session                     立即清除该访客的全部会话与消息
  GET    /messaging/characters                  角色目录（有会话时附自己的会话摘要）
  POST   /messaging/conversations               取得或创建某角色的会话
  GET    /messaging/conversations/{id}          读取会话（归属写在 SQL 里）
  POST   /messaging/conversations/{id}/choice   选一个预设选项
  POST   /messaging/conversations/{id}/messages 自由输入（会调用 AI 适配层）
  POST   /messaging/conversations/{id}/resume   回到话题
  POST   /messaging/conversations/{id}/restart  重开这段剧情（保留聊天记录）
  DELETE /messaging/conversations/{id}          清除这段会话

管理（站主 + `private, no-store`）：

  GET /admin/messaging/overview                 运行配置、今日用量、会话计数

**HTTP 状态码的语义**（这一条容易被误读，所以写在这里）：

  - 4xx 表示「这次 API 操作没有被接受」：不属于你（404）、节点版本过期（409）、
    选项非法（422）、在途请求冲突（409）、限流（429）、来源或 CSRF 不合法（403）。
  - **AI 侧的降级不是 4xx**：供应商被停用、未配置、额度耗尽，或上游超时 / 报错时，
    接口返回 200 + `ai.status`（稳定机器码）+ `ai.message`。
    理由：在这些情况下「会话状态是被正确读取 / 正确更新的」，而且用户消息
    （如果已经落库）确实存在；把降级伪装成 HTTP 错误会让前端把已保存的输入当成发送失败。
    客户端必须按 `ai.status` 分支，而不是只看 HTTP 码。
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import utcnow
from app.core.deps import get_session, get_settings_dep
from app.core.errors import CODE_UNAUTHORIZED, CODE_VALIDATION_FAILED, ApiError
from app.core.http import no_store, private_no_store
from app.modules.auth.deps import AdminContext, require_admin
from app.modules.auth.ratelimit import client_ip
from app.modules.messaging import budget as budget_mod
from app.modules.messaging import models as m
from app.modules.messaging import schemas as s
from app.modules.messaging import service, sessions
from app.modules.messaging.ai.registry import resolve_provider
from app.modules.messaging.characters import get_character
from app.modules.messaging.config import MessagingSettings, messaging_settings_dep
from app.modules.messaging.guards import verify_visitor_write

public_router = APIRouter(prefix="/messaging", tags=["messaging"])
admin_router = APIRouter(prefix="/admin/messaging", tags=["admin-messaging"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)


# --- 访客上下文 ------------------------------------------------------------


@dataclass(frozen=True)
class VisitorContext:
    """通过校验的访客上下文。`csrf_token` 由会话 secret 派生，供写操作复用。"""

    row: m.VisitorSession
    csrf_token: str


def _cookie_name(app_settings: Settings) -> str:
    return sessions.visitor_cookie_name(is_production=app_settings.is_production)


def optional_visitor(
    request: Request,
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
) -> m.VisitorSession | None:
    """有未过期的访客 Cookie 就返回会话行，否则 None。**不创建**、不抛错。"""
    token = request.cookies.get(_cookie_name(app_settings))
    return sessions.resolve_visitor(session, token)


def _unauthorized() -> ApiError:
    return ApiError(
        CODE_UNAUTHORIZED,
        "还没有访客会话，请先打开一次角色消息页面。",
        status_code=401,
    )


def require_visitor(
    context: m.VisitorSession | None = Depends(optional_visitor),
) -> VisitorContext:
    """要求一个有效的访客会话。缺失 / 过期一律 401。"""
    if context is None:
        raise _unauthorized()
    return VisitorContext(row=context, csrf_token=sessions.visitor_csrf_token(context))


async def require_visitor_write(
    request: Request,
    context: VisitorContext = Depends(require_visitor),
    app_settings: Settings = Depends(get_settings_dep),
) -> VisitorContext:
    """访客写操作闸门：来源 + CSRF，见 `guards.py`。"""
    await verify_visitor_write(request, app_settings, expected_token=context.csrf_token)
    return context


def _ai_state(
    settings: MessagingSettings, provider_name: str
) -> s.AiStateOut:
    ready, reason = settings.provider_ready()
    if ready:
        return s.AiStateOut(
            status=service.AI_OK,
            message=reason,
            provider=provider_name,
            retryable=False,
        )
    status = "disabled" if settings.ai_provider == "disabled" else "not_configured"
    return s.AiStateOut(
        status=status,
        message=f"自由聊天暂时不可用：{reason}。预设剧情仍然可以继续。",
        provider=provider_name,
        retryable=False,
    )


def _touch(
    session: Session,
    row: m.VisitorSession,
    *,
    app_settings: Settings,
    request: Request,
    settings: MessagingSettings,
) -> None:
    """滑动续期；顺带记录 IP 摘要（只用于限流，原始 IP 不落库）。"""
    sessions.touch(session, row, settings=settings)
    if row.ip_hash is None:
        row.ip_hash = sessions.ip_digest(client_ip(request, app_settings), salt=app_settings.secret_key)


def _usage(
    session: Session, row: m.VisitorSession | None, settings: MessagingSettings
) -> s.UsageOut:
    snapshot = budget_mod.usage_snapshot(
        session,
        day=budget_mod.utc_day(),
        settings=settings,
        visitor_session_id=row.id if row is not None else None,
    )
    remaining = (
        None
        if snapshot.visitor_requests is None
        else max(0, snapshot.visitor_daily_requests - snapshot.visitor_requests)
    )
    return s.UsageOut(
        requests_today=snapshot.visitor_requests,
        daily_limit=snapshot.visitor_daily_requests,
        remaining=remaining,
        site_settled_units=snapshot.site_settled_units,
        site_daily_units=snapshot.site_daily_units,
        inflight=snapshot.inflight,
    )


# --- 公开状态 --------------------------------------------------------------


@public_router.get(
    "/status",
    response_model=s.StatusOut,
    summary="角色消息的运行状态与限额",
    dependencies=[Depends(no_store)],
)
def read_status(
    response: Response,
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.StatusOut:
    """**无副作用**：不建会话、不发 Cookie、不读访客身份。

    因此它可以被健康探针、管理页与首屏同时调用，也不会因为预取而产生垃圾会话。
    """
    no_store(response)
    provider = resolve_provider(settings)
    return s.StatusOut(
        ai=_ai_state(settings, provider.name),
        limits=service.limits_out(settings),
        provider_notes=service.provider_notes(settings),
        disclosure=service.DISCLOSURE,
    )


@public_router.get(
    "/characters",
    response_model=list[s.CharacterOut],
    summary="角色目录（含当前访客自己的会话摘要）",
    dependencies=[Depends(no_store)],
)
def list_characters(
    response: Response,
    visitor: m.VisitorSession | None = Depends(optional_visitor),
    session: Session = Depends(get_session),
) -> list[s.CharacterOut]:
    """没有会话时摘要是 `null` —— 不会替访客凭空造一段会话。"""
    no_store(response)
    return service.build_character_list(
        session, visitor_id=visitor.id if visitor is not None else None
    )


# --- 访客会话 --------------------------------------------------------------


@public_router.post(
    "/session",
    response_model=s.SessionOut,
    summary="建立或续期访客会话",
    dependencies=[Depends(private_no_store)],
)
def ensure_session(
    request: Request,
    response: Response,
    visitor: m.VisitorSession | None = Depends(optional_visitor),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.SessionOut:
    """第一次调用会建立匿名会话（HttpOnly Cookie，库里只有摘要）。

    这是**唯一**需要「先有会话才有 CSRF token」的引导接口，因此它只做来源校验，
    不要求 token（还没有 token 可带）。跨站页面会被来源校验挡掉。
    """
    from app.modules.messaging.guards import verify_visitor_origin

    verify_visitor_origin(request, app_settings)

    if visitor is None:
        visitor, raw = sessions.create_session(
            session,
            settings=settings,
            ip_hash=sessions.ip_digest(client_ip(request, app_settings), salt=app_settings.secret_key),
        )
        sessions.set_cookie(
            response, raw, is_production=app_settings.is_production, settings=settings
        )
    else:
        _touch(
            session,
            visitor,
            app_settings=app_settings,
            request=request,
            settings=settings,
        )
    session.commit()

    provider = resolve_provider(settings)
    return s.SessionOut(
        visitor=s.VisitorOut(
            id=str(visitor.id),
            expires_at=visitor.expires_at,
            absolute_expires_at=visitor.absolute_expires_at,
        ),
        csrf_token=sessions.visitor_csrf_token(visitor),
        characters=service.build_character_list(session, visitor_id=visitor.id),
        ai=_ai_state(settings, provider.name),
        usage=_usage(session, visitor, settings),
        disclosure=service.DISCLOSURE,
    )


@public_router.delete(
    "/session",
    status_code=204,
    summary="立即清除该访客的全部角色消息",
    dependencies=[Depends(private_no_store)],
)
def clear_session(
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
) -> Response:
    """「访客可以立即清除聊天」（08 §7）。

    全站日预算计数**不**因此回退：已经产生的上游成本仍然如实保留（08 §7）。

    清除 Cookie 写在**返回的那个** Response 上：FastAPI 会合并注入的 response 与
    返回值的头，但依赖合并顺序迟早会咬人，这里直接构造、直接返回，行为可断言。
    """
    sessions.delete_session(session, context.row)
    session.commit()
    out = Response(status_code=204)
    sessions.clear_cookie(out, is_production=app_settings.is_production)
    return out


# --- 会话 ------------------------------------------------------------------


def _load_or_create(
    session: Session,
    *,
    visitor: m.VisitorSession,
    character_id: str,
    settings: MessagingSettings,
    now=None,
) -> m.Conversation:
    card = get_character(character_id)
    if card is None:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "没有这个角色",
            status_code=422,
            fields={"character_id": ["角色不存在"]},
        )
    conversation, _created = service.get_or_create_conversation(
        session, visitor=visitor, character=card, settings=settings, now=now
    )
    return conversation


@public_router.post(
    "/conversations",
    response_model=s.ConversationOut,
    summary="取得或创建某角色的会话",
    dependencies=[Depends(private_no_store)],
)
def create_conversation(
    payload: s.ConversationCreateIn,
    request: Request,
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.ConversationOut:
    """按角色 id 取得会话。**同一角色只会有一段会话**，两个标签页共用同一顺序。"""
    _touch(
        session, context.row, app_settings=app_settings, request=request, settings=settings
    )
    sessions.purge_stale_from_session(session, context.row, now=utcnow())
    conversation = _load_or_create(
        session, visitor=context.row, character_id=payload.character_id, settings=settings
    )
    session.commit()
    provider = resolve_provider(settings)
    return service.build_view(
        session,
        conversation,
        ai=_ai_state(settings, provider.name),
        usage=_usage(session, context.row, settings),
    )


def _read_owned(
    session: Session, context: VisitorContext, conversation_id: str
) -> m.Conversation:
    return service.load_owned_conversation(session, context.row.id, conversation_id)


@public_router.get(
    "/conversations/{conversation_id}",
    response_model=s.ConversationOut,
    summary="读取会话",
    dependencies=[Depends(private_no_store)],
)
def read_conversation(
    conversation_id: str,
    context: VisitorContext = Depends(require_visitor),
    session: Session = Depends(get_session),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.ConversationOut:
    conversation = _read_owned(session, context, conversation_id)
    provider = resolve_provider(settings)
    return service.build_view(
        session,
        conversation,
        ai=_ai_state(settings, provider.name),
        usage=_usage(session, context.row, settings),
    )


@public_router.post(
    "/conversations/{conversation_id}/choice",
    response_model=s.ConversationOut,
    summary="选择一个预设选项",
    dependencies=[Depends(private_no_store)],
)
def choose_option(
    conversation_id: str,
    payload: s.ChoiceIn,
    request: Request,
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.ConversationOut:
    """非法或过期的选项**不会推进剧情**：422（选项不属于当前节点）/ 409（节点版本过期）。"""
    _touch(
        session, context.row, app_settings=app_settings, request=request, settings=settings
    )
    conversation = service.choose(
        session,
        visitor=context.row,
        conversation_id=conversation_id,
        choice_id=payload.choice_id,
        node_id=payload.node_id,
        node_version=payload.node_version,
        client_message_id=payload.client_message_id,
        settings=settings,
    )
    session.commit()
    provider = resolve_provider(settings)
    return service.build_view(
        session,
        conversation,
        ai=_ai_state(settings, provider.name),
        usage=_usage(session, context.row, settings),
    )


@public_router.post(
    "/conversations/{conversation_id}/messages",
    response_model=s.ConversationOut,
    summary="自由输入（调用 AI 适配层）",
    dependencies=[Depends(private_no_store)],
)
async def send_message(
    conversation_id: str,
    payload: s.MessageIn,
    request: Request,
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.ConversationOut:
    """幂等键是 `client_request_id`（作用域 = 当前访客会话）。重试不会重复调用上游。"""
    _touch(
        session, context.row, app_settings=app_settings, request=request, settings=settings
    )
    provider = resolve_provider(settings)
    outcome = await service.send_free_message(
        session,
        visitor=context.row,
        conversation_id=conversation_id,
        text=payload.text,
        client_request_id=payload.client_request_id,
        settings=settings,
        provider=provider,
        ip_hash=context.row.ip_hash,
    )
    return outcome.view


@public_router.post(
    "/conversations/{conversation_id}/resume",
    response_model=s.ConversationOut,
    summary="回到话题",
    dependencies=[Depends(private_no_store)],
)
def resume_topic(
    conversation_id: str,
    payload: s.NodeVersionIn,
    request: Request,
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.ConversationOut:
    """恢复被暂停的节点与它的选项；重复调用是幂等的空操作。"""
    _touch(
        session, context.row, app_settings=app_settings, request=request, settings=settings
    )
    conversation, _inserted = service.resume(
        session,
        visitor=context.row,
        conversation_id=conversation_id,
        node_version=payload.node_version,
        settings=settings,
    )
    session.commit()
    provider = resolve_provider(settings)
    return service.build_view(
        session,
        conversation,
        ai=_ai_state(settings, provider.name),
        usage=_usage(session, context.row, settings),
    )


@public_router.post(
    "/conversations/{conversation_id}/restart",
    response_model=s.ConversationOut,
    summary="重开这段剧情（保留聊天记录）",
    dependencies=[Depends(private_no_store)],
)
def restart_story(
    conversation_id: str,
    payload: s.NodeVersionIn,
    request: Request,
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    app_settings: Settings = Depends(get_settings_dep),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> s.ConversationOut:
    _touch(
        session, context.row, app_settings=app_settings, request=request, settings=settings
    )
    conversation = service.restart(
        session,
        visitor=context.row,
        conversation_id=conversation_id,
        node_version=payload.node_version,
        settings=settings,
    )
    session.commit()
    provider = resolve_provider(settings)
    return service.build_view(
        session,
        conversation,
        ai=_ai_state(settings, provider.name),
        usage=_usage(session, context.row, settings),
    )


@public_router.delete(
    "/conversations/{conversation_id}",
    status_code=204,
    summary="清除这段会话",
    dependencies=[Depends(private_no_store)],
)
def delete_conversation(
    conversation_id: str,
    context: VisitorContext = Depends(require_visitor_write),
    session: Session = Depends(get_session),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> Response:
    service.clear_conversation(
        session, visitor=context.row, conversation_id=conversation_id
    )
    session.commit()
    return Response(status_code=204)


# --- 管理 ------------------------------------------------------------------


@admin_router.get(
    "/overview",
    response_model=dict,
    summary="运行配置与今日用量（成本不隐藏）",
    dependencies=[Depends(private_no_store)],
)
def admin_overview(
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
    settings: MessagingSettings = Depends(messaging_settings_dep),
) -> dict:
    """给站主看的真实数字：今天到底花了多少单位、有多少会话与消息。

    `config` 走 `safe_summary()`，密钥只以「是否设置」出现。
    """
    day = budget_mod.utc_day()
    snapshot = budget_mod.usage_snapshot(session, day=day, settings=settings)
    conversation_count = int(
        session.execute(select(func.count()).select_from(m.Conversation)).scalar_one()
    )
    visitor_count = int(
        session.execute(select(func.count()).select_from(m.VisitorSession)).scalar_one()
    )
    message_count = int(session.execute(select(func.count()).select_from(m.Message)).scalar_one())
    ai_request_count = int(
        session.execute(select(func.count()).select_from(m.AiRequest)).scalar_one()
    )
    by_status = {
        status: int(total)
        for status, total in session.execute(
            select(m.AiRequest.status, func.count()).group_by(m.AiRequest.status)
        )
    }
    provider = resolve_provider(settings)
    return {
        "ai": _ai_state(settings, provider.name).model_dump(),
        "ai_provider": provider.name,
        "config": settings.safe_summary(),
        "limits": service.limits_out(settings).model_dump(),
        "usage_today": {
            "day": day.isoformat(),
            "site_reserved_units": snapshot.site_reserved_units,
            "site_settled_units": snapshot.site_settled_units,
            "site_request_count": snapshot.site_request_count,
            "site_daily_units": snapshot.site_daily_units,
            "inflight": snapshot.inflight,
            "ai_requests_by_status": by_status,
        },
        "totals": {
            "visitor_sessions": visitor_count,
            "conversations": conversation_count,
            "messages": message_count,
            "ai_requests": ai_request_count,
        },
        "retention": {
            "visitor_session_idle_seconds": settings.visitor_session_idle_seconds,
            "visitor_session_absolute_seconds": settings.visitor_session_absolute_seconds,
            "conversation_idle_seconds": settings.conversation_idle_seconds,
            "purge_entrypoint": "app.modules.messaging.sessions.purge_expired",
            "note": (
                "到期数据由 sessions.purge_expired(session) 物理删除；"
                "调度窗口与备份排除规则由 T10 核实。"
            ),
        },
        "provider_notes": service.provider_notes(settings),
    }


__all__ = ["admin_router", "public_router", "require_visitor", "router"]
