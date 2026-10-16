"""放课后的共用规则：字段归属、集数约束与展示标签。

**为什么单独一个模块**：同一条规则要在三处生效，不能各写一份「看起来差不多」的实现：

  1. `schemas.py` 的写入校验（给出**字段级 422**，错误信息面向人）；
  2. `service.py` 合并 PATCH 之后的**整体一致性**校验（避免「只改一个字段」绕过约束）；
  3. `models.py` 的数据库 CHECK（绕过 API 也写不进去）。

这里放纯函数：不碰数据库、不碰 FastAPI，因此可以被上面三处与前端共享的
「标签文案」测试直接覆盖。

两条与产品语义直接相关的规则：

  - **总数未知不算完成率**（07 §3、验收 3）：`completion_ratio` 在总数未知、
    总数非正或集数未知时返回 `None`，`episodes_label` 输出「看到第 6 集」。
  - **通关不等于全成就**（07 §3）：`completed_on` 与 `all_achievements` 各自独立，
    这里没有任何「通关 → 自动全成就」的推导。
"""

from __future__ import annotations

from app.modules.leisure.models import (
    ALL_PROGRESS,
    ANIME_PROGRESS,
    GAME_PROGRESS,
    KIND_ANIME,
    KIND_GAME,
    PROGRESS_LABELS,
)

# 分类型专属字段（出现在另一类型的记录上就是错的，数据库 CHECK 与 DTO 都拦）。
ANIME_ONLY_FIELDS = ("season", "total_episodes", "episodes_watched", "last_watched_on", "airing")
GAME_ONLY_FIELDS = ("platform", "playtime_minutes", "started_on", "completed_on", "all_achievements")

ANIME_ONLY_LABELS = {
    "season": "季度",
    "total_episodes": "总集数",
    "episodes_watched": "已看集数",
    "last_watched_on": "最近观看日期",
    "airing": "连载中",
}
GAME_ONLY_LABELS = {
    "platform": "平台",
    "playtime_minutes": "时长",
    "started_on": "开始日期",
    "completed_on": "完成日期",
    "all_achievements": "全成就",
}


def default_progress(kind: str) -> str:
    """新建时的默认进度：追番「想看」、游戏「想玩」。"""
    return "wish"


def allowed_progress(kind: str) -> tuple[str, ...]:
    if kind == KIND_ANIME:
        return ANIME_PROGRESS
    if kind == KIND_GAME:
        return GAME_PROGRESS
    return ALL_PROGRESS


def has_value(value: object) -> bool:
    """`None`、空串都算「没有值」；`False` 与 `0` 是明确的值，不能被当成空。"""
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True


def cross_kind_fields(kind: str, values: dict[str, object]) -> list[str]:
    """在给定类型的记录上，哪些字段是**另一个类型专属**且真的带了值。"""
    offending_fields = GAME_ONLY_FIELDS if kind == KIND_ANIME else ANIME_ONLY_FIELDS
    return [name for name in offending_fields if has_value(values.get(name))]


def cross_kind_labels(kind: str, names: list[str]) -> list[str]:
    table = GAME_ONLY_LABELS if kind == KIND_ANIME else ANIME_ONLY_LABELS
    return [table.get(name, name) for name in names]


def progress_label(kind: str, progress: str) -> str:
    table = PROGRESS_LABELS.get(kind) or PROGRESS_LABELS[KIND_ANIME]
    return table.get(progress, progress)


def episodes_label(watched: int | None, total: int | None) -> str:
    """进度标签。**总数未知时不产生任何百分比**（验收 3）。"""
    if watched is None and total is None:
        return "还没记录进度"
    if watched is None:
        return f"共 {total} 集"
    if total is None:
        return f"看到第 {watched} 集"
    return f"看到第 {watched} / {total} 集"


def completion_ratio(watched: int | None, total: int | None) -> float | None:
    """完成率。总数未知、总数非正或集数未知时返回 `None` —— 不计算假的完成率。"""
    if watched is None or total is None or total <= 0:
        return None
    return round(min(watched, total) / total, 4)


def episodes_conflict(watched: int | None, total: int | None) -> bool:
    """集数是否越界（总数未知时永远不越界）。"""
    return watched is not None and total is not None and watched > total


def playtime_label(minutes: int | None) -> str:
    """时长标签。未填就是「未记录」，不显示 0 小时。"""
    if minutes is None:
        return "未记录时长"
    hours, remainder = divmod(int(minutes), 60)
    if hours and remainder:
        return f"{hours} 小时 {remainder} 分"
    if hours:
        return f"{hours} 小时"
    return f"{remainder} 分"


__all__ = [
    "ANIME_ONLY_FIELDS",
    "ANIME_ONLY_LABELS",
    "GAME_ONLY_FIELDS",
    "GAME_ONLY_LABELS",
    "allowed_progress",
    "completion_ratio",
    "cross_kind_fields",
    "cross_kind_labels",
    "default_progress",
    "episodes_conflict",
    "episodes_label",
    "has_value",
    "playtime_label",
    "progress_label",
]
