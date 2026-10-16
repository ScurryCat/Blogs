"""技能域对共享扩展点的统一登记入口（T09）。

**本域不向任何共享注册表贡献条目**，因此集成负责人**不需要**在 `app/main.py` 里为本域
调用 `register()`（对比 T01 的 `app.modules.posts.wiring.register()`，那是必须的）。

理由：

  - 技能**没有自己的媒体**：07 §6 的技能全书用文字证据与站外链接表达能力，
    没有封面、截图或图标列，`project_skills` 只引用作品，所以不登记
    `media.public_refs`（默认拒绝的语义在这里是「本来就没有引用」）。
    技能页面上出现的图片都是**关联作品**的图片，那由 `projects` 域自己登记（T06 已做）。
  - 技能**不产生新的公开标签来源**：`skills.name` 不是 T01 `tags` 表里的行，
    也不与 `projects.tech_stack` 共享存储（见 `models.py` 的说明）。
    要改成真实标签关系需要先改契约（交付单「集成申请」第 5 条）。

`verify_no_shared_contributions()` 把上面这段话变成可执行断言（集成自检与模块测试都调用），
避免以后有人「顺手」给 skills 加一条全局注册而没有更新文档。
"""

from __future__ import annotations

# 本域对共享扩展点的贡献清单：空。集成检查与交付单引用同一个常量。
CONTRIBUTIONS: tuple[str, ...] = ()


def register() -> tuple[str, ...]:
    """幂等的集成声明：返回贡献清单（空），不做任何全局注册。

    保留这个函数是为了让 `main.py` 的接线对所有模块同形；调用它没有副作用。
    """
    # 导入 router 会连带导入 models / schemas，任何模型或路由构造错误都会在这里暴露。
    from app.modules.skills import router as skills_router

    assert skills_router.router is not None
    return CONTRIBUTIONS


def registered_contributions() -> tuple[str, ...]:
    return CONTRIBUTIONS


def verify_no_shared_contributions() -> None:
    """自检：skills 没有出现在媒体公开引用与公开标签来源的注册表里。"""
    from app.modules.media import public_refs
    from app.modules.tags import service as tags_service

    assert "skills" not in public_refs.registered(), (
        "skills 不应登记媒体公开引用检查（技能没有自己的媒体）"
    )
    assert not any(
        name.startswith("skills") for name in tags_service.registered_public_tag_sources()
    ), "skills 不应登记公开标签来源（技能名不是 tags 表的行）"


__all__ = [
    "CONTRIBUTIONS",
    "register",
    "registered_contributions",
    "verify_no_shared_contributions",
]
