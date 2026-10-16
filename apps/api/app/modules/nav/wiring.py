"""nav 域的集成声明与跨模块只读门面。

**nav 不向任何共享注册表贡献条目**，因此集成方**不需要**在 `app/main.py` 里为本域调用
`register()`（对比 T01 的 `app.modules.posts.wiring.register()`，那是必须的，因为文章封面
构成媒体的公开引用、文章提供公开标签来源）。理由：

  - 导航专题**没有自己的媒体**：专题封面、图谱都还没有，`palace_posts` 只引用文章，
    所以不登记 `media.public_refs`（默认拒绝的语义在这里是「本来就没有引用」）；
  - 专题的标签由关联**公开文章**的标签并集派生，不产生新的公开标签来源，
    所以不登记 `tags` 的公开来源。

`verify_no_shared_contributions()` 把上面这段话变成可执行断言（集成自检与模块测试都调用），
避免以后有人「顺手」给 nav 加一条全局注册而没有更新文档。

跨模块真正需要的是**只读门面**（T06 作品关联专题、T09 问题记录组合入口）：
`service.related_public_palaces_for_post` / `public_palace_by_slug` / `public_palace_options`。
"""

from __future__ import annotations

# 本域对共享扩展点的贡献清单：空。集成检查与交付单引用同一个常量。
CONTRIBUTIONS: tuple[str, ...] = ()


def register() -> tuple[str, ...]:
    """幂等的集成声明：返回贡献清单（空），不做任何全局注册。

    保留这个函数是为了让 `main.py` 的接线对所有模块同形；调用它没有副作用。
    """
    # 导入 router 会连带导入 models / schemas，任何模型或路由构造错误都会在这里暴露。
    from app.modules.nav import router as nav_router

    assert nav_router.router is not None
    return CONTRIBUTIONS


def registered_contributions() -> tuple[str, ...]:
    return CONTRIBUTIONS


def verify_no_shared_contributions() -> None:
    """自检：nav 没有出现在媒体公开引用与公开标签来源的注册表里。"""
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    assert "nav" not in public_refs.registered(), (
        "nav 不应登记媒体公开引用检查（专题没有自己的媒体）"
    )
    assert not any(name.startswith("nav") for name in tags_service.registered_public_tag_sources()), (
        "nav 不应登记公开标签来源（专题标签由公开文章派生）"
    )


__all__ = ["CONTRIBUTIONS", "register", "registered_contributions", "verify_no_shared_contributions"]
