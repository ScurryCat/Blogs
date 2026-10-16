"""手记域的集成声明。

集成方（T00）在 `app/main.py` 的 `register_content_domains()` 里加一行即可：

    from app.modules.journal import wiring as journal_wiring
    journal_wiring.register()

**必须登记**：不登记时，一篇已发布且 public 的日记，它的封面 / 正文图片对匿名访客
一律 404（`media/public_refs` 是默认拒绝的注册表）。这不是可选的优化项，而是
「公开日记配图能不能被看到」的前提。

本域**不**贡献公开标签来源：日记没有标签字段（07 §3 的字段清单里没有标签），
也就没有新的公开标签可聚合。`verify_no_shared_tag_contributions()` 把这句话变成
可执行断言，避免以后有人「顺手」加一条全局注册却没有更新文档。
"""

from __future__ import annotations

from app.modules.journal import public_refs

# 本域对共享扩展点的贡献清单。集成检查与交付单引用同一个常量。
CONTRIBUTIONS: tuple[str, ...] = ("media:journal",)


def register() -> tuple[str, ...]:
    """登记手记域的媒体公开引用检查；返回贡献清单。重复调用会抛错（防静默覆盖）。"""
    public_refs.register()
    return CONTRIBUTIONS


def unregister() -> None:
    """仅测试使用：回到「默认不贡献」的状态。"""
    public_refs.unregister()


def registered_contributions() -> tuple[str, ...]:
    """当前实际生效的贡献（从共享注册表读取，而不是相信常量）。"""
    from app.modules.media import public_refs as media_public_refs

    return tuple(
        f"media:{name}" for name in media_public_refs.registered() if name == public_refs.CHECKER_NAME
    )


def verify_registered() -> None:
    """自检：本域的检查器确实在共享注册表里。集成后由模块测试调用。"""
    from app.modules.media import public_refs as media_public_refs

    assert public_refs.CHECKER_NAME in media_public_refs.registered(), (
        "手记的媒体公开引用检查没有登记；公开日记的配图会对匿名 404"
    )


def verify_no_shared_tag_contributions() -> None:
    """自检：手记不贡献公开标签来源（日记没有标签字段）。"""
    from app.modules.tags import service as tags_service

    assert not any(
        name.startswith("journal") for name in tags_service.registered_public_tag_sources()
    ), "手记不应登记公开标签来源（日记没有标签字段）"


__all__ = [
    "CONTRIBUTIONS",
    "register",
    "registered_contributions",
    "unregister",
    "verify_no_shared_tag_contributions",
    "verify_registered",
]
