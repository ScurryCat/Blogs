"""相册对媒体的公开引用检查（T06 的域实现）。

注册方式（SHARED-CONTRACTS §5：默认不生效，由集成负责人在 `app/main.py` 显式注册）：

    from app.modules.gallery import wiring
    wiring.register()

未注册时，即使相册已公开，它的照片对匿名访客也是 404 —— 这是有意的安全默认值。

规则（07 §5 / 05 §8 / 05 §11、验收 3）：

  - 一个 `published` + 未软删除 + 已到发布时间的相册，其 `album_media` 里的图片构成
    公开引用；
  - **一张图可以有多个公开引用**：`media.public_refs.is_publicly_referenced` 把各域
    取「或」。因此从相册里移除一张仍被动态或作品引用的图，**不会**让访客看到坏图；
    只有全部公开引用都撤回后，匿名请求才 404；
  - 草稿相册的照片、未关联照片一律不构成公开引用；
  - 原图（`original` 变体）永远只给站主，与本检查无关 —— 那是 T01 的
    `ensure_anonymous_readable` 直接拒绝的（05 §8）。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.gallery import service
from app.modules.media import public_refs as media_public_refs

CHECKER_NAME = "gallery"


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """公开相册的照片即构成公开引用；草稿 / 已撤回 / 已删除相册不算。"""
    return service.public_album_exists_for_media(session, media_id)


def register() -> None:
    """注册相册域的检查器。重复注册会报错（避免静默覆盖权限）。"""
    media_public_refs.register(CHECKER_NAME, media_is_publicly_referenced)


def unregister() -> None:
    """仅测试使用。"""
    media_public_refs.unregister(CHECKER_NAME)


__all__ = ["CHECKER_NAME", "media_is_publicly_referenced", "register", "unregister"]
