"""技能 DTO（05 §6 公开 / §7 管理、07 §6）。

公开与管理的字段集**在类型层面**分开（05 §7「公开响应不因站主登录就顺便返回草稿」）：

  - 公开（`SkillSummaryOut` / `SkillDetailOut` / `SkillProjectRefOut`）只含 slug、名称、
    领域、范围说明、掌握证据、站外证据链接、**当前公开**的关联作品、以及实时算出的
    `project_count`。**不含** status / version / deleted_at / 草稿关联。
  - 管理（`SkillAdminOut`）含 `version`（配 ETag）、状态、展示顺序与完整项目关系
    （按 position 排好，含草稿作品），用于表单回显与预览。

刻意**没有**的字段（07 §6「不自封数值等级」、任务卡「不伪造等级数字」）：

  - 没有 `level` / `rank` / `score` / `percent` / `years` / `stars`。
    没有任何一个位置能塞一个编出来的掌握度数字。
  - 没有 `post_count` / `view_count` 之类的缓存列：`project_count` 每次由真实关系
    实时统计，不拿它当权限条件（与 nav / moments / projects 一致）。

「技术标签」（任务卡「与项目技术标签的关系明确」）的处理方式：
`SkillDetailOut.tech_overlap` 是**算出来的**一致性诊断 —— 当前公开关联作品的
`tech_stack` 里，与本技能**同名**（NFKC + 大小写折叠后相等）的项。
它不是一份要维护的数据，而是「技能名与作品技术栈是否对得上」的只读提示。
技能表刻意不存技术标签副本，因此不存在两份同名字段各自维护不同事实的问题。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.skills.links import LINK_KINDS, normalize_link_url, normalize_links
from app.modules.skills.models import (
    DOMAIN_LABELS,
    DOMAIN_MAX_LENGTH,
    DOMAIN_OTHER,
    EVIDENCE_MAX_CODEPOINTS,
    LINK_LABEL_MAX_LENGTH,
    LINKS_MAX_ITEMS,
    LINK_URL_MAX_LENGTH,
    MAX_PROJECTS_PER_SKILL,
    NAME_MAX_LENGTH,
    SCOPE_MAX_CODEPOINTS,
    SKILL_DOMAINS,
    SKILL_STATUSES,
    SLUG_MAX_LENGTH,
    Skill,
)

# slug 是公开 URL 的一部分：只允许小写字母 / 数字 / 单连字符分段（与 nav / projects 同形，
# 保证「/velvet/<slug>」稳定可读音）。
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

SkillStatus = Literal["draft", "published"]
SkillDomain = Literal[
    "algorithm", "frontend", "backend", "data", "signal", "systems", "tooling", "other"
]

# 「合体」一次最多返回多少件交集作品。个人站点的作品数量有限，这个上限只是护栏；
# 超过时**不截断结果**，而是在响应里如实说明（见 service.combo_projects）。
COMBO_MAX_ITEMS = 24


# --- 链接 -------------------------------------------------------------------


class SkillLinkIn(BaseModel):
    """一条站外证据链接。只接受 http / https（见 `links.normalize_link_url`）。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["repo", "demo", "docs", "proof", "other"] = "other"
    label: str = Field(min_length=1, max_length=LINK_LABEL_MAX_LENGTH)
    url: str = Field(min_length=1, max_length=LINK_URL_MAX_LENGTH)

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("链接文字不能只有空白")
        return text

    @field_validator("url")
    @classmethod
    def _url_is_http(cls, value: str) -> str:
        return normalize_link_url(value)


class SkillLinkOut(BaseModel):
    kind: str
    label: str
    url: str


# --- 公开 DTO ---------------------------------------------------------------


class SkillProjectRefOut(BaseModel):
    """技能关联到的一件**当前公开**作品（只给跳转必需的最小字段）。

    这里刻意不给 `tech_stack` / `role` 等正文：技能全书要展示的是「有哪些真实证据」，
    作品的完整说明仍只有一份，在 `/showcase/projects/<slug>` 与 `/projects/<slug>`（05 §6）。
    """

    id: uuid.UUID
    slug: str
    title: str
    summary: str
    maintenance: str
    maintenance_label: str
    published_at: datetime


class SkillSummaryOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    domain: str
    domain_label: str
    scope: str
    evidence: str
    position: int
    links: list[SkillLinkOut]
    project_count: int


class SkillDetailOut(SkillSummaryOut):
    projects: list[SkillProjectRefOut]
    # 「当前公开关联作品的技术栈里，与本技能同名的项」——只读一致性诊断，不是等级。
    tech_overlap: list[str]


class SkillListOut(BaseModel):
    items: list[SkillSummaryOut]
    next_cursor: str | None


class SkillComboOut(BaseModel):
    """「合体」筛选结果（07 §6）。

    两个技能与交集作品一起返回，调用方不需要再发第二次请求去补技能信息。
    空交集是完全正常的结果：`items` 为空、`note` 明确说明还没有对应作品，
    **不会**用 AI 生成一个概念顶替（任务卡执行清单）。
    """

    a: SkillSummaryOut
    b: SkillSummaryOut
    items: list[SkillProjectRefOut]
    note: str


# --- 管理 DTO ---------------------------------------------------------------


