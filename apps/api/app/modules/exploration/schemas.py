"""问题记录 DTO（05 §6 公开 / §7 管理、07 §6「印象空间」）。

公开与管理的字段集**在类型层面**分开（05 §7「公开响应不因站主登录就顺便返回草稿」）：

  - 公开（`RecordSummaryOut` / `RecordDetailOut`）只含标题、背景、尝试、结果、
    工作状态、结果链接与**当前公开**的关联文章 / 作品。**不含** status / version /
    deleted_at / 草稿关联。
  - 管理（`RecordAdminOut`）含 `version`（配 ETag）、发布状态、完整关系（含草稿，
    带标题与状态），用于表单回显与预览。

约束的三层分工（任务卡「已解决的记录要有实际说明与可选验证链接」）：

  1. **数据库**：`ck_exploration_records_resolved_at_valid` 保证「只有已解决才有解决时间」；
  2. **service**：工作状态为「已解决」时 `outcome` 不能只有空白（跨行 / 语义约束，
     不硬塞进 CHECK）；非解决状态自动清空 `resolved_at`；
  3. **这里**：字段长度、链接协议、关系条数在入参就挡住。

刻意**没有**的字段（验收 4「明确是站主整理」）：没有 `visitor_id` / `requester` /
`submitted_by` / `claimed_by` / `due_at`，也没有 `vote_count` —— 这是站主自己的探索日志，
不是公开请求板，更不是匿名待接工单。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.exploration.models import (
    ATTEMPTS_MAX_CODEPOINTS,
    BACKGROUND_MAX_CODEPOINTS,
    EXCERPT_MAX_CODEPOINTS,
    MAX_POSTS_PER_RECORD,
    MAX_PROJECTS_PER_RECORD,
    OUTCOME_MAX_CODEPOINTS,
    RECORD_STATUSES,
    SLUG_MAX_LENGTH,
    TITLE_MAX_CODEPOINTS,
    WORK_PENDING,
    WORK_STATUS_LABELS,
    WORK_STATUSES,
    ExplorationRecord,
)
from app.modules.skills.links import LINK_KINDS, normalize_link_url, normalize_links
from app.modules.skills.models import (
    LINK_LABEL_MAX_LENGTH,
    LINKS_MAX_ITEMS,
    LINK_URL_MAX_LENGTH,
)

# slug 是公开 URL 的一部分：只允许小写字母 / 数字 / 单连字符分段。
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

RecordStatus = Literal["draft", "published"]
WorkStatus = Literal["pending", "investigating", "resolved", "archived"]

RECORD_STATUS_LIST: tuple[str, ...] = RECORD_STATUSES
WORK_STATUS_LIST: tuple[str, ...] = WORK_STATUSES


# --- 链接（与技能共用同一个实现）--------------------------------------------


class EvidenceLinkIn(BaseModel):
    """一条结果 / 验证链接。只接受 http / https。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["repo", "demo", "docs", "proof", "other"] = "proof"
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


class EvidenceLinkOut(BaseModel):
    kind: str
    label: str
    url: str


# --- 关联引用 ---------------------------------------------------------------


class RelatedPostOut(BaseModel):
    """关联的**当前公开**文章。撤回文章后这条引用整条消失（不泄漏隐藏标题）。"""

    id: uuid.UUID
    slug: str
    title: str
    href: str


class RelatedProjectOut(BaseModel):
    """关联的**当前公开**作品。撤回作品后这条引用整条消失。"""

    id: uuid.UUID
    slug: str
    title: str
    summary: str
    href: str


class RelatedPostRelationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_id: uuid.UUID
    position: int = Field(ge=0, le=MAX_POSTS_PER_RECORD - 1)


class RelatedProjectRelationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    position: int = Field(ge=0, le=MAX_PROJECTS_PER_RECORD - 1)


class RelatedPostRelationOut(BaseModel):
    post_id: uuid.UUID
    slug: str
    title: str
    status: str
    position: int


class RelatedProjectRelationOut(BaseModel):
    project_id: uuid.UUID
    slug: str
    title: str
    status: str
    position: int


# --- 公开 DTO ---------------------------------------------------------------


class RecordSummaryOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    # 背景摘要（卡片用）。**不是**「完成度」或评分，只是背景的第一段。
    excerpt: str
    work_status: str
    work_status_label: str
    resolved_at: datetime | None
    published_at: datetime
    post_count: int
    project_count: int


class RecordDetailOut(RecordSummaryOut):
    background: str
    attempts: str
    outcome: str
    evidence_links: list[EvidenceLinkOut]
    posts: list[RelatedPostOut]
    projects: list[RelatedProjectOut]


class RecordListOut(BaseModel):
    items: list[RecordSummaryOut]
    next_cursor: str | None


class RecordStatsOut(BaseModel):
    """公开工作状态统计。

    只统计**当前公开**的记录，因此它与列表里能看到的条数完全一致 ——
    不把草稿算进来制造一个「其实还有 N 条隐藏记录」的暗示（验收 3）。
    """

    total: int
    by_work_status: dict[str, int]


# --- 管理 DTO ---------------------------------------------------------------


class RecordCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=SLUG_MAX_LENGTH, pattern=SLUG_PATTERN)
    title: str = Field(min_length=1, max_length=TITLE_MAX_CODEPOINTS)
    background: str = Field(default="", max_length=BACKGROUND_MAX_CODEPOINTS)
    attempts: str = Field(default="", max_length=ATTEMPTS_MAX_CODEPOINTS)
    outcome: str = Field(default="", max_length=OUTCOME_MAX_CODEPOINTS)
    evidence_links: list[EvidenceLinkIn] = Field(
        default_factory=list, max_length=LINKS_MAX_ITEMS
    )
    work_status: WorkStatus = WORK_PENDING
    posts: list[RelatedPostRelationIn] = Field(
        default_factory=list, max_length=MAX_POSTS_PER_RECORD
    )
    projects: list[RelatedProjectRelationIn] = Field(
        default_factory=list, max_length=MAX_PROJECTS_PER_RECORD
    )

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("标题不能只有空白")
        return text

    @field_validator("background", "attempts", "outcome")
    @classmethod
    def _trim(cls, value: str) -> str:
        return (value or "").strip()


