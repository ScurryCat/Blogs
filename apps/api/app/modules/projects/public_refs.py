"""作品对媒体的公开引用检查（T06 的域实现）。

注册方式（SHARED-CONTRACTS §5：默认不生效，由集成负责人在 `app/main.py` 显式注册）：

    from app.modules.projects import wiring
    wiring.register()

未注册时，即使作品已公开，它的图片对匿名访客也是 404 —— 这是有意的安全默认值。
后果是「站主发布了作品，第二浏览器打开却全是坏图」，因此 T06 的交付单把它列为
**必须的集成动作**（不是可选优化）。

规则（07 §5 / 05 §8 / 05 §11）：

  - 一件 `published` + 未软删除 + 已到发布时间的作品，其 `project_media` 里的图片构成
    公开引用；
  - 一张图可以同时被动态、相册与作品引用：**任一**引用成立即公开，撤回一处不影响
    另一处（`media.public_refs.is_publicly_referenced` 是把各域取「或」）；
  - 草稿作品的图片、未关联图片一律不构成公开引用；
  - 私密引用不会推翻另一个公开引用，也不会让本来不可读的媒体变可读。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.media import public_refs as media_public_refs
from app.modules.projects import service

CHECKER_NAME = "projects"


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """公开作品的图片即构成公开引用；草稿 / 已撤回 / 已删除作品不算。"""
    return service.public_project_exists_for_media(session, media_id)


def register() -> None:
    """注册作品域的检查器。重复注册会报错（避免静默覆盖权限）。"""
    media_public_refs.register(CHECKER_NAME, media_is_publicly_referenced)


def unregister() -> None:
    """仅测试使用。"""
    media_public_refs.unregister(CHECKER_NAME)


__all__ = ["CHECKER_NAME", "media_is_publicly_referenced", "register", "unregister"]