class SkillProjectRelationIn(BaseModel):
    """技能 → 作品关系的一条。`project_id` 必须是**已有**作品（复用，不复制履历）。"""

    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    position: int = Field(ge=0, le=MAX_PROJECTS_PER_SKILL - 1)


class SkillProjectRelationOut(BaseModel):
    """管理回执里的一条关系：附带作品标题与状态，让表单能显示「关联了一件草稿」。"""

    project_id: uuid.UUID
    slug: str
    title: str
    status: str
    position: int


class SkillCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=SLUG_MAX_LENGTH, pattern=SLUG_PATTERN)
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    domain: SkillDomain = DOMAIN_OTHER
    scope: str = Field(default="", max_length=SCOPE_MAX_CODEPOINTS)
    evidence: str = Field(default="", max_length=EVIDENCE_MAX_CODEPOINTS)
    links: list[SkillLinkIn] = Field(default_factory=list, max_length=LINKS_MAX_ITEMS)
    position: int = Field(default=0, ge=0)
    projects: list[SkillProjectRelationIn] = Field(
        default_factory=list, max_length=MAX_PROJECTS_PER_SKILL
    )

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("技能名称不能只有空白")
        return text

    @field_validator("scope", "evidence")
    @classmethod
    def _trim(cls, value: str) -> str:
        return (value or "").strip()


class SkillUpdateIn(BaseModel):
    """PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先，与 nav / projects 一致）。"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX_LENGTH)
    domain: SkillDomain | None = None
    scope: str | None = Field(default=None, max_length=SCOPE_MAX_CODEPOINTS)
    evidence: str | None = Field(default=None, max_length=EVIDENCE_MAX_CODEPOINTS)
    links: list[SkillLinkIn] | None = Field(default=None, max_length=LINKS_MAX_ITEMS)
    position: int | None = Field(default=None, ge=0)
    # 传列表 = 完整替换关联；字段不出现 = 保持不变。
    projects: list[SkillProjectRelationIn] | None = Field(
        default=None, max_length=MAX_PROJECTS_PER_SKILL
    )

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("技能名称不能只有空白")
        return text


class SkillAdminOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    domain: str
    domain_label: str
    scope: str
    evidence: str
    links: list[SkillLinkOut]
    position: int
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int
    projects: list[SkillProjectRelationOut]


class SkillAdminListOut(BaseModel):
    items: list[SkillAdminOut]
    next_cursor: str | None


# --- 序列化 -----------------------------------------------------------------


def domain_label(value: str) -> str:
    return DOMAIN_LABELS.get(value, DOMAIN_LABELS[DOMAIN_OTHER])


def _links_out(raw_links: object) -> list[SkillLinkOut]:
    entries: list[SkillLinkOut] = []
    for item in raw_links or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind", "other"))
        entries.append(
            SkillLinkOut(
                kind=kind if kind in LINK_KINDS else "other",
                label=str(item.get("label", "")),
                url=str(item.get("url", "")),
            )
        )
    return entries


def summary_out(skill: Skill, *, project_count: int) -> SkillSummaryOut:
    return SkillSummaryOut(
        id=skill.id,
        slug=skill.slug,
        name=skill.name,
        domain=str(skill.domain),
        domain_label=domain_label(str(skill.domain)),
        scope=skill.scope or "",
        evidence=skill.evidence or "",
        position=int(skill.position),
        links=_links_out(skill.links),
        project_count=int(project_count),
    )


def detail_out(
    skill: Skill,
    *,
    projects: list[SkillProjectRefOut],
    tech_overlap: list[str],
) -> SkillDetailOut:
    return SkillDetailOut(
        **summary_out(skill, project_count=len(projects)).model_dump(),
        projects=projects,
        tech_overlap=tech_overlap,
    )


def admin_out(
    skill: Skill, *, projects: list[SkillProjectRelationOut]
) -> SkillAdminOut:
    return SkillAdminOut(
        id=skill.id,
        slug=skill.slug,
        name=skill.name,
        domain=str(skill.domain),
        domain_label=domain_label(str(skill.domain)),
        scope=skill.scope or "",
        evidence=skill.evidence or "",
        links=_links_out(skill.links),
        position=int(skill.position),
        status=str(skill.status),
        published_at=skill.published_at,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
        version=int(skill.version),
        projects=projects,
    )


def normalize_skill_links(links: list[SkillLinkIn] | None) -> list[dict[str, str]]:
    """把入参链接归一化成可入库的 JSONB 值（去重、只留 http/https）。"""
    if not links:
        return []
    payload: list[dict[str, object]] = []
    for link in links:
        if isinstance(link, SkillLinkIn):
            payload.append(link.model_dump())
        elif isinstance(link, dict):
            payload.append(link)
    return normalize_links(payload)


__all__ = [
    "COMBO_MAX_ITEMS",
    "SLUG_PATTERN",
    "SKILL_DOMAINS",
    "SKILL_STATUSES",
    "SkillAdminListOut",
    "SkillAdminOut",
    "SkillComboOut",
    "SkillCreateIn",
    "SkillDetailOut",
    "SkillLinkIn",
    "SkillLinkOut",
    "SkillListOut",
    "SkillProjectRefOut",
    "SkillProjectRelationIn",
    "SkillProjectRelationOut",
    "SkillSummaryOut",
    "SkillUpdateIn",
    "admin_out",
    "detail_out",
    "domain_label",
    "normalize_skill_links",
    "summary_out",
]
