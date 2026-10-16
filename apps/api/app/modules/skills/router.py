"""技能路由（05 §6 / §7、07 §6）。

公开（匿名只读，`Cache-Control: no-store`）：

  GET  /skills                        全书列表；domain、cursor、limit → `{items, next_cursor}`
  GET  /skills/combo?a=&b=            「合体」：同时关联两个技能的当前公开作品（交集）
  GET  /skills/projects/{slug}        某件公开作品使用的公开技能（**同一关系来源**）
  GET  /skills/{slug}                 技能详情：范围说明、掌握证据、公开关联作品

管理（站主 + CSRF/Origin + `If-Match`，`Cache-Control: private, no-store`）：

  GET    /admin/skills                 管理列表（草稿与已发布都在）
  GET    /admin/skills/{id}            草稿 / 预览数据，响应带 `version` 与 `ETag`
  POST   /admin/skills                 新建草稿（201）
  PATCH  /admin/skills/{id}            更新；传 projects 时完整替换关联
  POST   /admin/skills/{id}/publish    发布（门槛：范围说明 + 掌握证据非空）
  POST   /admin/skills/{id}/unpublish  撤回回到 draft（**不删除作品关系**）
  DELETE /admin/skills/{id}            软删除（204）

要点：

  - **公开地址用 slug，管理地址用 UUID**（与 nav / projects 一致）。
  - 公开响应不因站主登录就顺便返回草稿（05 §7）：公开端点只用 `SkillDetailOut`。
  - 「合体」的两个技能都必须是**当前公开**技能：草稿技能与不存在的技能得到同一个
    404，不留下探测站主未发布内容的口子。选中同一个技能两次 → 422 明确报错，
    而不是把「全部作品」当成合体结果。
  - `/skills/combo` 与 `/skills/projects/{slug}` 必须注册在 `/skills/{slug}` **之前**：
    否则 `combo` 会被当成一个技能 slug（FastAPI 按注册顺序匹配）。
  - `If-Match` 缺失 428、版本不符 412，由 `app.core.preconditions` 统一处理。
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import get_session
from app.core.errors import CODE_NOT_FOUND, CODE_UNPROCESSABLE, ApiError
from app.core.http import no_store, private_no_store
from app.core.pagination import DEFAULT_LIMIT, MAX_LIMIT
from app.modules.auth import service as auth_service
from app.modules.auth.deps import AdminContext, require_admin, require_admin_write
from app.modules.projects import service as projects_service
from app.modules.skills import service
from app.modules.skills.models import SKILL_DOMAINS, SKILL_STATUSES, Skill
from app.modules.skills.schemas import (
    SkillAdminListOut,
    SkillAdminOut,
    SkillComboOut,
    SkillCreateIn,
    SkillDetailOut,
    SkillListOut,
    SkillSummaryOut,
    SkillUpdateIn,
    admin_out,
    detail_out,
    summary_out,
)

public_router = APIRouter(prefix="/skills", tags=["skills"])
admin_router = APIRouter(prefix="/admin/skills", tags=["admin-skills"])

router = APIRouter()
router.include_router(public_router)
router.include_router(admin_router)

ENTITY_TYPE = "skill"
AUDIT_CREATE = "skill.create"
AUDIT_UPDATE = "skill.update"
AUDIT_PUBLISH = "skill.publish"
AUDIT_UNPUBLISH = "skill.unpublish"
AUDIT_DELETE = "skill.delete"


def _parse_skill_id(skill_id: str) -> uuid.UUID:
    """技能 ID 必须是 UUID；格式不对与「不存在」同形 404（不给探测信号）。"""
    try:
        return uuid.UUID(skill_id)
    except (ValueError, AttributeError, TypeError):
        raise service.not_found() from None


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _audit(
    session: Session,
    *,
    action: str,
    skill: Skill,
    context: AdminContext,
    request: Request,
    extra: dict[str, Any] | None = None,
) -> None:
    """发布 / 撤回 / 删除属于管理动作，按 05 §3 记审计（不含正文与链接）。"""
    auth_service.record_audit(
        session,
        action=action,
        entity_type=ENTITY_TYPE,
        entity_id=skill.id,
        actor_id=context.user.id,
        request_id=_request_id(request),
        extra={"status": skill.status, "version": skill.version, **(extra or {})},
        commit=True,
    )


def _admin_payload(session: Session, skill: Skill) -> SkillAdminOut:
    relations = service.admin_relations_out(session, [skill.id]).get(skill.id, [])
    return admin_out(skill, projects=relations)


def _load_or_404(session: Session, skill_id: str) -> Skill:
    skill = service.get_admin_skill(session, _parse_skill_id(skill_id))
    if skill is None:
        raise service.not_found()
    return skill


def _summary_payload(session: Session, skill: Skill, *, count: int) -> SkillSummaryOut:
    return summary_out(skill, project_count=count)


# --- 公开 -----------------------------------------------------------------


@public_router.get("", response_model=SkillListOut, summary="技能全书列表")
def list_skills(
    response: Response,
    domain: str | None = Query(default=None, max_length=16),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    session: Session = Depends(get_session),
) -> SkillListOut:
    no_store(response)
    if domain is not None and domain not in SKILL_DOMAINS:
        # 非法筛选按字段错误返回，不静默当成「全部」。
        raise ApiError(
            CODE_UNPROCESSABLE,
            "技能领域筛选不合法",
            status_code=422,
            fields={"domain": [f"只能是 {' / '.join(SKILL_DOMAINS)}"]},
        )
    skills, next_cursor = service.list_public_skills(
        session, domain=domain, cursor=cursor, limit=limit
    )
    counts = service.project_counts_for_skills(session, [skill.id for skill in skills])
    return SkillListOut(
        items=[
            _summary_payload(session, skill, count=counts.get(skill.id, 0)) for skill in skills
        ],
        next_cursor=next_cursor,
    )


@public_router.get("/combo", response_model=SkillComboOut, summary="「合体」：两个技能的交集作品")
def read_combo(
    response: Response,
    a: str = Query(min_length=1, max_length=200, description="技能 A 的 slug"),
    b: str = Query(min_length=1, max_length=200, description="技能 B 的 slug"),
    session: Session = Depends(get_session),
) -> SkillComboOut:
    """「合体」筛选（07 §6）。

    三种业务结果是**分开**的，不混成一种：

      1. 技能 A 或 B 不存在 / 未发布 → 404（对外统一「技能不存在或未公开」）；
      2. A 与 B 是同一个技能 → 422（明确报错，不把全部作品冒充合体结果）；
      3. 两个技能都公开但**没有交集** → 200，`items` 为空 + `note` 说明，
         不用 AI 编造一件新作品（任务卡执行清单）。
    """
    no_store(response)
    skill_a = service.skill_for_combo(session, a.strip())
    skill_b = service.skill_for_combo(session, b.strip())
    if skill_a is None or skill_b is None:
        # 两个技能分别播报会泄漏「哪个 slug 存在」；统一一句话，且与草稿技能同形。
        raise ApiError(CODE_NOT_FOUND, "技能不存在或未公开", status_code=404)
    if skill_a.id == skill_b.id:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "「合体」需要两个不同的技能",
            status_code=422,
            fields={"b": ["不能和技能 A 选同一个技能"]},
        )

    projects = service.combo_projects(session, skill_a, skill_b)
    counts = service.project_counts_for_skills(session, [skill_a.id, skill_b.id])
    return SkillComboOut(
        a=summary_out(skill_a, project_count=counts.get(skill_a.id, 0)),
        b=summary_out(skill_b, project_count=counts.get(skill_b.id, 0)),
        items=[service.project_ref(project) for project in projects],
        note=service.combo_note(len(projects)),
    )


@public_router.get(
    "/projects/{slug}",
    response_model=list[SkillSummaryOut],
    summary="某件公开作品使用的公开技能",
)
def read_skills_for_project(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> list[SkillSummaryOut]:
    """作品详情「使用的技能」的数据入口（验收 2 的同一关系来源）。

    作品本身不公开（草稿 / 撤回 / 已删除 / 不存在）时返回 404 ——
    绝不能靠这个端点反查一件还没发布的作品的技能。
    """
    no_store(response)
    project = projects_service.get_public_project(session, slug)
    if project is None:
        raise ApiError(CODE_NOT_FOUND, "作品不存在或不可访问", status_code=404)
    skills = service.skills_for_project(session, project.id)
    counts = service.project_counts_for_skills(session, [skill.id for skill in skills])
    return [summary_out(skill, project_count=counts.get(skill.id, 0)) for skill in skills]


@public_router.get("/{slug}", response_model=SkillDetailOut, summary="技能详情")
def read_skill(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> SkillDetailOut:
    no_store(response)
    skill = service.get_public_skill(session, slug)
    if skill is None:
        # 草稿、已撤回、已删除、未到发布时间与不存在完全同形（05 §6）。
        raise service.not_found()
    projects = service.public_project_rows_for_skills(session, [skill.id]).get(skill.id, [])
    refs = [service.project_ref(project) for project in projects]
    return detail_out(
        skill, projects=refs, tech_overlap=service.tech_overlap(projects, skill.name)
    )


# --- 管理 -----------------------------------------------------------------


@admin_router.get(
    "",
    response_model=SkillAdminListOut,
    summary="管理列表（含草稿）",
    dependencies=[Depends(private_no_store)],
)
def list_admin_skills(
    status: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> SkillAdminListOut:
    if status is not None and status not in SKILL_STATUSES:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "状态筛选不合法",
            status_code=422,
            fields={"status": [f"只能是 {' / '.join(SKILL_STATUSES)}"]},
        )
    if domain is not None and domain not in SKILL_DOMAINS:
        raise ApiError(
            CODE_UNPROCESSABLE,
            "技能领域筛选不合法",
            status_code=422,
            fields={"domain": [f"只能是 {' / '.join(SKILL_DOMAINS)}"]},
        )
    skills, next_cursor = service.list_admin_skills(
        session, status=status, domain=domain, cursor=cursor, limit=limit
    )
    return SkillAdminListOut(
        items=[_admin_payload(session, skill) for skill in skills],
        next_cursor=next_cursor,
    )


@admin_router.get(
    "/{skill_id}",
    response_model=SkillAdminOut,
    summary="读取技能（草稿 / 预览）",
    dependencies=[Depends(private_no_store)],
)
def read_admin_skill(
    skill_id: str,
    response: Response,
    _context: AdminContext = Depends(require_admin),
    session: Session = Depends(get_session),
) -> SkillAdminOut:
    skill = _load_or_404(session, skill_id)
    # ETag 与持久化行同源，保证「读到的 version」与「If-Match 要求的版本」不会漂移。
    response.headers["ETag"] = f'"{skill.version}"'
    return _admin_payload(session, skill)


@admin_router.post(
    "",
    response_model=SkillAdminOut,
    status_code=201,
    summary="新建草稿",
    dependencies=[Depends(private_no_store)],
)
def create_skill(
    payload: SkillCreateIn,
    request: Request,
    response: Response,
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> SkillAdminOut:
    skill = service.create_skill(session, **payload.model_dump(exclude_unset=True))
    _audit(session, action=AUDIT_CREATE, skill=skill, context=context, request=request)
    response.headers["ETag"] = f'"{skill.version}"'
    return _admin_payload(session, skill)


@admin_router.patch(
    "/{skill_id}",
    response_model=SkillAdminOut,
    summary="更新技能",
    dependencies=[Depends(private_no_store)],
)
def update_skill(
    skill_id: str,
    payload: SkillUpdateIn,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> SkillAdminOut:
    skill = _load_or_404(session, skill_id)
    patch = payload.model_dump(exclude_unset=True)
    service.update_skill(session, skill, patch=patch, if_match=if_match)
    _audit(session, action=AUDIT_UPDATE, skill=skill, context=context, request=request)
    response.headers["ETag"] = f'"{skill.version}"'
    return _admin_payload(session, skill)


@admin_router.post(
    "/{skill_id}/publish",
    response_model=SkillAdminOut,
    summary="发布技能",
    dependencies=[Depends(private_no_store)],
)
def publish_skill(
    skill_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> SkillAdminOut:
    skill = _load_or_404(session, skill_id)
    service.publish_skill(session, skill, if_match=if_match)
    _audit(
        session,
        action=AUDIT_PUBLISH,
        skill=skill,
        context=context,
        request=request,
        extra={
            "published_at": skill.published_at.isoformat() if skill.published_at else None
        },
    )
    response.headers["ETag"] = f'"{skill.version}"'
    return _admin_payload(session, skill)


@admin_router.post(
    "/{skill_id}/unpublish",
    response_model=SkillAdminOut,
    summary="撤回技能",
    dependencies=[Depends(private_no_store)],
)
def unpublish_skill(
    skill_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> SkillAdminOut:
    skill = _load_or_404(session, skill_id)
    service.unpublish_skill(session, skill, if_match=if_match)
    _audit(session, action=AUDIT_UNPUBLISH, skill=skill, context=context, request=request)
    response.headers["ETag"] = f'"{skill.version}"'
    return _admin_payload(session, skill)


@admin_router.delete(
    "/{skill_id}",
    status_code=204,
    summary="软删除技能",
    dependencies=[Depends(private_no_store)],
)
def delete_skill(
    skill_id: str,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    context: AdminContext = Depends(require_admin_write),
    session: Session = Depends(get_session),
) -> Response:
    skill = _load_or_404(session, skill_id)
    service.soft_delete_skill(session, skill, if_match=if_match)
    _audit(session, action=AUDIT_DELETE, skill=skill, context=context, request=request)
    return Response(status_code=204)
