"""作品模型（07 §5「我的殿堂 · 作品展厅」、07 §8 的 `projects` 行）。

    projects        id / 唯一 slug / title / summary / role / problem / tradeoffs /
                    outcomes / tech_stack / links / status / published_at /
                    created_at / updated_at / deleted_at / version /
                    可选 palace_id（→ palaces，ON DELETE SET NULL）
    project_media   project_id / media_id / position / caption / alt
                    可选 taken_on；复合主键 → 同一作品同一媒体唯一

字段与设计文档的对应（07 §5：「每个作品展示：一句话用途、效果图、个人职责、技术栈、
解决的问题、关键取舍、可验证成果、仓库 / 演示链接和当前维护状态」）：

| 设计措辞 | 字段 |
| --- | --- |
| 一句话用途 | `summary` |
| 效果图 | 作品封面 = `project_media` 里 position 最小的那张 |
| 个人职责 | `role` |
| 技术栈 | `tech_stack`（JSONB 字符串数组，去重后有序） |
| 解决的问题 | `problem` |
| 关键取舍 | `tradeoffs` |
| 可验证成果 | `outcomes` |
| 仓库 / 演示链接 | `links`（JSONB，只允许 http/https 的站外地址） |
| 当前维护状态 | `maintenance`（active / maintained / archived / paused） |
| 关联专题 | `palace_id`（可空，**不把 project ID 塞进 `palace_posts`**） |

刻意**没有**的字段（07 §5 / 验收「不生成奖项或虚构数字」）：

  - 没有 `awards` / `stars` / `downloads` / `users` / `stars_count` 之类的成绩列。
    作品素材不足时页面就少显示一块，而不是让站主去填一个编出来的数字。
  - 没有把 `palace_posts` 改成多态关联表：`palace_posts.post_id` 仍然只指向 `posts`
    （05 §11：「不添加无外键验证的任意资源 ID」）。

数据库能表达的约束落在数据库（05 §3 末段）：

  - `ck_projects_status_valid`       只有 draft / published
  - `ck_projects_version_positive`   version >= 1
  - `ck_projects_maintenance_valid`  maintenance 取值枚举
  - `ck_project_media_position_range` position 在 0–19 之间（一个作品最多 20 张图）
  - `ck_project_media_alt_length`    alt 1–200 个码点
  - `pk_project_media`               复合主键 → 同一作品的 media_id 唯一
  - `uq_project_media_project_id_position`  同一作品的 position 唯一

「发布前至少有 1 张 ready 图片」「正文长度」属跨行 / 语义约束，由 service 在事务里
验证（与 T03 的 moments 同形），不硬塞进 CHECK。

`palace_id` 用 `ON DELETE SET NULL`：专题被**物理**删除时作品仍在，只是不再关联；
专题**软删除**（`deleted_at`）时公开侧由 nav 的公开条件过滤，作品页面不会露出
隐藏专题的标题（见 `service.py` 的 `palace_link_for_project`）。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    text as sql_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

PROJECT_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# 维护状态（07 §5「当前维护状态」）。取值是本站约定，不是游戏原版设定。
MAINTENANCE_ACTIVE = "active"
MAINTENANCE_MAINTAINED = "maintained"
MAINTENANCE_PAUSED = "paused"
MAINTENANCE_ARCHIVED = "archived"

MAINTENANCE_STATES = (
    MAINTENANCE_ACTIVE,
    MAINTENANCE_MAINTAINED,
    MAINTENANCE_PAUSED,
    MAINTENANCE_ARCHIVED,
)
MAINTENANCE_LABELS = {
    MAINTENANCE_ACTIVE: "正在开发",
    MAINTENANCE_MAINTAINED: "持续维护",
    MAINTENANCE_PAUSED: "暂停",
    MAINTENANCE_ARCHIVED: "已归档",
}

# 图片用途（作品展厅与相册的差别：作品的图分「封面 / 详情附图 / 成果证据」，
# 因为 07 §5 把「效果图」和「可验证成果」列为两件事）。
KIND_COVER = "cover"
KIND_DETAIL = "detail"
KIND_EVIDENCE = "evidence"

PROJECT_MEDIA_KINDS = (KIND_COVER, KIND_DETAIL, KIND_EVIDENCE)
PROJECT_MEDIA_KIND_LABELS = {
    KIND_COVER: "效果图",
    KIND_DETAIL: "详情附图",
    KIND_EVIDENCE: "成果证据",
}
DEFAULT_MEDIA_KIND = KIND_DETAIL

SLUG_MAX_LENGTH = 200
TITLE_MAX_LENGTH = 200
SUMMARY_MAX_LENGTH = 500
# 长文本字段：职责 / 问题 / 取舍 / 成果都是几段话，按 8000 码点封顶。
BODY_MAX_LENGTH = 8000
MAINTENANCE_MAX_LENGTH = 16

TECH_MAX_ITEMS = 24
TECH_ITEM_MAX_LENGTH = 40

LINKS_MAX_ITEMS = 8
LINK_LABEL_MAX_LENGTH = 40
LINK_URL_MAX_LENGTH = 500

# 一个作品最多 20 张图：个人站点的展厅规模，超过说明调用方搞错了。
MAX_MEDIA_PER_PROJECT = 20
CAPTION_MAX_LENGTH = 500
ALT_MIN_CODEPOINTS = 1
ALT_MAX_CODEPOINTS = 200

# 一个项目可以关联的公开专题数量上限（当前是一对一，留一点余量以便管理端合并重复项）。
MAX_PROJECTS_PER_PALACE = 200

_MAINTENANCE_IN_SQL = "maintenance in ('active', 'maintained', 'paused', 'archived')"


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(_MAINTENANCE_IN_SQL, name="maintenance_valid"),
        # 公开列表的部分索引：与 service.public_conditions 完全一致。
        Index(
            "ix_projects_public_listing",
            "published_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
        Index("ix_projects_palace_id", "palace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(SLUG_MAX_LENGTH), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    summary: Mapped[str] = mapped_column(String(SUMMARY_MAX_LENGTH), nullable=False, default="")
    role: Mapped[str] = mapped_column(Text, nullable=False, default="")
    problem: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tradeoffs: Mapped[str] = mapped_column(Text, nullable=False, default="")
    outcomes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tech_stack: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    links: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    maintenance: Mapped[str] = mapped_column(
        String(MAINTENANCE_MAX_LENGTH), nullable=False, default=MAINTENANCE_MAINTAINED
    )
    palace_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("palaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=STATUS_DRAFT)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    def bump_version(self) -> None:
        """成功修改后递增版本（05 §2 / §7）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


