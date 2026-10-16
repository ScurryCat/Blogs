"""问题记录域对共享扩展点的统一登记入口（T09）。

**本域不向任何共享注册表贡献条目**，因此集成负责人**不需要**在 `app/main.py` 里为本域
调用 `register()`。

理由：

  - 问题记录**没有自己的媒体**：07 §6 的印象空间记录是文字 + 站外验证链接，
    没有图片列，关联表只引用文章与作品，所以不登记 `media.public_refs`
    （默认拒绝的语义在这里是「本来就没有引用」）。记录页上出现的图片来自
    **关联的文章 / 作品**，那由 posts（T01）/ projects（T06）域各自登记。
  - 问题记录**不产生新的公开标签来源**：07 §8 的 `exploration_records` 行没有标签项，
    记录的分类沿用关联文章的分类，也就是 T01 已经登记的标签来源。

`verify_no_shared_contributions()` 把上面这段话变成可执行断言（集成自检与模块测试都调用）。
"""

from __future__ import annotations

CONTRIBUTIONS: tuple[str, ...] = ()


def register() -> tuple[str, ...]:
    """幂等的集成声明：返回贡献清单（空），不做任何全局注册。"""
    from app.modules.exploration import router as exploration_router

    assert exploration_router.router is not None
    return CONTRIBUTIONS


def registered_contributions() -> tuple[str, ...]:
    return CONTRIBUTIONS


def verify_no_shared_contributions() -> None:
    """自检：exploration 没有出现在媒体公开引用与公开标签来源的注册表里。"""
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    assert "exploration" not in public_refs.registered(), (
        "exploration 不应登记媒体公开引用检查（问题记录没有自己的媒体）"
    )
    assert not any(
        name.startswith("exploration") for name in tags_service.registered_public_tag_sources()
    ), "exploration 不应登记公开标签来源（记录没有自己的标签关系）"


__all__ = [
    "CONTRIBUTIONS",
    "register",
    "registered_contributions",
    "verify_no_shared_contributions",
]
