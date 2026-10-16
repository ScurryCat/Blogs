"""标签模型（05 §3「文章与标签」）。

  tags        id / 唯一规范化 slug / 展示 name
  post_tags   post_id / tag_id，组合唯一（这里用复合主键表达「组合唯一」）

规范化 slug 由 `app.core.text.normalize_tag_slug` 统一生成（NFKC + trim + 大小写折叠 +
空白转 `-`），因此「前端」「 前端 」「Front End」不会变成三条不同的标签。
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, ForeignKey, String, Table, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

TAG_SLUG_MAX_LENGTH = 80
TAG_NAME_MAX_LENGTH = 80


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(TAG_SLUG_MAX_LENGTH), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(TAG_NAME_MAX_LENGTH), nullable=False)


# 关联表：复合主键即「同一文章同一标签只能出现一次」的数据库级保证。
# 文章被删（硬删）时关联级联清理；本站正常路径是软删除，级联只是兜底。
post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", Uuid(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Uuid(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)
