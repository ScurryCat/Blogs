"""动态域对共享扩展点的统一登记入口。

T00 在 `app/main.py` 里只需在 `register_content_domains()` 中加两行：

    from app.modules.moments import wiring as moments_wiring
    moments_wiring.register()

它登记 T03 动态域对两个扩展点的贡献：

  1. `media/public_refs`：公开动态的图片构成媒体的公开引用。
     **不登记 = 匿名读动态图片 404**（默认拒绝，SHARED-CONTRACTS §5）。
  2. `tags/service`：公开动态使用到的标签进入 `GET /tags`。
     不登记时，动态的标签在标签列表里看不见；动态详情与筛选本身仍然可用
     （它们直接按 `tags.slug` 查关联表），所以这一条是「少了个入口」而不是坏掉。

与 `posts.wiring` 的差别：文章域不注册时 `/tags` 会返回空数组（因为文章是那时的
唯一来源），动态域不注册只是少一批标签。两者都必须显式登记，理由相同。
"""

from __future__ import annotations

from app.modules.moments import public_refs, tags_source


def register() -> None:
    public_refs.register()
    tags_source.register()


def unregister() -> None:
    """仅测试使用。

    `tags/service.py`（T01 所有）只有整体清空、没有按名注销，因此这里只注销媒体
    引用检查；标签来源请用 `tags_service.reset_public_tag_sources()` 后重新登记。
    """
    public_refs.unregister()


def registered_contributions() -> tuple[str, ...]:
    """当前已登记的贡献名，供集成检查与测试断言。"""
    from app.modules.media import public_refs as media_public_refs
    from app.modules.tags import service as tags_service

    return tuple(sorted(media_public_refs.registered())) + tuple(
        f"tags:{name}" for name in tags_service.registered_public_tag_sources()
    )
