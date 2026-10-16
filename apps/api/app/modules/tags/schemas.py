"""公开标签 DTO（05 §6）。

只暴露 id / slug / name。**不含**文章数量、草稿引用或任何管理字段 ——
计数很容易变成「用不完整数据算出来的假统计」，留给真正需要它的域自己定义 DTO。
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.modules.tags.models import Tag


class TagPublicOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str


def tag_public_out(tag: Tag) -> TagPublicOut:
    return TagPublicOut(id=tag.id, slug=tag.slug, name=tag.name)
