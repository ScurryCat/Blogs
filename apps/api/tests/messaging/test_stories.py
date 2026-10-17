"""剧本仓库与角色卡的校验（08 §4 / §6）。

写坏的剧本必须在**测试里**立刻红，而不是等访客点进去才发现走进死路。
因此这里既验证随包交付的两本剧本确实合规，也验证校验器真的会拒绝坏剧本
（「永远通过的校验器」等于没有校验器）。
"""

from __future__ import annotations

import pytest

from app.modules.messaging import stories
from app.modules.messaging.characters import CHARACTERS, character_ids, get_character
from app.modules.messaging.stories.schema import (
    ContentRef,
    StoryChoice,
    StoryDefinition,
    StoryNode,
    StoryValidationError,
    validate_story,
)


def _story(**overrides) -> StoryDefinition:
    base = dict(
        id="demo",
        version="1.0.0",
        character_id="futaba",
        start_node="a",
        nodes={
            "a": StoryNode(
                id="a",
                lines=("第一句",),
                choices=(
                    StoryChoice(id="go", label="继续", next_node="b"),
                    StoryChoice(id="stay", label="再看看", next_node="b"),
                ),
                resume_text="回到刚才。",
            ),
            "b": StoryNode(id="b", lines=("结束",), ending=True),
        },
    )
    base.update(overrides)
    return StoryDefinition(**base)


def _two_way(start_choices, tail_lines=("结束",), tail_ending=True, extra_nodes=None):
    """构造一本只有 a / b 两节点、a 有两个合法选项的最小剧本。"""
    nodes = {
        "a": StoryNode(id="a", lines=("第一句",), choices=start_choices, resume_text="回到刚才。"),
        "b": StoryNode(id="b", lines=tail_lines, ending=tail_ending),
    }
    nodes.update(extra_nodes or {})
    return nodes


def test_shipped_stories_validate_and_are_paired_with_character_cards():
    stories.validate_all()
    for story in stories.STORIES:
        card = get_character(story.character_id)
        assert card is not None, story.id
        assert card.story_id == story.id


def test_shipped_stories_have_versions_and_are_walkable():
    for story in stories.STORIES:
        assert story.version
        assert story.start_node in story.nodes
        # 每个节点都能从起点走到，且至少有一个结尾（validate_story 已保证，这里再钉一次）
        assert any(node.ending for node in story.nodes.values())


def test_characters_have_no_duplicate_ids_and_readable_avatars():
    assert len(set(character_ids())) == len(CHARACTERS)
    for card in CHARACTERS:
        assert card.name and card.tone and card.forbidden and card.source_note
        assert card.avatar.startswith("/assets/legacy/img/avatar/")
        assert card.avatar.endswith(".png")
        # 素材库在仓库之外，线上页面不得依赖它（08 §5）；
        # 第二轮 §4.2 起头像改用原版黑白 sprite（不再是彩色立绘 + 灰度滤镜）。
        assert "reference" not in card.avatar
        assert "persona5-spriters" not in card.avatar
        assert "portrait/" not in card.avatar


def test_every_branching_node_has_resume_text_and_legal_choices():
    for story in stories.STORIES:
        for node in story.nodes.values():
            if node.choices:
                assert node.resume_text, f"{story.id}/{node.id} 没有回到话题的衔接文案"
                assert 2 <= len(node.choices) <= 3
                for choice in node.choices:
                    assert choice.next_node in story.nodes
            else:
                assert node.ending, f"{story.id}/{node.id} 既没有选项也不是结尾"


def test_validator_rejects_unknown_next_node():
    story = _story(
        nodes={
            "a": StoryNode(
                id="a",
                lines=("第一句",),
                choices=(
                    StoryChoice(id="go", label="继续", next_node="nowhere"),
                    StoryChoice(id="stay", label="再看看", next_node="nowhere"),
                ),
                resume_text="回到刚才。",
            ),
            "b": StoryNode(id="b", lines=("结束",), ending=True),
        }
    )
    with pytest.raises(StoryValidationError, match="不存在的节点"):
        validate_story(story)


def test_validator_rejects_missing_resume_text():
    story = _story(
        nodes={
            "a": StoryNode(
                id="a",
                lines=("第一句",),
                choices=(
                    StoryChoice(id="x", label="一", next_node="b"),
                    StoryChoice(id="y", label="二", next_node="b"),
                ),
            ),
            "b": StoryNode(id="b", lines=("结束",), ending=True),
        }
    )
    with pytest.raises(StoryValidationError, match="resume_text"):
        validate_story(story)


