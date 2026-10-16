"""COOP 域对共享扩展点的统一登记入口。

T00 在 `app/main.py` 的 `register_content_domains()` 里增加一次调用：

    from app.modules.coop import wiring as coop_wiring
    coop_wiring.register()

它只做一件事：登记 `media/public_refs` 的 **coop** 检查器 ——
**已发布、未删除**的友链的头像构成该媒体的公开引用。未登记时匿名访问头像会 404
（默认拒绝，SHARED-CONTRACTS §5），而卡片仍然正常渲染（前端用站名首字兜底）。

刻意**不**登记「公开标签来源」：COOP 的标签存在 `friend_link_tags`，
不进共享 `tags` 表，所以 `GET /api/v1/tags` 的含义与友链无关。

`verify_contributions()` 把上面这段话变成可执行断言：集成自检与模块测试都调用它，
避免以后有人「顺手」给 coop 加一条全局注册而没有更新文档。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.coop import service

CHECKER_NAME = "coop"

# 本域对共享扩展点的贡献清单：媒体公开引用一项。集成检查与交付单引用同一个常量。
CONTRIBUTIONS: tuple[str, ...] = (f"media:{CHECKER_NAME}",)


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """已发布友链的头像即构成公开引用；草稿 / 已撤回 / 已删除友链不算。"""
    return service.public_avatar_exists_for_media(session, media_id)


def register() -> tuple[str, ...]:
    """登记本域贡献。重复登记会由注册表报错（避免静默覆盖权限判断）。"""
    from app.modules.media import public_refs

    public_refs.register(CHECKER_NAME, media_is_publicly_referenced)
    return CONTRIBUTIONS


def unregister() -> None:
    """仅测试使用：回到「默认不贡献」。"""
    from app.modules.media import public_refs

    public_refs.unregister(CHECKER_NAME)


def registered_contributions() -> tuple[str, ...]:
    return CONTRIBUTIONS


def verify_contributions() -> None:
    """自检：coop 只在媒体公开引用里出现过一次，且没有登记公开标签来源。"""
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    assert CHECKER_NAME in public_refs.registered(), "coop 必须登记媒体公开引用检查（头像）"
    assert not any(
        name.startswith("coop") for name in tags_service.registered_public_tag_sources()
    ), "coop 不应登记公开标签来源（友链标签不进共享 tags 表）"


__all__ = [
    "CHECKER_NAME",
    "CONTRIBUTIONS",
    "media_is_publicly_referenced",
    "register",
    "registered_contributions",
    "unregister",
    "verify_contributions",
]
