"""剧本的数据结构与**确定性**校验（08 §6「剧情引擎」）。

边界：剧情引擎持有 node ID、合法选项与固定分支；模型无权修改。因此这个文件里
没有任何异步、没有网络、没有随机数：同样的输入永远得到同样的下一个节点。

结构校验在**导入剧本时**执行（见 `stories/__init__.py`），失败即抛
`StoryValidationError` —— 一本写坏的剧本应该在测试里立刻红，而不是等访客点进去才发现。
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 单条剧本台词 / 选项文字的长度上限。它们要在手机上以短气泡呈现（08 §5）。
LINE_MAX_CODEPOINTS = 160
CHOICE_LABEL_MAX_CODEPOINTS = 24
NODE_ID_MAX = 64
CHOICE_ID_MAX = 64
# 一个节点的选项个数：08 §3 说「先给一个短开场与两三个选项」。
CHOICES_MIN = 2
CHOICES_MAX = 3


class StoryValidationError(ValueError):
    """剧本结构不合法。信息里包含 story id 与具体节点，便于直接修文件。"""


@dataclass(frozen=True)
class ContentRef:
    """剧本 / 模型建议打开的一个站内内容。

    **不是链接**：`kind` + `id` 由服务端在写入消息时按当前公开状态重新解析
    （见 `content.py`）。解析不到就丢弃，绝不下发一个指向空页面的链接（08 §3）。
    """

    kind: str
    """`post`（slug）/ `moment`（UUID）/ `path`（站内固定路径，见 content.STATIC_LINKS）。"""
    id: str
    label: str
    """按钮文字。脚本作者写死；模型输出不使用这个字段（模型只给 token）。"""


@dataclass(frozen=True)
class StoryChoice:
    id: str
    label: str
    next_node: str
    cards: tuple[ContentRef, ...] = ()


@dataclass(frozen=True)
class StoryNode:
    id: str
    lines: tuple[str, ...]
    choices: tuple[StoryChoice, ...] = ()
    resume_text: str | None = None
    """「回到话题」衔接文案。**有选项的节点必须提供**（08 §3）。"""
    cards: tuple[ContentRef, ...] = ()
    ending: bool = False

    @property
    def resumable(self) -> bool:
        """是否允许从自由聊天回到这个话题。"""
        return bool(self.choices) and self.resume_text is not None


@dataclass(frozen=True)
class StoryDefinition:
    id: str
    version: str
    character_id: str
    start_node: str
    nodes: dict[str, StoryNode] = field(default_factory=dict)
    credit: str = "原创同人剧本，不是游戏原文"

    def node(self, node_id: str) -> StoryNode | None:
        return self.nodes.get(node_id)

    def require_node(self, node_id: str) -> StoryNode:
        node = self.nodes.get(node_id)
        if node is None:
            raise StoryValidationError(f"剧本 {self.id} 没有节点 {node_id!r}")
        return node


def validate_story(story: StoryDefinition) -> None:
    """结构校验。任何一条不满足都抛 `StoryValidationError`。"""

    def fail(message: str) -> None:
        raise StoryValidationError(f"剧本 {story.id}：{message}")

    if not story.id or len(story.id) > NODE_ID_MAX:
        fail("id 不能为空且不超过 64 字符")
    if not story.version:
        fail("version 不能为空")
    if not story.nodes:
        fail("至少要有一个节点")
    if story.start_node not in story.nodes:
        fail(f"起始节点 {story.start_node!r} 不存在")

    seen_ids: set[str] = set()
    for node_id, node in story.nodes.items():
        if node_id != node.id:
            fail(f"节点字典的键 {node_id!r} 与节点 id {node.id!r} 不一致")
        if node_id in seen_ids:
            fail(f"节点 id {node_id!r} 重复")
        seen_ids.add(node_id)
        if len(node_id) > NODE_ID_MAX:
            fail(f"节点 id {node_id!r} 超过 {NODE_ID_MAX} 字符")

        if not node.lines:
            fail(f"节点 {node_id!r} 没有任何台词")
        for line in node.lines:
            if not line.strip():
                fail(f"节点 {node_id!r} 有空台词")
            if len(line) > LINE_MAX_CODEPOINTS:
                fail(f"节点 {node_id!r} 的台词超过 {LINE_MAX_CODEPOINTS} 码点")

        if node.choices:
            if not (CHOICES_MIN <= len(node.choices) <= CHOICES_MAX):
                fail(
                    f"节点 {node_id!r} 有 {len(node.choices)} 个选项，"
                    f"必须在 {CHOICES_MIN}–{CHOICES_MAX} 之间"
                )
            if node.ending:
                fail(f"节点 {node_id!r} 既是分支又是结尾")
            if not node.resume_text or not node.resume_text.strip():
                # 08 §3：每个可暂停节点都有简短的「回到话题」衔接文案。
                fail(f"节点 {node_id!r} 有选项但没有 resume_text（回到话题的衔接文案）")
            if len(node.resume_text) > LINE_MAX_CODEPOINTS:
                fail(f"节点 {node_id!r} 的 resume_text 超过 {LINE_MAX_CODEPOINTS} 码点")

            choice_ids: set[str] = set()
            for choice in node.choices:
                if not choice.id or len(choice.id) > CHOICE_ID_MAX:
                    fail(f"节点 {node_id!r} 的选项 id 不合法：{choice.id!r}")
                if choice.id in choice_ids:
                    fail(f"节点 {node_id!r} 的选项 id {choice.id!r} 重复")
                choice_ids.add(choice.id)
                if not choice.label.strip():
                    fail(f"节点 {node_id!r} 的选项 {choice.id!r} 没有文字")
                if len(choice.label) > CHOICE_LABEL_MAX_CODEPOINTS:
                    fail(
                        f"节点 {node_id!r} 的选项 {choice.id!r} 文字超过"
                        f" {CHOICE_LABEL_MAX_CODEPOINTS} 码点"
                    )
                if choice.next_node not in story.nodes:
                    fail(
                        f"节点 {node_id!r} 的选项 {choice.id!r} 指向不存在的节点"
                        f" {choice.next_node!r}"
                    )
        elif not node.ending:
            # 既没有选项也不是结尾 → 走进去就出不来。
            fail(f"节点 {node_id!r} 既没有选项也没有标记为结尾，访客会卡死在这里")

    for node_id, node in story.nodes.items():
        for choice in node.choices:
            if choice.next_node == node_id:
                # 不算错误，但「原地打转」的选项在 UI 上没有意义；显式禁止以免误写。
                fail(f"节点 {node_id!r} 的选项 {choice.id!r} 指向自己")

    _validate_reachability(story, fail)


def _validate_reachability(story: StoryDefinition, fail) -> None:
    """所有节点都必须能从起始节点走到，并且至少能走到一个结尾。"""
    reachable: set[str] = set()
    stack = [story.start_node]
    while stack:
        current = stack.pop()
        if current in reachable:
            continue
        reachable.add(current)
        node = story.nodes.get(current)
        if node is None:
            continue
        for choice in node.choices:
            stack.append(choice.next_node)

    unreachable = sorted(set(story.nodes) - reachable)
    if unreachable:
        fail(f"这些节点从起始节点走不到：{', '.join(unreachable)}")

    if not any(story.nodes[node_id].ending for node_id in reachable):
        fail("从起始节点走不到任何结尾节点")


__all__ = [
    "CHOICES_MAX",
    "CHOICES_MIN",
    "CHOICE_ID_MAX",
    "CHOICE_LABEL_MAX_CODEPOINTS",
    "LINE_MAX_CODEPOINTS",
    "NODE_ID_MAX",
    "ContentRef",
    "StoryChoice",
    "StoryDefinition",
    "StoryNode",
    "StoryValidationError",
    "validate_story",
]
