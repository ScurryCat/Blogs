"""动态对媒体的公开引用检查（T03 的域实现）。

注册方式（SHARED-CONTRACTS §5：默认不生效，由 T00 在 `app/main.py` 显式注册）：

    from app.modules.moments import wiring
    wiring.register()

未注册时，即使一条图文已公开，它的图片对匿名访客也是 404 —— 这是有意的安全默认值。
后果是「站主发布了图文，第二浏览器打开却全是坏图」，所以 T03 的交付单把它列为
**必须的集成动作**（不是可选优化）。

规则（03 §6 / 05 §8）：
  - 一条 `published` + 未软删除 + 已到发布时间的动态，其 `moment_media` 里的图片构成公开引用。
  - 一张图可以同时被动态与相册引用：任一引用成立即公开，撤回一处不影响另一处（05 §11）。
  - 草稿图片、未关联图片一律不构成公开引用。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.media import public_refs as media_public_refs
from app.modules.moments import service

CHECKER_NAME = "moments"


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """公开动态的图片即构成公开引用；草稿 / 已撤回 / 已删除动态不算。"""
    return service.public_moment_exists_for_media(session, media_id)


def register() -> None:
    """注册动态域的检查器。重复注册会报错（避免静默覆盖权限）。"""
    media_public_refs.register(CHECKER_NAME, media_is_publicly_referenced)


def unregister() -> None:
    """仅测试使用。"""
    media_public_refs.unregister(CHECKER_NAME)
