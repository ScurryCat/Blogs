"""文章域对共享扩展点的统一登记入口。

T00 在 `app/main.py` 里只需调用一次：

    from app.modules.posts import wiring
    wiring.register()

它登记 T01 文章域对两个扩展点的贡献：
  1. `media/public_refs`：公开文章的封面构成媒体的公开引用（否则匿名读封面 404）。
  2. `tags/service`：公开标签来源（否则 `GET /tags` 只能返回空列表）。

两个注册表默认都是「不贡献 / 拒绝」，所以**必须显式登记**才生效
（SHARED-CONTRACTS §5）。后续域（动态、日记、相册……）各自提供同样的 wiring。
"""

from __future__ import annotations

from app.modules.posts import public_refs, tags_source


def register() -> None:
    public_refs.register()
    tags_source.register()


def unregister() -> None:
    """仅测试使用：回到「默认不贡献」的状态。"""
    public_refs.unregister()
    tags_source.unregister()


def registered_contributions() -> tuple[str, ...]:
    """当前已登记的贡献名，供集成检查与测试断言。"""
    from app.modules.media import public_refs as media_public_refs
    from app.modules.tags import service as tags_service

    return tuple(sorted(media_public_refs.registered())) + tuple(
        f"tags:{name}" for name in tags_service.registered_public_tag_sources()
    )
