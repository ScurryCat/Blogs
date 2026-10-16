"""messaging 域的集成声明（**集成申请见交付单 §6**）。

本域**不向任何共享注册表贡献条目**，因此集成负责人**不需要**在 `app/main.py` 里
为本域调用 `register()`（对比 T01 的 `posts.wiring.register()`：那是必须的，因为文章
封面构成媒体的公开引用）。理由：

  - 角色消息**没有自己的媒体**：首版不向模型传图片、也不生成图片，
    所以不登记 `media.public_refs`。默认拒绝的语义在这里是「本来就没有引用」，
    而不是「忘了登记」。
  - 角色消息**不产生公开标签**：会话不是公开内容，不参与 `/tags`。
  - 会话正文**不进入公开搜索**（08 §6），因此也不登记任何检索来源。

`verify_no_shared_contributions()` 把这段话变成可执行断言（集成自检与模块测试都调用），
避免以后有人「顺手」给本域加一条全局注册却没有更新交付单。

本域**确实需要**的三件事（都在交付单 §6 里，由 T00 做，不在本文件里做）：
  1. `MODEL_MODULES` 追加 `app.modules.messaging.models`（依赖 `auth`，因为它不引用其他域的表）；
  2. `MODULE_ROUTER_TARGETS` 追加 `("messaging", "app.modules.messaging.router")`；
  3. 迁移：`visitor_sessions` / `conversations` / `messages` / `ai_requests` /
     `ai_budget_days` / `ai_visitor_days` 六张表（**T08 自己不写 migrations/**）。

`validate_all()` 在导入时就把剧本仓库校验一遍：写坏的剧本应该在测试里立刻红，
而不是等访客点进去才发现。
"""

from __future__ import annotations

from app.modules.messaging import stories

# 本域对共享扩展点的贡献清单：空。集成检查与交付单引用同一个常量。
CONTRIBUTIONS: tuple[str, ...] = ()

# 本域需要 T00 登记的清单（机器可读，供集成自检与交付单引用）。
MODEL_MODULE = "app.modules.messaging.models"
ROUTER_TARGET: tuple[str, str] = ("messaging", "app.modules.messaging.router")
MESSAGING_TABLES: tuple[str, ...] = (
    "visitor_sessions",
    "conversations",
    "messages",
    "ai_requests",
    "ai_budget_days",
    "ai_visitor_days",
)


def register() -> tuple[str, ...]:
    """幂等的集成声明：校验剧本仓库并返回贡献清单（空），不做任何全局注册。

    保留这个函数是为了让 `main.py` 的接线对所有模块同形；调用它没有副作用，
    因此 T00 **可以**调用它（多一层启动期校验），不调用也不影响功能。
    """
    from app.modules.messaging import router as messaging_router
    from app.modules.messaging import service  # noqa: F401 - 触发依赖导入

    assert messaging_router.router is not None
    stories.validate_all()
    return CONTRIBUTIONS


def registered_contributions() -> tuple[str, ...]:
    return CONTRIBUTIONS


def verify_no_shared_contributions() -> None:
    """自检：messaging 没有出现在媒体公开引用与公开标签来源的注册表里。"""
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    assert "messaging" not in public_refs.registered(), (
        "messaging 不应登记媒体公开引用检查（角色消息没有自己的媒体）"
    )
    assert not any(
        name.startswith("messaging") for name in tags_service.registered_public_tag_sources()
    ), "messaging 不应登记公开标签来源（会话不是公开内容）"


def verify_story_registry() -> None:
    """自检：剧本与角色卡一一对应，且每个角色的剧本都能完整走通。"""
    stories.validate_all()


__all__ = [
    "CONTRIBUTIONS",
    "MESSAGING_TABLES",
    "MODEL_MODULE",
    "ROUTER_TARGET",
    "register",
    "registered_contributions",
    "verify_no_shared_contributions",
    "verify_story_registry",
]