class RecordUpdateIn(BaseModel):
    """PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先）。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX_CODEPOINTS)
    background: str | None = Field(default=None, max_length=BACKGROUND_MAX_CODEPOINTS)
    attempts: str | None = Field(default=None, max_length=ATTEMPTS_MAX_CODEPOINTS)
    outcome: str | None = Field(default=None, max_length=OUTCOME_MAX_CODEPOINTS)
    evidence_links: list[EvidenceLinkIn] | None = Field(default=None, max_length=LINKS_MAX_ITEMS)
    work_status: WorkStatus | None = None
    posts: list[RelatedPostRelationIn] | None = Field(
        default=None, max_length=MAX_POSTS_PER_RECORD
    )
    projects: list[RelatedProjectRelationIn] | None = Field(
        default=None, max_length=MAX_PROJECTS_PER_RECORD
    )

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("标题不能只有空白")
        return text

    @field_validator("background", "attempts", "outcome")
    @classmethod
    def _trim_optional(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()


class RecordAdminOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    background: str
    attempts: str
    outcome: str
    evidence_links: list[EvidenceLinkOut]
    work_status: str
    work_status_label: str
    resolved_at: datetime | None
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int
    posts: list[RelatedPostRelationOut]
    projects: list[RelatedProjectRelationOut]


class RecordAdminListOut(BaseModel):
    items: list[RecordAdminOut]
    next_cursor: str | None


# --- 序列化 -----------------------------------------------------------------


def work_status_label(value: str) -> str:
    return WORK_STATUS_LABELS.get(value, value)


def _links_out(raw_links: object) -> list[EvidenceLinkOut]:
    entries: list[EvidenceLinkOut] = []
    for item in raw_links or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind", "proof"))
        entries.append(
            EvidenceLinkOut(
                kind=kind if kind in LINK_KINDS else "other",
                label=str(item.get("label", "")),
                url=str(item.get("url", "")),
            )
        )
    return entries


def normalize_evidence_links(links: list[EvidenceLinkIn] | None) -> list[dict[str, str]]:
    if not links:
        return []
    payload: list[dict[str, object]] = []
    for link in links:
        if isinstance(link, EvidenceLinkIn):
            payload.append(link.model_dump())
        elif isinstance(link, dict):
            payload.append(link)
    return normalize_links(payload)


def excerpt_of(record: ExplorationRecord) -> str:
    """背景的第一段（按码点截断）。列表卡片用它，详情里读完整正文。"""
    text = (record.background or "").strip().replace("\r\n", "\n")
    first = text.split("\n\n", 1)[0].strip()
    if len(first) <= EXCERPT_MAX_CODEPOINTS:
        return first
    return f"{first[:EXCERPT_MAX_CODEPOINTS]}…"


def summary_out(
    record: ExplorationRecord, *, post_count: int, project_count: int
) -> RecordSummaryOut:
    return RecordSummaryOut(
        id=record.id,
        slug=record.slug,
        title=record.title,
        excerpt=excerpt_of(record),
        work_status=str(record.work_status),
        work_status_label=work_status_label(str(record.work_status)),
        resolved_at=record.resolved_at,
        published_at=record.published_at,
        post_count=int(post_count),
        project_count=int(project_count),
    )


def detail_out(
    record: ExplorationRecord,
    *,
    posts: list[RelatedPostOut],
    projects: list[RelatedProjectOut],
) -> RecordDetailOut:
    return RecordDetailOut(
        **summary_out(record, post_count=len(posts), project_count=len(projects)).model_dump(),
        background=record.background or "",
        attempts=record.attempts or "",
        outcome=record.outcome or "",
        evidence_links=_links_out(record.evidence_links),
        posts=posts,
        projects=projects,
    )


def admin_out(
    record: ExplorationRecord,
    *,
    posts: list[RelatedPostRelationOut],
    projects: list[RelatedProjectRelationOut],
) -> RecordAdminOut:
    return RecordAdminOut(
        id=record.id,
        slug=record.slug,
        title=record.title,
        background=record.background or "",
        attempts=record.attempts or "",
        outcome=record.outcome or "",
        evidence_links=_links_out(record.evidence_links),
        work_status=str(record.work_status),
        work_status_label=work_status_label(str(record.work_status)),
        resolved_at=record.resolved_at,
        status=str(record.status),
        published_at=record.published_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
        version=int(record.version),
        posts=posts,
        projects=projects,
    )


__all__ = [
    "EvidenceLinkIn",
    "EvidenceLinkOut",
    "RECORD_STATUS_LIST",
    "RecordAdminListOut",
    "RecordAdminOut",
    "RecordCreateIn",
    "RecordDetailOut",
    "RecordListOut",
    "RecordStatsOut",
    "RecordSummaryOut",
    "RecordUpdateIn",
    "RelatedPostOut",
    "RelatedPostRelationIn",
    "RelatedPostRelationOut",
    "RelatedProjectOut",
    "RelatedProjectRelationIn",
    "RelatedProjectRelationOut",
    "SLUG_PATTERN",
    "WORK_STATUS_LIST",
    "WORK_STATUS_LABELS",
    "admin_out",
    "detail_out",
    "excerpt_of",
    "normalize_evidence_links",
    "summary_out",
    "work_status_label",
]
