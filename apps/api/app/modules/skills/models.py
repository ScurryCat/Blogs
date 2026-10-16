"""技能模型（07 §6「天鹅绒房间」、07 §8 的 `skills` / `project_skills` 行）。

    skills         id / 唯一 slug / 名称 / 领域 / 范围说明 / 掌握证据 / 外部链接 /
                   展示顺序 / 状态 / 发布时间 / 时间戳 / 软删除 / version
    project_skills skill_id / project_id / position（复合主键 → 同一技能对同一作品唯一）

设计要点（每一条都对应验收里的一条）：

  - **不伪造等级**（07 §6「不自封数值等级」、任务卡「未提供掌握证据的技能保持草稿，
    不伪造等级数字」）：这张表刻意**没有** `level` / `rank` / `score` / `percent` /
    `years` 之类的列。没有掌握证据的存放处，也就没有「猜一个数字填上去」的入口。
    「掌握到什么程度」由 `scope`（自然语言）与 `evidence`（真实证据）表达。
  - **同一关系来源**（验收 2）：技能与作品的关系只存在于 `project_skills`。
    技能全书从它读出「关联作品」，作品详情也从它读出「使用的技能」——
    两边是同一批行，因此不存在「技能页说有 3 件、作品页说 2 件」这种互相矛盾。
  - **不复制同一份事实**（任务卡「与项目技术标签的关系明确，不让两份同名字段分别维护
    不同事实」）：`skills.name` 与 `projects.tech_stack` 是不同的东西，本表**不存**
    任何技术标签的副本。`service.tech_overlap()` 把「这件作品的技术栈里有哪些与本技能
    同名」**算**出来，只作为一致性诊断，不作为一份要维护的数据。
    技能上刻意**没有** `tag_id`：给技能加真实 Tag 关联会同时改变 `GET /tags`
    的公开来源（T01 的注册表）与「未发布技能的标签不能泄漏」的判断，
    那是契约增量，不是本包能顺手决定的事（见交付单「集成申请」）。
  - **展示顺序**（07 §8「展示顺序」）：`position` 由站主手动维护，允许重复；
    公开排序是 `(position ASC, name ASC, id ASC)` —— 完全确定，不靠自增时间戳兜底。
  - **发布状态**独立于内容本身：新建总是 `draft`（与 moments / nav / projects 同形），
    发布是单独动作，公开端点只返回 `published` + 未软删除的行。

数据库能表达的约束落在数据库（05 §3 末段）：

  - `ck_skills_domain_valid`        领域取值枚举
  - `ck_skills_status_valid`        只有 draft / published
  - `ck_skills_version_positive`    version >= 1
  - `ck_skills_position_non_negative`  position >= 0
  - `ck_project_skills_position_non_negative`  position >= 0
  - `uq_project_skills_skill_id_project_id` 复合主键 → 同一技能同一作品唯一
  - `uq_project_skills_skill_id_position`   同一技能在列表里的顺序唯一

「已在公开作品中验证」这类跨行 / 语义判断由 service 在事务里算，不硬塞进 CHECK。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
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

SKILL_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# 领域（07 §6「技能全书展示已学习的领域」）。取值是本站约定，不是游戏原版设定，
# 也**不是**等级：它只回答「这条技能属于哪一类」。
DOMAIN_ALGORITHM = "algorithm"
DOMAIN_FRONTEND = "frontend"
DOMAIN_BACKEND = "backend"
DOMAIN_DATA = "data"
DOMAIN_SIGNAL = "signal"
DOMAIN_SYSTEMS = "systems"
DOMAIN_TOOLING = "tooling"
DOMAIN_OTHER = "other"

SKILL_DOMAINS = (
    DOMAIN_ALGORITHM,
    DOMAIN_FRONTEND,
    DOMAIN_BACKEND,
    DOMAIN_DATA,
    DOMAIN_SIGNAL,
    DOMAIN_SYSTEMS,
    DOMAIN_TOOLING,
    DOMAIN_OTHER,
)

DOMAIN_LABELS = {
    DOMAIN_ALGORITHM: "算法与数据结构",
    DOMAIN_FRONTEND: "前端工程",
    DOMAIN_BACKEND: "后端与接口",
    DOMAIN_DATA: "数据与存储",
    DOMAIN_SIGNAL: "信号与系统",
    DOMAIN_SYSTEMS: "系统与网络",
    DOMAIN_TOOLING: "工具与流程",
    DOMAIN_OTHER: "其它",
}

# 一条技能最多关联多少件作品：个人站点的规模，超过说明调用方搞错了。
MAX_PROJECTS_PER_SKILL = 100

SLUG_MAX_LENGTH = 120
NAME_MAX_LENGTH = 80
SCOPE_MAX_CODEPOINTS = 1000
EVIDENCE_MAX_CODEPOINTS = 2000
DOMAIN_MAX_LENGTH = 16

# 外部链接（反复出现的真实证据，例如仓库、题解、演示）。与作品的 `links` 同形，
# 只允许 http / https（见 `app/modules/skills/links.py`）。
LINKS_MAX_ITEMS = 8
LINK_LABEL_MAX_LENGTH = 40
LINK_URL_MAX_LENGTH = 500

_DOMAIN_IN_SQL = "domain in (" + ", ".join(f"'{value}'" for value in SKILL_DOMAINS) + ")"


class Skill(Base):
    __tablename__ = "skills"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint(_DOMAIN_IN_SQL, name="domain_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("position >= 0", name="position_non_negative"),
        # 公开列表的部分索引：与 service.public_conditions 完全一致，
        # 不给草稿 / 已删除行留位置。
        Index(
            "ix_skills_public_listing",
            "position",
            "name",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
        Index("ix_skills_domain_position", "domain", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(SLUG_MAX_LENGTH), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH), nullable=False)
    domain: Mapped[str] = mapped_column(
        String(DOMAIN_MAX_LENGTH), nullable=False, default=DOMAIN_OTHER
    )
    # 范围说明：这门技能「管到哪儿」。自然语言，不是分数。
    scope: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 掌握证据：一段如实的说明（做过什么、做到什么程度、哪里还不熟）。
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    links: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
        """成功修改后递增版本（05 §2）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


