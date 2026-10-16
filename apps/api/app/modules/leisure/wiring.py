"""放课后与共享扩展点的关系声明。

与 `journal` / `moments` 不同，**放课后没有自己的媒体引用关系表**：
它只有一张可空封面（`cover_media_id`），而封面在公开条目上就是一次公开引用。
因此这里**必须**提供一个媒体公开引用检查，否则「已发布的追番条目封面」对匿名
访客会 404（`media/public_refs` 是默认拒绝的注册表）。

登记方式（集成方在 `app/main.py` 的 `register_content_domains()` 里加一行）：

    from app.modules.leisure import wiring as leisure_wiring
    leisure_wiring.register()

本域**不**贡献公开标签来源：娱乐记录没有标签字段（07 §3 的字段清单里没有标签）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.leisure.models import LeisureEntry, STATUS_PUBLISHED
from app.modules.media import public_refs as media_public_refs

CHECKER_NAME = "leisure"

CONTRIBUTIONS: tuple[str, ...] = ("media:leisure",)


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """已发布条目的封面即构成公开引用；草稿 / 已撤回 / 已删除条目不算。"""
    statement = (
        select(func.count())
        .select_from(LeisureEntry)
        .where(
            LeisureEntry.cover_media_id == media_id,
            LeisureEntry.status == STATUS_PUBLISHED,
            LeisureEntry.deleted_at.is_(None),
        )
    )
    return bool(session.execute(statement).scalar())


def register() -> tuple[str, ...]:
    """登记放课后的媒体公开引用检查；返回贡献清单。重复调用会抛错。"""
    media_public_refs.register(CHECKER_NAME, media_is_publicly_referenced)
    return CONTRIBUTIONS


def unregister() -> None:
    """仅测试使用。"""
    media_public_refs.unregister(CHECKER_NAME)


def registered_contributions() -> tuple[str, ...]:
    from app.modules.media import public_refs as registry

    return tuple(f"media:{name}" for name in registry.registered() if name == CHECKER_NAME)


def verify_registered() -> None:
    from app.modules.media import public_refs as registry

    assert CHECKER_NAME in registry.registered(), (
        "放课后的媒体公开引用检查没有登记；已发布条目的封面会对匿名 404"
    )


def verify_no_shared_tag_contributions() -> None:
    from app.modules.tags import service as tags_service

    assert not any(
        name.startswith("leisure") for name in tags_service.registered_public_tag_sources()
    ), "放课后不应登记公开标签来源（娱乐记录没有标签字段）"


__all__ = [
    "CHECKER_NAME",
    "CONTRIBUTIONS",
    "media_is_publicly_referenced",
    "register",
    "registered_contributions",
    "unregister",
    "verify_no_shared_tag_contributions",
    "verify_registered",
]
