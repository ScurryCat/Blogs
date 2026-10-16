"""手记对媒体的公开引用检查（T05 的域实现，07 §3 / §8、05 §11）。

注册方式（SHARED-CONTRACTS §5：默认不生效，由集成方在 `app/main.py` 显式注册）：

    from app.modules.journal import wiring
    wiring.register()

未注册时，即使一篇日记已发布且 public，它的图片对匿名访客也是 404 ——
这是有意的安全默认值（与其他内容域一致）：新的内容域必须自己声明公开引用规则。

规则（05 §11）：

  - 只有「`published` + `public` + 未软删除 + 日期不晚于展示时区今天」的日记，
    其 `journal_entry_media` 里的图片构成公开引用；
  - 草稿、私密、已软删除、未来日期的日记**都不构成**公开引用；
  - 一张图可以同时被日记与相册 / 动态引用：任一引用成立即公开，
    把日记切为私密**不会**撤回别的公开引用，管理端必须如实提示（见 `service.admin_images_out`
    的 `shared_media`）。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.journal import service
from app.modules.media import public_refs as media_public_refs

CHECKER_NAME = "journal"


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """公开日记的图片即构成公开引用；草稿 / 私密 / 已删除 / 未来日期不算。"""
    return service.public_entry_exists_for_media(session, media_id)


def register() -> None:
    """注册手记域的检查器。重复注册会报错（避免静默覆盖权限）。"""
    media_public_refs.register(CHECKER_NAME, media_is_publicly_referenced)


def unregister() -> None:
    """仅测试使用：回到「默认不贡献」。"""
    media_public_refs.unregister(CHECKER_NAME)
