"""作品域对共享扩展点的统一登记入口。

集成负责人在 `app/main.py` 的 `register_content_domains()` 里加两行：

    from app.modules.projects import wiring as projects_wiring
    projects_wiring.register()

它登记 T06 **作品**域对共享扩展点的贡献：

  1. `media/public_refs`：公开作品的图片构成媒体的公开引用。
     **不登记 = 匿名读作品图片 404**（默认拒绝，SHARED-CONTRACTS §5）。

作品域**不**登记公开标签来源：作品的「技术栈」是 `projects.tech_stack` 里的一组短字符串
（07 §8 的 `projects` 行没有给作品→标签的关联表），它不是 T01 标签表里的行，因此
`GET /tags` 不应该凭空多出「FastAPI」这种技术名词。要改成真实标签关系需要先改契约，
不是本包能顺手决定的事（见交付单的遗留项）。

相册域的贡献在 `app.modules.gallery.wiring`，两者各自提供 `register()` / `unregister()`，
集成时逐条登记，不合并成一个「showcase」大开关 —— 分开才能单独回滚一个域的权限。
"""

from __future__ import annotations

from app.modules.projects import public_refs


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
