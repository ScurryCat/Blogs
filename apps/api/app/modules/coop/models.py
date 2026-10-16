"""COOP 友链模型（07 §4、05 §11、任务卡 T07）。

    friend_links       id / 站名 / http(s) 地址 / 简介 / 相识故事（可空）/ 可选阿尔卡那装饰 /
                       可空头像媒体 / 站主排序 / 发布状态 / 时间戳 / 软删除 / 版本
    friend_link_tags   friend_link_id / 展示名 / 规范值（同一友链内规范值唯一）

刻意**没有**的东西（验收第 5 条、07 §4「不根据点击量生成好感度或 RANK」）：

  - 没有 `rank` / `affection` / `favor` 等级列：阿尔卡那是装饰用的文字，不是等级。
  - 没有 `visits` / `clicks` / `popularity` 计数列：本站不统计、不排名朋友。
  - 没有 `online` / `last_seen` 列：不伪造在线状态。
  - 没有 `latest_post` / `feed_url` 列：不抓取外链站点内容，也不伪造「朋友的新动态」。
  - 没有 `contact_id` / `conversation_id` 列：真实友链不是可聊天的 NPC，
    角色消息是另一个数据域（05 §11「真实友链与虚构角色分别建模」）。

标签**不写进共享 `tags` 表**：那是文章标签（T01 的公开标签来源只登记了文章域）。
把友链标签混进去会改变 `GET /api/v1/tags` 的含义，也会让撤回友链影响文章标签统计。
因此这里自带 `friend_link_tags`，并沿用同一套规范化规则
（`app.core.text.normalize_for_match`），保证「前端」「 前端 」不会变成两个筛选项。
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
from app.modules.coop.urls import URL_MAX_LENGTH

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

FRIEND_LINK_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

NAME_MAX_LENGTH = 80
SUMMARY_MAX_LENGTH = 500
STORY_MAX_LENGTH = 4000
ARCANA_MAX_LENGTH = 60
TAG_NAME_MAX_LENGTH = 40

# 一次请求里允许提交的标签条数上限。个人站点手动维护的规模，超过说明调用方搞错了。
MAX_TAGS_PER_LINK = 20

# 站主手动排序的取值范围（给「上移 / 下移」留足插入空间，也不至于溢出）。
POSITION_MIN = 0
POSITION_MAX = 100_000

# 与 `urls.normalize_external_url` 同形的数据库兜底：服务层被绕过也写不进可执行 scheme。
_URL_SCHEME_SQL = "url ~* '^https?://'"
_URL_TRIM_SQL = "url = btrim(url)"

# 公开列表的部分索引：与公开条件一致，不给草稿 / 已删除行留位置。
_PUBLIC_LISTING_WHERE = sql_text("status = 'published' AND deleted_at IS NULL")


class FriendLink(Base):
    __tablename__ = "friend_links"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint(f"position between {POSITION_MIN} and {POSITION_MAX}", name="position_range"),
        CheckConstraint(f"length(url) <= {URL_MAX_LENGTH}", name="url_length"),
        CheckConstraint(_URL_SCHEME_SQL, name="url_http_scheme"),
        CheckConstraint(_URL_TRIM_SQL, name="url_trimmed"),
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        Index(
            "ix_friend_links_public_listing",
            "position",
            "id",
            unique=False,
            postgresql_where=_PUBLIC_LISTING_WHERE,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 站名（展示用），不是账号名，也不代表对方在本站有账号。
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH), nullable=False)
    # 规范化后的 http(s) 地址（见 urls.normalize_external_url）。
    url: Mapped[str] = mapped_column(String(URL_MAX_LENGTH), nullable=False)
    summary: Mapped[str] = mapped_column(String(SUMMARY_MAX_LENGTH), nullable=False, default="")
    # 相识故事：纯文本，前端按文本渲染，永不注入 HTML（验收第 2 条）。
    story: Mapped[str | None] = mapped_column(String(STORY_MAX_LENGTH), nullable=True)
    # 可选阿尔卡那装饰（例如 "IX · HERMIT"）。是主题，不是等级，也不参与排序或权限。
    arcana: Mapped[str | None] = mapped_column(String(ARCANA_MAX_LENGTH), nullable=True)
    # 头像可空；缺失时前端用站名首字兜底（验收第 4 条）。媒体删除后置空而不是级联删友链。
    avatar_media_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("media.id", ondelete="SET NULL"),
        nullable=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=POSITION_MIN)
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

    tags: Mapped[list["FriendLinkTag"]] = relationship(
        back_populates="link",
        cascade="all, delete-orphan",
        order_by="FriendLinkTag.normalized",
    )

    def bump_version(self) -> None:
        """成功修改后递增版本（05 §2）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


class FriendLinkTag(Base):
    """友链标签。展示名保留站主输入的形态，规范值用于筛选与去重。"""

    __tablename__ = "friend_link_tags"
    __table_args__ = (
        UniqueConstraint("friend_link_id", "normalized"),
        Index("ix_friend_link_tags_normalized", "normalized"),
        CheckConstraint("length(btrim(normalized)) > 0", name="normalized_not_blank"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    friend_link_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("friend_links.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(TAG_NAME_MAX_LENGTH), nullable=False)
    # NFKC + trim + 大小写折叠（app.core.text.normalize_for_match）。
    normalized: Mapped[str] = mapped_column(String(TAG_NAME_MAX_LENGTH), nullable=False)

    link: Mapped[FriendLink] = relationship(back_populates="tags")


__all__ = [
    "ARCANA_MAX_LENGTH",
    "FRIEND_LINK_STATUSES",
    "FriendLink",
    "FriendLinkTag",
    "MAX_TAGS_PER_LINK",
    "NAME_MAX_LENGTH",
    "POSITION_MAX",
    "POSITION_MIN",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED",
    "STORY_MAX_LENGTH",
    "SUMMARY_MAX_LENGTH",
    "TAG_NAME_MAX_LENGTH",
    "URL_MAX_LENGTH",
]