def test_validator_rejects_dead_end_node():
    """既没有选项也不是结尾 → 访客会卡死。"""
    story = _story(
        nodes=_two_way(
            (
                StoryChoice(id="go", label="继续", next_node="b"),
                StoryChoice(id="stay", label="再看看", next_node="b"),
            ),
            tail_lines=("没有出口",),
            tail_ending=False,
        )
    )
    with pytest.raises(StoryValidationError, match="既没有选项也没有标记为结尾"):
        validate_story(story)


def test_validator_rejects_unreachable_node():
    story = _story(
        nodes=_two_way(
            (
                StoryChoice(id="go", label="继续", next_node="b"),
                StoryChoice(id="stay", label="再看看", next_node="b"),
            ),
            extra_nodes={"orphan": StoryNode(id="orphan", lines=("没人能到这里",), ending=True)},
        )
    )
    with pytest.raises(StoryValidationError, match="走不到"):
        validate_story(story)


def test_validator_rejects_choice_pointing_at_itself():
    story = _story(
        nodes={
            "a": StoryNode(
                id="a",
                lines=("第一句",),
                choices=(
                    StoryChoice(id="loop", label="原地", next_node="a"),
                    StoryChoice(id="go", label="继续", next_node="b"),
                ),
                resume_text="回到刚才。",
            ),
            "b": StoryNode(id="b", lines=("结束",), ending=True),
        }
    )
    with pytest.raises(StoryValidationError, match="指向自己"):
        validate_story(story)


def test_validator_rejects_duplicate_choice_ids():
    story = _story(
        nodes={
            "a": StoryNode(
                id="a",
                lines=("第一句",),
                choices=(
                    StoryChoice(id="same", label="一", next_node="b"),
                    StoryChoice(id="same", label="二", next_node="b"),
                ),
                resume_text="回到刚才。",
            ),
            "b": StoryNode(id="b", lines=("结束",), ending=True),
        }
    )
    with pytest.raises(StoryValidationError, match="选项 id"):
        validate_story(story)


def test_validator_rejects_story_without_ending():
    story = _story(
        nodes={
            "a": StoryNode(
                id="a",
                lines=("第一句",),
                choices=(
                    StoryChoice(id="go", label="继续", next_node="b"),
                    StoryChoice(id="back", label="回去", next_node="b"),
                ),
                resume_text="回到刚才。",
            ),
            "b": StoryNode(
                id="b",
                lines=("第二句",),
                choices=(
                    StoryChoice(id="one", label="一", next_node="a"),
                    StoryChoice(id="two", label="二", next_node="a"),
                ),
                resume_text="回到刚才。",
            ),
        }
    )
    with pytest.raises(StoryValidationError, match="结尾"):
        validate_story(story)


def test_validator_rejects_overlong_line():
    story = _story(
        nodes=_two_way(
            (
                StoryChoice(id="go", label="继续", next_node="b"),
                StoryChoice(id="stay", label="再看看", next_node="b"),
            )
        )
    )
    story.nodes["a"] = StoryNode(
        id="a",
        lines=("x" * 200,),
        choices=story.nodes["a"].choices,
        resume_text=story.nodes["a"].resume_text,
    )
    with pytest.raises(StoryValidationError, match="码点"):
        validate_story(story)


def test_story_lookup_helpers():
    assert stories.get_story("futaba-noise-and-signal") is not None
    assert stories.get_story("nope") is None
    assert stories.story_for_character("morgana") is not None
    assert stories.story_for_character("nobody") is None
    assert set(stories.story_ids()) == {story.id for story in stories.STORIES}


def test_content_refs_use_known_kinds_only():
    """剧本里用到的 kind 必须都在 content.py 的实现分支里。"""
    from app.modules.messaging import content

    supported = {"post", "moment", "recent_posts", "recent_moments", "path"}
    used: set[str] = set()
    for story in stories.STORIES:
        for node in story.nodes.values():
            for ref in node.cards:
                used.add(ref.kind)
                assert isinstance(ref, ContentRef)
                assert ref.label
    assert used <= supported, used - supported
    assert {"recent_posts", "recent_moments", "path"} <= used
    # STATIC_LINKS 里出现的路径就是剧本里 path 引用允许的取值
    allowed_paths = {link.path for link in content.STATIC_LINKS}
    for story in stories.STORIES:
        for node in story.nodes.values():
            for ref in node.cards:
                if ref.kind == "path":
                    assert ref.id in allowed_paths
