"""媒体公开引用检查的扩展点（SHARED-CONTRACTS §5、05 §8）。

规则：
  - `GET /api/v1/media/{id}/{variant}` 对匿名访客可见的条件是
    **媒体 ready + 未删除 + 至少一个当前公开引用**（05 §8）。
  - 「当前公开引用」由各内容域自己声明（文章封面、动态图片、相册、日记、作品……），
    因此这里是一个注册表而不是一个 `if` 大列表。
  - **默认拒绝**：注册表为空时，任何媒体对匿名都不可读。这里没有任何
    「暂时先返回 true」的占位判断 —— 未注册的新域一律拒绝，
    而 T00 在集成时显式注册已就绪的域（`register`）。
  - 一张图可以有多个公开引用：任一引用成立即公开；撤回其中一个不影响另一个（05 §11）。
  - 私密引用不会推翻另一个公开引用，也不会让本来不可读的媒体变可读。

检查函数签名：`(session, media_id) -> bool`，只做只读查询，必须自己带上「公开条件」。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

PublicReferenceChecker = Callable[[Session, uuid.UUID], bool]

_checkers: dict[str, PublicReferenceChecker] = {}


class DuplicateCheckerError(RuntimeError):
    """同一个域注册了两次；覆盖会静默改变权限，因此在注册时就报错。"""


def register(name: str, checker: PublicReferenceChecker) -> None:
    """登记一个域的公开引用检查。重复登记立即报错，不做静默覆盖。"""
    if not name or not name.strip():
        raise ValueError("媒体公开引用检查必须有名字")
    if name in _checkers:
        raise DuplicateCheckerError(f"媒体公开引用检查 {name!r} 已登记")
    _checkers[name] = checker


def unregister(name: str) -> None:
    """仅测试与集成回滚使用：移除一个检查器。"""
    _checkers.pop(name, None)


def registered() -> tuple[str, ...]:
    return tuple(sorted(_checkers))


def reset() -> None:
    """仅测试使用：清空注册表，回到「默认拒绝」。"""
    _checkers.clear()


def is_publicly_referenced(session: Session, media_id: uuid.UUID) -> bool:
    """任一已注册域声明该媒体有公开引用即为真；注册表为空则为假。"""
    for checker in list(_checkers.values()):
        if checker(session, media_id):
            return True
    return False
