"""文章对媒体的公开引用检查（T01 提供的域实现）。

注册方式（SHARED-CONTRACTS §5：默认不生效，由 T00 显式注册后才开放）：

    from app.modules.posts import wiring
    wiring.register()      # 在 app/main.py 里显式调用一次

未注册时，即使文章已公开，封面图对匿名访客也是 404 —— 这是有意的安全默认值：
新的内容域必须自己声明它的公开引用规则，而不是继承一个「反正会通过」的默认值。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.media import public_refs as media_public_refs
from app.modules.posts import service

CHECKER_NAME = "posts"


def media_is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """公开文章的封面即构成公开引用；草稿 / 已撤回 / 已删除文章不算。"""
    return service.public_post_exists_for_media(session, media_id)


def register() -> None:
    """注册文章域的检查器。重复注册会报错（避免静默覆盖权限）。"""
    media_public_refs.register(CHECKER_NAME, media_is_publicly_referenced)


def unregister() -> None:
    """仅测试使用。"""
    media_public_refs.unregister(CHECKER_NAME)
