"""版本化剧本仓库（08 §6：角色、剧本与界面配置先存版本化仓库文件）。

为什么是仓库文件而不是数据库表：
  - 剧本是**代码资产**：它要跟着版本走、要能在 PR 里 diff、要在测试里校验结构；
  - 会话里只记录 `story_id` + `story_version` + `node_id`，因此改剧本不会静默
    改变进行中的会话语义（版本不匹配时由 `service.py` 明确处理）。

导入本模块即完成**全部剧本的结构校验**；写坏的剧本会让测试立刻失败。
`validate_all()` 是显式入口，供测试与 `wiring.register()` 调用。
"""

from __future__ import annotations

from app.modules.messaging.characters import CHARACTERS, get_character
from app.modules.messaging.stories import futaba, morgana
from app.modules.messaging.stories.schema import (
    ContentRef,
    StoryChoice,
    StoryDefinition,
    StoryNode,
    StoryValidationError,
    validate_story,
)

STORIES: tuple[StoryDefinition, ...] = (futaba.STORY, morgana.STORY)

_BY_ID = {story.id: story for story in STORIES}


class StoryRegistryError(RuntimeError):
    """剧本仓库自身不一致（角色↔剧本对不上、id 重复等）。"""


def validate_all() -> None:
    """校验每一本剧本，以及「角色卡 ↔ 剧本」的对应关系。任一不满足即抛错。"""

    seen: set[str] = set()
    for story in STORIES:
        validate_story(story)
        if story.id in seen:
            raise StoryRegistryError(f"剧本 id {story.id!r} 重复")
        seen.add(story.id)
        card = get_character(story.character_id)
        if card is None:
            raise StoryRegistryError(
                f"剧本 {story.id!r} 指向不存在的角色 {story.character_id!r}"
            )
        if card.story_id != story.id:
            raise StoryRegistryError(
                f"角色 {card.id!r} 的角色卡写着剧本 {card.story_id!r}，"
                f"但剧本 {story.id!r} 才是它的定义"
            )

    for card in CHARACTERS:
        if card.story_id not in _BY_ID:
            raise StoryRegistryError(
                f"角色 {card.id!r} 的剧本 {card.story_id!r} 不在剧本仓库里"
            )


def get_story(story_id: str) -> StoryDefinition | None:
    return _BY_ID.get((story_id or "").strip())


def story_for_character(character_id: str) -> StoryDefinition | None:
    card = get_character(character_id)
    if card is None:
        return None
    return _BY_ID.get(card.story_id)


def story_ids() -> tuple[str, ...]:
    return tuple(story.id for story in STORIES)


__all__ = [
    "STORIES",
    "ContentRef",
    "StoryChoice",
    "StoryDefinition",
    "StoryNode",
    "StoryRegistryError",
    "StoryValidationError",
    "get_story",
    "story_for_character",
    "story_ids",
    "validate_all",
]
