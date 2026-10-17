"""相册与照片关系模型（07 §5「记忆画廊」、07 §8 的 `albums` / `album_media` 行）。

    albums              id / 唯一 slug / title / description / kind / position / status /
                        published_at / created_at / updated_at / deleted_at / version
    album_media         album_id / media_id / position / alt / caption / taken_on
                        复合主键 → 同一相册同一媒体唯一；唯一约束 → 同一相册 position 唯一
    album_media_sources id / album_id / media_id / moment_id / created_at
                        **收录来源**：moment_id IS NULL = 独立相册收录；
                        moment_id 非空 = 动态收录（三元组唯一）

`album_media` 是**显示关系**（怎么排、怎么写说明）；`album_media_sources` 是**收录来源**
（凭什么有公开资格）。两者分开的原因（第三轮任务书 §4.4 / §4.5）：

  - 配置存在 ≠ 公开资格：动态草稿 / 撤回时收录配置保留（供重发恢复），但不贡献公开资格；
  - 同一「相册 + 媒体」允许 1 条独立来源 + 多条动态来源；
  - 相册侧的排序 / 说明继续属于 `album_media`，不因其他动态收录同图而被覆盖；
  - 迁移前已存在的相册图片一律回填为独立来源，不能按「恰好被动态引用」推断。

字段与设计文档的对应（07 §5 / 07 §8）：

| 设计措辞 | 字段 |
| --- | --- |
| 照片墙支持相册 | `albums`（slug / title / description） |
| 主题筛选 | `kind`（photo 摄影 / screenshot 游戏截图 / other 其它） |
| 日期筛选 | `album_media.taken_on`（**可空**，没有素材时间就是 NULL） |
| 灯箱、说明 | `album_media.caption`（可空）与 `album_media.alt`（必填） |
| 照片保持自然比例 | 宽高来自 `media` 行（本表不存尺寸，避免两份互相矛盾的记录） |
| 游戏截图可进入独立相册 | 同一个 `albums` 表用 `kind='screenshot'` 区分，不建第二套图库 |
| 一张媒体被多处引用 | `album_media.media_id` 指向**已有** media（不重复保存文件，07 §5） |

刻意**没有**的字段：

  - 没有 `photo_count` / `view_count` 之类的缓存列 —— 计数每次实时统计，不拿它当权限条件
    （与 nav / moments 一致）。
  - 没有 `tags`（主题）关联表：07 §8 的 `albums` 行没有这一项，`kind` 已经能表达
    「摄影 / 游戏截图」这个设计里唯一的主题维度。加标签需要先改契约。

数据库能表达的约束落在数据库（05 §3 末段）：

  - `ck_albums_status_valid`            只有 draft / published
  - `ck_albums_kind_valid`              photo / screenshot / other
  - `ck_albums_version_positive`        version >= 1
  - `ck_albums_position_non_negative`   position >= 0
  - `ck_album_media_position_range`     position 在 0–199 之间（一个相册最多 200 张）
  - `ck_album_media_alt_length`         alt 1–200 个码点
  - `ck_album_media_caption_length`     caption <= 500 个码点
  - `pk_album_media`                    复合主键 → 同一相册的 media_id 唯一
  - `uq_album_media_album_id_position`  同一相册的 position 唯一

「发布前至少有 1 张 ready 图片」是跨行约束，由 service 在事务里验证。
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
    UniqueConstraint,
    Uuid,
    text as sql_text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"

ALBUM_STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)

# 相册类型（07 §5：「照片墙优先展示摄影；游戏截图可进入独立相册，避免混淆」）。
KIND_PHOTO = "photo"
KIND_SCREENSHOT = "screenshot"
KIND_OTHER = "other"

ALBUM_KINDS = (KIND_PHOTO, KIND_SCREENSHOT, KIND_OTHER)
KIND_LABELS = {
    KIND_PHOTO: "摄影",
    KIND_SCREENSHOT: "游戏截图",
    KIND_OTHER: "其它",
}
# 默认给访客看的类型：摄影（07 §5 明确「优先展示摄影」）。
DEFAULT_KIND = KIND_PHOTO

SLUG_MAX_LENGTH = 200
TITLE_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 1000
KIND_MAX_LENGTH = 16

# 一个相册最多 200 张；管理端一次提交的关系条数上限同值。
MAX_MEDIA_PER_ALBUM = 200
CAPTION_MAX_LENGTH = 500
ALT_MIN_CODEPOINTS = 1
ALT_MAX_CODEPOINTS = 200

# 手工排序的 position 上限（0 起）。留出插入空间，也让 CHECK 有个明确边界。
POSITION_MAX = 100_000

_DEFAULT_KIND_SQL = f"kind in ('{KIND_PHOTO}', '{KIND_SCREENSHOT}', '{KIND_OTHER}')"


class Album(Base):
    __tablename__ = "albums"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')", name="status_valid"),
        CheckConstraint(_DEFAULT_KIND_SQL, name="kind_valid"),
        CheckConstraint("version >= 1", name="version_positive"),
        CheckConstraint("position >= 0", name="position_non_negative"),
        # 公开列表的部分索引：与 service.public_conditions 完全一致。
        Index(
            "ix_albums_public_listing",
            "published_at",
            "id",
            unique=False,
            postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL"),
        ),
        Index("ix_albums_kind_position", "kind", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(SLUG_MAX_LENGTH), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    description: Mapped[str] = mapped_column(
        String(DESCRIPTION_MAX_LENGTH), nullable=False, default=""
    )
    kind: Mapped[str] = mapped_column(String(KIND_MAX_LENGTH), nullable=False, default=DEFAULT_KIND)
    # 手工排序：同一个 kind 内部按 position 升序展示。默认 0，由 service 保证同 kind 唯一。
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
        """成功修改后递增版本（05 §2 / §7）。调用方负责提交。"""
        self.version = int(self.version) + 1
        self.updated_at = utcnow()


# 关联表：照片在相册里的顺序与逐场景说明。
# `alt` 必填（验收「图片有 alt」），`caption` 与 `taken_on` 可空（07 §5）。
album_media = Table(
    "album_media",
    Base.metadata,
    Column(
        "album_id",
        Uuid(as_uuid=True),
        ForeignKey("albums.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "media_id",
        Uuid(as_uuid=True),
        ForeignKey("media.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Column("position", Integer, nullable=False),
    Column("alt", String(ALT_MAX_CODEPOINTS), nullable=False, default=""),
    Column("caption", String(CAPTION_MAX_LENGTH), nullable=False, default=""),
    Column("taken_on", Date, nullable=True),
    CheckConstraint(f"position >= 0 and position <= {MAX_MEDIA_PER_ALBUM - 1}", name="position_range"),
    CheckConstraint(
        f"char_length(alt) >= {ALT_MIN_CODEPOINTS} and char_length(alt) <= {ALT_MAX_CODEPOINTS}",
        name="alt_length",
    ),
    CheckConstraint(f"char_length(caption) <= {CAPTION_MAX_LENGTH}", name="caption_length"),
    UniqueConstraint("album_id", "position", name="uq_album_media_album_id_position"),
    # 媒体删除前要检查引用，反向查询（按 media_id 找相册）必须有索引。
    Index("ix_album_media_media_id", "media_id"),
    # 「按拍摄时间筛选」与顺序遍历都要从 (album_id, position) / (media_id) 进。
    Index("ix_album_media_taken_on", "taken_on"),
)


# 收录来源表（第三轮任务书 §4.4 / §4.5 / §4.6）。
#
# 为什么需要一张独立表，而不是给 album_media 加一个 `source` 列：
#   - 同一「相册 + 媒体」可以同时有独立来源 + 多条动态来源，一个标量列表达不了；
#   - 动态草稿 / 撤回时**保留配置但不贡献公开资格**，所以「配置」与「当前是否公开」
#     必须能分开判断：这里存配置，公开资格由 source 行 + moments 当前状态在 SQL 里联合决定；
#   - 迁移可以把历史相册图片无损回填成独立来源（见迁移脚本）。
#
# 数据库约束：
#   - `uq_album_media_sources_moment_triple`：同一「动态 + 相册 + 媒体」只有一条；
#   - `uq_album_media_sources_independent`（部分唯一索引，moment_id IS NULL）：
#     同一「相册 + 媒体」最多一条独立来源；
#   - 外键：albums / moments 硬删除级联清理；media 硬删除 RESTRICT（与 album_media 一致，
#     媒体是否可删仍要先检查引用）。
album_media_sources = Table(
    "album_media_sources",
    Base.metadata,
    Column("id", Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column(
        "album_id",
        Uuid(as_uuid=True),
        ForeignKey("albums.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "media_id",
        Uuid(as_uuid=True),
        ForeignKey("media.id", ondelete="RESTRICT"),
        nullable=False,
    ),
    Column(
        "moment_id",
        Uuid(as_uuid=True),
        ForeignKey("moments.id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("created_at", DateTime(timezone=True), nullable=False, default=utcnow),
    UniqueConstraint(
        "moment_id",
        "album_id",
        "media_id",
        name="uq_album_media_sources_moment_triple",
    ),
    # 独立来源唯一：部分唯一索引（NULL 在普通 UNIQUE 里互不相等，无法表达）。
    Index(
        "uq_album_media_sources_independent",
        "album_id",
        "media_id",
        unique=True,
        postgresql_where=sql_text("moment_id IS NULL"),
    ),
    # 公开条件按 (album_id, media_id) 找来源（独立 / 动态都要命中）。
    Index("ix_album_media_sources_album_id_media_id", "album_id", "media_id"),
    # 媒体权限检查 / 媒体删除前的反向查询。
    Index("ix_album_media_sources_media_id", "media_id"),
)


__all__ = [
    "ALBUM_KINDS",
    "ALBUM_STATUSES",
    "ALT_MAX_CODEPOINTS",
    "ALT_MIN_CODEPOINTS",
    "CAPTION_MAX_LENGTH",
    "DEFAULT_KIND",
    "KIND_LABELS",
    "KIND_OTHER",
    "KIND_PHOTO",
    "KIND_SCREENSHOT",
    "MAX_MEDIA_PER_ALBUM",
    "POSITION_MAX",
    "STATUS_DRAFT",
    "STATUS_PUBLISHED",
    "Album",
    "album_media",
    "album_media_sources",
]
