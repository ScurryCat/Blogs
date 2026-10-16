"""异世界导航模型（05 §3「异世界导航」、设计 04 §8）。

    palaces         id / 唯一 slug / title / summary / name / location / cognition /
                    status / published_at / created_at / updated_at / deleted_at / version
    palace_aliases  palace_id / field / value / normalized_value
    palace_posts    palace_id / post_id / position

约定：

  - 三项标准关键词（`name` / `location` / `cognition`）存在 palaces 行上，**别名**存在
    `palace_aliases`，两者都参与匹配。别名按 `app.core.text.normalize_for_match`
    （NFKC + trim + 大小写折叠 + 空白折叠）保存规范值，因此「怪盗手记」「 怪盜手記 」
    不会变成两条互不相关的别名。
  - 文章仍属于博客：`palace_posts` 只保存**关系与顺序**，不复制标题或正文
    （04 §8：「不复制一份正文到殿堂表」）。
  - 同一专题内**文章唯一、顺序唯一**都落在数据库约束上，不靠管理表单自觉
    （05 §3 末：「已有外键、唯一键和数据库 CHECK 能表达的约束仍要落在数据库」）。
  - 公开存在性由「当前至少一篇公开文章」的关系判断，不缓存一份可能过期的
    「已公开文章数」当权限条件（05 §3）。因此这里**没有** `post_count` 列。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text as sql_text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

PALACE_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# 认知定位的三个字段（04 §4B 的界面名称 → 数据字段）。
FIELD_NAME = "name"
FIELD_LOCATION = "location"
FIELD_COGNITION = "cognition"

PALACE_FIELDS = (FIELD_NAME, FIELD_LOCATION, FIELD_COGNITION)
FIELD_LABELS = {
    FIELD_NAME: "目标名",
    FIELD_LOCATION: "现实地点",
    FIELD_COGNITION: "认知形态",
}

SLUG_MAX_LENGTH = 200
TITLE_MAX_LENGTH = 200
SUMMARY_MAX_LENGTH = 500
KEYWORD_MAX_LENGTH = 80
ALIAS_VALUE_MAX_LENGTH = 80
NORMALIZED_VALUE_MAX_LENGTH = 80

# 一次请求里允许提交的别名 / 文章关系条数上限。文档没规定，按「个人站点手动维护」
# 的规模取值：超过说明调用方搞错了，早失败比悄悄截断好。
MAX_ALIASES_PER_PALACE = 60
MAX_POSTS_PER_PALACE = 100

_FIELD_IN_SQL = "field in ('name', 'location', 'cognition')"


class Palace(Base):
    __tablename__ = "palaces"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        # 公开列表的部分索引：与公开条件一致，不给草稿 / 已删除行留位置。
        Index(
            "ix_palaces_public_listing",
            "published_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(SLUG_MAX_LENGTH), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    summary: Mapped[str] = mapped_column(String(SUMMARY_MAX_LENGTH), nullable=False, default="")
    # 三项标准关键词。它们同时是「认知定位」的标准值，别名另存于 palace_aliases。
    name: Mapped[str] = mapped_column(String(KEYWORD_MAX_LENGTH), nullable=False)
    location: Mapped[str] = mapped_column(String(KEYWORD_MAX_LENGTH), nullable=False)
    cognition: Mapped[str] = mapped_column(String(KEYWORD_MAX_LENGTH), nullable=False)
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

    aliases: Mapped[list["PalaceAlias"]] = relationship(
        back_populates="palace",
        cascade="all, delete-orphan",
        order_by="PalaceAlias.field, PalaceAlias.normalized_value",
    )
    posts: Mapped[list["PalacePost"]] = relationship(
        back_populates="palace",
        cascade="all, delete-orphan",
        order_by="PalacePost.position",
    )

    def standard_values(self) -> dict[str, str]:
        """标准关键词（按字段）。"""
        return {field: getattr(self, field) for field in PALACE_FIELDS}

    def bump_version(self) -> None:
        """成功修改后递增版本（05 §2）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


class PalaceAlias(Base):
    """同一专题同字段的**规范值唯一**；标准值不写进这张表。"""

    __tablename__ = "palace_aliases"
    __table_args__ = (
        CheckConstraint(_FIELD_IN_SQL, name="field_valid"),
        UniqueConstraint("palace_id", "field", "normalized_value"),
        Index("ix_palace_aliases_field_value", "field", "normalized_value"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    palace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    field: Mapped[str] = mapped_column(String(16), nullable=False)
    # 站主输入的展示值（保留原大小写与全角形态，便于管理界面回显）。
    value: Mapped[str] = mapped_column(String(ALIAS_VALUE_MAX_LENGTH), nullable=False)
    # 匹配用的规范值：NFKC + trim + 大小写折叠（core.text.normalize_for_match）。
    normalized_value: Mapped[str] = mapped_column(
        String(NORMALIZED_VALUE_MAX_LENGTH), nullable=False
    )

    palace: Mapped[Palace] = relationship(back_populates="aliases")


class PalacePost(Base):
    """专题 ↔ 文章的有序关系。文章与顺序分别在同一专题内唯一。"""

    __tablename__ = "palace_posts"
    __table_args__ = (
        UniqueConstraint("palace_id", "post_id"),
        UniqueConstraint("palace_id", "position"),
        CheckConstraint("position >= 0", name="position_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    palace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    palace: Mapped[Palace] = relationship(back_populates="posts")
