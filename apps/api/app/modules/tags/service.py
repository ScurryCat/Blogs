"""标签服务与公开标签来源注册（05 §6）。

`GET /tags` 只返回**有公开内容**的标签（「不泄漏仅草稿使用的标签」）。
「公开内容」按域计算：文章域属于 T01；后续动态（T03）、日记（T05）等各自注册一个
来源函数，返回该域当前公开内容使用到的 tag id 集合。没有注册的域不参与，
也就不会把草稿标签泄漏出去 —— 默认是「不贡献」，不是「默认通过」。

来源函数签名：`(session) -> set[uuid.UUID]`，只做只读查询，必须自带公开条件。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.text import normalize_tag_slug
from app.modules.tags.models import Tag

PublicTagSource = Callable[[Session], set[uuid.UUID]]

_sources: dict[str, PublicTagSource] = {}


class DuplicateTagSourceError(RuntimeError):
    """同一域重复注册；覆盖会静默改变公开可见的标签集合。"""


def register_public_tag_source(name: str, source: PublicTagSource) -> None:
    if not name or not name.strip():
        raise ValueError("公开标签来源必须有名字")
    if name in _sources:
        raise DuplicateTagSourceError(f"公开标签来源 {name!r} 已登记")
    _sources[name] = source


def registered_public_tag_sources() -> tuple[str, ...]:
    return tuple(sorted(_sources))


def reset_public_tag_sources() -> None:
    """仅测试使用。"""
    _sources.clear()


def public_tag_ids(session: Session) -> set[uuid.UUID]:
    ids: set[uuid.UUID] = set()
    for source in list(_sources.values()):
        ids |= set(source(session))
    return ids


def get_or_create_tags(session: Session, names: list[str]) -> list[Tag]:
    """按规范化 slug 取或建标签。用于导入与后续管理写入；调用方负责提交。"""
    created: list[Tag] = []
    seen: set[str] = set()
    for raw_name in names:
        display = (raw_name or "").strip()
        if not display:
            continue
        slug = normalize_tag_slug(display)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        tag = session.execute(select(Tag).where(Tag.slug == slug)).scalars().first()
        if tag is None:
            tag = Tag(slug=slug, name=display)
            session.add(tag)
            session.flush()
        created.append(tag)
    return created


def list_public_tags(session: Session) -> list[Tag]:
    ids = public_tag_ids(session)
    if not ids:
        return []
    return list(
        session.execute(select(Tag).where(Tag.id.in_(ids)).order_by(Tag.slug.asc())).scalars()
    )


def tags_by_ids(session: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, Tag]:
    if not ids:
        return {}
    rows = session.execute(select(Tag).where(Tag.id.in_(ids))).scalars()
    return {row.id: row for row in rows}