# 关联表：复合主键表达「同一作品的 media_id 唯一」，唯一约束表达「position 唯一」。
# 与 `moment_media` 同形（同一张图可以被动态、相册、作品同时引用 —— 07 §5）。
project_media = Table(
    "project_media",
    Base.metadata,
    Column(
        "project_id",
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "media_id",
        Uuid(as_uuid=True),
        ForeignKey("media.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Column("position", Integer, nullable=False),
    Column("kind", String(16), nullable=False, default=DEFAULT_MEDIA_KIND),
    Column("alt", String(ALT_MAX_CODEPOINTS), nullable=False, default=""),
    Column("caption", String(CAPTION_MAX_LENGTH), nullable=False, default=""),
    # 拍摄时间可空（07 §5「说明与拍摄时间可选」）：没有 EXIF 或站主不填时就是 NULL，
    # 不替站主编一个日期。
    Column("taken_on", Date, nullable=True),
    CheckConstraint(
        f"position >= 0 and position <= {MAX_MEDIA_PER_PROJECT - 1}", name="position_range"
    ),
    CheckConstraint(
        "kind in ('cover', 'detail', 'evidence')", name="kind_valid"
    ),
    CheckConstraint(
        f"char_length(alt) >= {ALT_MIN_CODEPOINTS} and char_length(alt) <= {ALT_MAX_CODEPOINTS}",
        name="alt_length",
    ),
    CheckConstraint(
        f"char_length(caption) <= {CAPTION_MAX_LENGTH}", name="caption_length"
    ),
    UniqueConstraint("project_id", "position", name="uq_project_media_project_id_position"),
    # 媒体删除前要检查引用，反向查询（按 media_id 找作品）必须有索引。
    Index("ix_project_media_media_id", "media_id"),
)


__all__ = [
    "ALT_MAX_CODEPOINTS",
    "ALT_MIN_CODEPOINTS",
    "BODY_MAX_LENGTH",
    "CAPTION_MAX_LENGTH",
    "DEFAULT_MEDIA_KIND",
    "KIND_COVER",
    "KIND_DETAIL",
    "KIND_EVIDENCE",
    "LINK_LABEL_MAX_LENGTH",
    "LINK_URL_MAX_LENGTH",
    "LINKS_MAX_ITEMS",
    "MAINTENANCE_ACTIVE",
    "MAINTENANCE_ARCHIVED",
    "MAINTENANCE_LABELS",
    "MAINTENANCE_PAUSED",
    "MAINTENANCE_STATES",
    "MAX_MEDIA_PER_PROJECT",
    "PROJECT_MEDIA_KINDS",
    "PROJECT_MEDIA_KIND_LABELS",
    "PROJECT_STATUSES",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED",
    "TECH_ITEM_MAX_LENGTH",
    "TECH_MAX_ITEMS",
    "Project",
    "project_media",
]
