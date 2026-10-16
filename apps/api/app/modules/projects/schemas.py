"""作品 DTO（05 §6 公开 / §7 管理、07 §5）。

公开与管理的字段集**在类型层面**分开（05 §7「公开响应不因站主登录就顺便返回草稿」）：

  - 公开（`ProjectSummaryOut` / `ProjectDetailOut` / `ProjectLinkOut` / `ProjectImageOut`）
    只含 slug、标题、一句话用途、技术栈、维护状态、已发布图片。**不含** status /
    version / deleted_at / 草稿图片关系 / 未发布的关联专题标题。
  - 管理（`ProjectAdminOut`）含 `version`（配 ETag）、状态、完整长文本、完整图片关系
    （含 caption / alt / taken_on，不过滤未 ready 的图），用于表单回显与预览。

字段长度按**码点**计数（05 §2），不是字节长度。

链接（`links`）只接受 `http` / `https`：不接受 `javascript:` / `data:` / 本机绝对路径
（SHARED-CONTRACTS §1「不新增任意 HTML / 脚本执行」、ACCEPTANCE §1「不新增绝对本机
素材路径」）。`taken_on` 允许为空 —— 素材没有拍摄时间时就是空，不替站主编一个。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.media.models import Media
from app.modules.media.schemas import MediaVariantOut, _variant_payloads
from app.modules.projects.models import (
    ALT_MAX_CODEPOINTS,
    BODY_MAX_LENGTH,
    CAPTION_MAX_LENGTH,
    LINK_LABEL_MAX_LENGTH,
    LINK_URL_MAX_LENGTH,
    LINKS_MAX_ITEMS,
    MAINTENANCE_LABELS,
    MAINTENANCE_STATES,
    MAX_MEDIA_PER_PROJECT,
    PROJECT_MEDIA_KINDS,
    PROJECT_STATUSES,
    SUMMARY_MAX_LENGTH,
    TECH_ITEM_MAX_LENGTH,
    TECH_MAX_ITEMS,
    TITLE_MAX_LENGTH,
    Project,
)

# slug 是公开 URL 的一部分：只允许小写字母 / 数字 / 单连字符分段（与 nav 的专题同形，
# 保证「/showcase/projects/<slug>」稳定可读音）。
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

ProjectStatus = Literal["draft", "published"]
MaintenanceState = Literal["active", "maintained", "paused", "archived"]
# 图片用途：cover = 卡片 / 详情头图，detail = 详情页附图，evidence = 成果证据。
# 取值来自 models（CHECK 约束用的是同一份元组，不在这里另抄一遍）。
ProjectImageKind = Literal["cover", "detail", "evidence"]
PROJECT_IMAGE_KINDS: tuple[str, ...] = PROJECT_MEDIA_KINDS

LinkUrl = Annotated[str, Field(min_length=1, max_length=LINK_URL_MAX_LENGTH)]


def normalize_link_url(raw: str) -> str:
    """校验并归一化一个站外链接。不接受非 http(s) 与非绝对地址。"""
    candidate = (raw or "").strip()
    if not candidate:
        raise ValueError("链接不能为空")
    if len(candidate) > LINK_URL_MAX_LENGTH:
        raise ValueError(f"链接最长 {LINK_URL_MAX_LENGTH} 个字符")
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https"):
        raise ValueError("链接必须是以 http:// 或 https:// 开头的站外地址")
    if not parts.netloc:
        raise ValueError("链接缺少主机名")
    return candidate


class ProjectLinkIn(BaseModel):
    kind: Literal["repo", "demo", "docs", "other"]
    label: str = Field(min_length=1, max_length=LINK_LABEL_MAX_LENGTH)
    url: LinkUrl

    @field_validator("url")
    @classmethod
    def _url_is_http(cls, value: str) -> str:
        return normalize_link_url(value)

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("链接文字不能只有空白")
        return text


class ProjectLinkOut(BaseModel):
    kind: str
    label: str
    url: str


class ProjectImageIn(BaseModel):
    """一张作品图片。`media_id` 必须是**已有**媒体（复用，不重复上传 —— 07 §5）。"""

    model_config = ConfigDict(extra="forbid")

    media_id: uuid.UUID
    position: int = Field(ge=0, le=MAX_MEDIA_PER_PROJECT - 1)
    kind: ProjectImageKind = "detail"
    alt: str = Field(min_length=1, max_length=ALT_MAX_CODEPOINTS)
    caption: str = Field(default="", max_length=CAPTION_MAX_LENGTH)
    # 拍摄 / 截图时间可空（07 §5）。没有素材时间就留空，不编一个。
    taken_on: date | None = None

    @field_validator("alt")
    @classmethod
    def _alt_not_blank(cls, value: str) -> str:
        # 图片替代文本是硬要求（验收 §1「图片有 alt」）：纯空白不算填写。
        text = value.strip()
        if not text:
            raise ValueError("替代文本不能只有空白")
        return text

    @field_validator("caption")
    @classmethod
    def _caption_trim(cls, value: str) -> str:
        return (value or "").strip()


class ProjectImageOut(BaseModel):
    """公开图片：只给可用变体与尺寸，不给服务器路径或原图。"""

    media_id: uuid.UUID
    position: int
    kind: str
    alt: str
    caption: str
    taken_on: date | None
    width: int
    height: int
    variants: list[MediaVariantOut]


class ProjectAdminImageOut(ProjectImageOut):
    """管理回执：额外给出媒体状态，让表单能提示「这张图还不能发布」。"""

    media_status: str = "ready"
    media_deleted: bool = False


class ProjectSummaryOut(BaseModel):
    """公开摘要（列表卡片）。`palace` 只在专题**当前公开**时才出现。"""

    id: uuid.UUID
    slug: str
    title: str
    summary: str
    tech_stack: list[str]
    maintenance: str
    maintenance_label: str
    published_at: datetime
    cover: ProjectImageOut | None
    palace: "ProjectPalaceLinkOut | None"


class ProjectPalaceLinkOut(BaseModel):
    """作品详情「攻略记录」用的专题链接。

    只包含 slug 与标题 —— 且**只在专题当前公开时**由 service 填值；专题撤回后这里是
    `None`，页面显示「暂时没有可读的攻略记录」，绝不露出隐藏专题的标题（验收 5）。
    """

    slug: str
    title: str
    summary: str


class ProjectDetailOut(ProjectSummaryOut):
    """公开详情（07 §5：「这个作品回答了『你做出了什么』」）。"""

    role: str
    problem: str
    tradeoffs: str
    outcomes: str
    links: list[ProjectLinkOut]
    images: list[ProjectImageOut]


class ProjectListOut(BaseModel):
    items: list[ProjectSummaryOut]
    next_cursor: str | None


# --- 管理 DTO ---------------------------------------------------------------


class ProjectCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1, max_length=200, pattern=SLUG_PATTERN)
    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    summary: str = Field(default="", max_length=SUMMARY_MAX_LENGTH)
    role: str = Field(default="", max_length=BODY_MAX_LENGTH)
    problem: str = Field(default="", max_length=BODY_MAX_LENGTH)
    tradeoffs: str = Field(default="", max_length=BODY_MAX_LENGTH)
    outcomes: str = Field(default="", max_length=BODY_MAX_LENGTH)
    tech_stack: list[str] = Field(default_factory=list, max_length=TECH_MAX_ITEMS)
    links: list[ProjectLinkIn] = Field(default_factory=list, max_length=LINKS_MAX_ITEMS)
    maintenance: MaintenanceState = "maintained"
    palace_id: uuid.UUID | None = None
    images: list[ProjectImageIn] = Field(default_factory=list, max_length=MAX_MEDIA_PER_PROJECT)

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("标题不能只有空白")
        return text

    @field_validator("summary")
    @classmethod
    def _summary_trim(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("tech_stack")
    @classmethod
    def _tech_clean(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = (item or "").strip()
            if not text:
                continue
            if len(text) > TECH_ITEM_MAX_LENGTH:
                raise ValueError(f"技术项最长 {TECH_ITEM_MAX_LENGTH} 个字符")
            if text not in cleaned:
                cleaned.append(text)
        if len(cleaned) > TECH_MAX_ITEMS:
            raise ValueError(f"技术栈最多 {TECH_MAX_ITEMS} 项")
        return cleaned


class ProjectUpdateIn(BaseModel):
    """PATCH：只改出现过的字段。`slug` 不可改（公开 URL 稳定优先，与 nav 一致）。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX_LENGTH)
    summary: str | None = Field(default=None, max_length=SUMMARY_MAX_LENGTH)
    role: str | None = Field(default=None, max_length=BODY_MAX_LENGTH)
    problem: str | None = Field(default=None, max_length=BODY_MAX_LENGTH)
    tradeoffs: str | None = Field(default=None, max_length=BODY_MAX_LENGTH)
    outcomes: str | None = Field(default=None, max_length=BODY_MAX_LENGTH)
    tech_stack: list[str] | None = Field(default=None, max_length=TECH_MAX_ITEMS)
    links: list[ProjectLinkIn] | None = Field(default=None, max_length=LINKS_MAX_ITEMS)
    maintenance: MaintenanceState | None = None
    # 传 null = 解除关联；字段不出现 = 保持不变。
    palace_id: uuid.UUID | None = None
    images: list[ProjectImageIn] | None = Field(default=None, max_length=MAX_MEDIA_PER_PROJECT)

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("标题不能只有空白")
        return text

    @field_validator("tech_stack")
    @classmethod
    def _tech_clean(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return ProjectCreateIn._tech_clean(value)


class ProjectAdminOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    summary: str
    role: str
    problem: str
    tradeoffs: str
    outcomes: str
    tech_stack: list[str]
    links: list[ProjectLinkOut]
    maintenance: str
    maintenance_label: str
    palace_id: uuid.UUID | None
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    version: int
    images: list[ProjectAdminImageOut]


class ProjectAdminListOut(BaseModel):
    items: list[ProjectAdminOut]
    next_cursor: str | None


ProjectSummaryOut.model_rebuild()


# --- 序列化 -----------------------------------------------------------------


def _image_payload(
    media: Media, *, position: int, kind: str, alt: str, caption: str, taken_on: date | None
) -> ProjectImageOut:
    return ProjectImageOut(
        media_id=media.id,
        position=position,
        kind=kind,
        alt=alt,
        caption=caption,
        taken_on=taken_on,
        width=int(media.width),
        height=int(media.height),
        # 公开图片**永不**包含 original 变体（05 §8：原图只给站主）。
        variants=_variant_payloads(media, include_original=False),
    )


def admin_image_payload(
    media: Media, *, position: int, kind: str, alt: str, caption: str, taken_on: date | None
) -> ProjectAdminImageOut:
    public = _image_payload(
        media, position=position, kind=kind, alt=alt, caption=caption, taken_on=taken_on
    )
    return ProjectAdminImageOut(
        **public.model_dump(),
        media_status=str(media.status),
        media_deleted=media.deleted_at is not None,
    )


def cover_of(images: list[ProjectImageOut]) -> ProjectImageOut | None:
    """封面 = `kind == "cover"` 里 position 最小的那张；没有则退回 position 最小的图。

    「效果图」在 07 §5 里是作品卡片的门面；站主没标 cover 时用第一张图，
    比留一个空占位更接近「素材不足就少显示一块」的原则。
    """
    if not images:
        return None
    covers = [image for image in images if image.kind == "cover"]
    pool = covers or images
    return min(pool, key=lambda image: image.position)


def summary_out(
    project: Project,
    *,
    images: list[ProjectImageOut],
    palace: ProjectPalaceLinkOut | None,
) -> ProjectSummaryOut:
    return ProjectSummaryOut(
        id=project.id,
        slug=project.slug,
        title=project.title,
        summary=project.summary,
        tech_stack=[str(item) for item in (project.tech_stack or [])],
        maintenance=str(project.maintenance),
        maintenance_label=MAINTENANCE_LABELS.get(str(project.maintenance), ""),
        published_at=project.published_at,
        cover=cover_of(images),
        palace=palace,
    )


def detail_out(
    project: Project,
    *,
    images: list[ProjectImageOut],
    palace: ProjectPalaceLinkOut | None,
) -> ProjectDetailOut:
    return ProjectDetailOut(
        **summary_out(project, images=images, palace=palace).model_dump(),
        role=project.role,
        problem=project.problem,
        tradeoffs=project.tradeoffs,
        outcomes=project.outcomes,
        links=[ProjectLinkOut(**link) for link in (project.links or [])],
        images=images,
    )


def admin_out(project: Project, *, images: list[ProjectAdminImageOut]) -> ProjectAdminOut:
    return ProjectAdminOut(
        id=project.id,
        slug=project.slug,
        title=project.title,
        summary=project.summary,
        role=project.role,
        problem=project.problem,
        tradeoffs=project.tradeoffs,
        outcomes=project.outcomes,
        tech_stack=[str(item) for item in (project.tech_stack or [])],
        links=[ProjectLinkOut(**link) for link in (project.links or [])],
        maintenance=str(project.maintenance),
        maintenance_label=MAINTENANCE_LABELS.get(str(project.maintenance), ""),
        palace_id=project.palace_id,
        status=str(project.status),
        published_at=project.published_at,
        created_at=project.created_at,
        updated_at=project.updated_at,
        version=int(project.version),
        images=images,
    )


__all__ = [
    "PROJECT_IMAGE_KINDS",
    "PROJECT_STATUSES",
    "ProjectAdminImageOut",
    "ProjectAdminListOut",
    "ProjectAdminOut",
    "ProjectCreateIn",
    "ProjectDetailOut",
    "ProjectImageIn",
    "ProjectImageOut",
    "ProjectLinkIn",
    "ProjectLinkOut",
    "ProjectListOut",
    "ProjectPalaceLinkOut",
    "ProjectSummaryOut",
    "ProjectUpdateIn",
    "admin_image_payload",
    "admin_out",
    "cover_of",
    "detail_out",
    "normalize_link_url",
    "summary_out",
]
