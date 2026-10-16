"""相册域对共享扩展点的统一登记入口。

集成负责人在 `app/main.py` 的 `register_content_domains()` 里加两行：

    from app.modules.gallery import wiring as gallery_wiring
    gallery_wiring.register()

它登记 T06 **相册**域对共享扩展点的贡献：

  1. `media/public_refs`：公开相册的照片构成媒体的公开引用。
     **不登记 = 匿名读照片墙的图片 404**（默认拒绝，SHARED-CONTRACTS §5）。

相册域**不**登记公开标签来源：07 §8 的 `albums` 行没有给相册→标签的关联表，
相册的主题维度是 `albums.kind`（摄影 / 游戏截图 / 其它）。要加标签先改契约。

作品域的贡献在 `app.modules.projects.wiring`。两个域各自 `register()` / `unregister()`，
集成时逐条登记 —— 分开才能单独回滚一个域的权限（例如相册出问题时先只撤相册）。
"""

from __future__ import annotations

from app.modules.gallery import public_refs


def register() -> None:
    public_refs.register()


def unregister() -> None:
    """仅测试使用。"""
    public_refs.unregister()


def registered_contributions() -> tuple[str, ...]:
    """当前已登记的贡献名，供集成检查与测试断言。"""
    from app.modules.media import public_refs as media_public_refs

    return tuple(sorted(media_public_refs.registered()))


__all__ = ["register", "registered_contributions", "unregister"]