# 关联表：**技能与作品关系的唯一来源**（验收 2）。
# 复合主键表达「同一技能同一作品只能出现一次」，唯一约束表达「同一技能内顺序唯一」。
# 与 `project_media` / `palace_posts` 同形：只保存关系与顺序，不复制标题、正文或技术栈。
project_skills = Table(
    "project_skills",
    Base.metadata,
    Column(
        "skill_id",
        Uuid(as_uuid=True),
        ForeignKey("skills.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "project_id",
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("position", Integer, nullable=False, default=0),
    CheckConstraint("position >= 0", name="position_non_negative"),
    UniqueConstraint("skill_id", "position", name="uq_project_skills_skill_id_position"),
    # 复合主键即「同一技能同一作品唯一」：不需要再写一条冗余的唯一约束。
    # 反向查询（按 project_id 找技能）必须有索引：作品详情与「合体」筛选都从它进。
    Index("ix_project_skills_project_id", "project_id"),
)


__all__ = [
    "DOMAIN_ALGORITHM",
    "DOMAIN_BACKEND",
    "DOMAIN_DATA",
    "DOMAIN_FRONTEND",
    "DOMAIN_LABELS",
    "DOMAIN_MAX_LENGTH",
    "DOMAIN_OTHER",
    "DOMAIN_SIGNAL",
    "DOMAIN_SYSTEMS",
    "DOMAIN_TOOLING",
    "EVIDENCE_MAX_CODEPOINTS",
    "LINK_LABEL_MAX_LENGTH",
    "LINKS_MAX_ITEMS",
    "LINK_URL_MAX_LENGTH",
    "MAX_PROJECTS_PER_SKILL",
    "NAME_MAX_LENGTH",
    "SCOPE_MAX_CODEPOINTS",
    "SKILL_DOMAINS",
    "SKILL_STATUSES",
    "SLUG_MAX_LENGTH",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED",
    "Skill",
    "project_skills",
]
