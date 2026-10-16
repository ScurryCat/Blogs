"""双叶的一段完整预设剧情（原创同人，不是游戏原文；08 §4）。

主题：项目、算法训练、调试过程 —— 与站点的结合点是**公开**的技术文章与作品。
所有指向内容的卡片都是「引用」而不是链接：服务端会在写入消息时按当前公开状态
重新解析，解析不到就丢弃（08 §3「不能链接到空页面」）。
"""

from __future__ import annotations

from app.modules.messaging.stories.schema import (
    ContentRef,
    StoryChoice,
    StoryDefinition,
    StoryNode,
)

STORY = StoryDefinition(
    id="futaba-noise-and-signal",
    version="1.0.0",
    character_id="futaba",
    start_node="intro",
    nodes={
        "intro": StoryNode(
            id="intro",
            lines=(
                "这个据点还挺像样。你是来逛逛，还是准备拆开看看它怎么运作？",
                "先说好，我不负责导游。除非你问的东西有意思。",
            ),
            choices=(
                StoryChoice(id="see-works", label="看看博客作品", next_node="works"),
                StoryChoice(id="talk-acm", label="聊聊 ACM", next_node="acm"),
                StoryChoice(id="talk-debug", label="我在调一个 bug", next_node="debug"),
            ),
            resume_text="哦，回来了。刚才那个问题还算数吗？",
        ),
        "works": StoryNode(
            id="works",
            lines=(
                "喏，公开的东西都在这儿了。我只列得出来的，没发布的我可看不到。",
                "看的时候别只看标题 —— 点进去才有正文。",
            ),
            choices=(
                StoryChoice(id="works-acm", label="有算法相关的吗", next_node="acm"),
                StoryChoice(id="works-debug", label="有讲调试的吗", next_node="debug"),
                StoryChoice(id="works-wrap", label="先看到这", next_node="wrap"),
            ),
            resume_text="还没看完？行，你继续。",
            cards=(
                ContentRef(kind="recent_posts", id="3", label="看看最近的长文"),
                ContentRef(kind="recent_moments", id="2", label="翻翻图文动态"),
            ),
        ),
        "acm": StoryNode(
            id="acm",
            lines=(
                "算法题？那得先分清楚卡在哪一层。",
                "是读不懂题在问什么、想不出思路，还是思路有了但写出来不对？",
            ),
            choices=(
                StoryChoice(id="acm-idea", label="想不出思路", next_node="acm_idea"),
                StoryChoice(id="acm-impl", label="写出来不对", next_node="acm_impl"),
            ),
            resume_text="回到刚才那道题 —— 你想先解决哪一层？",
        ),
        "acm_idea": StoryNode(
            id="acm_idea",
            lines=(
                "想不出思路的时候，先别想正解。把规模缩到最小，手算一遍，看规律从哪儿冒出来。",
                "再不行就把暴力解写出来 —— 很多优化的起点就是「我知道暴力会超时，那它慢在哪」。",
            ),
            choices=(
                StoryChoice(id="acm-idea-back", label="还是聊回那道题", next_node="acm"),
                StoryChoice(id="acm-idea-wrap", label="我去试试", next_node="wrap"),
            ),
            resume_text="还有别的想问的？",
        ),
        "acm_impl": StoryNode(
            id="acm_impl",
            lines=(
                "写出来不对，那基本是边界或者状态没定义清楚，不是「算法选错了」。",
                "先造三个用例：最小的、刚好卡边界的、以及你能手推出答案的。跑不过第三个就先别调。",
            ),
            choices=(
                StoryChoice(id="acm-impl-back", label="还是聊回那道题", next_node="acm"),
                StoryChoice(id="acm-impl-wrap", label="我去试试", next_node="wrap"),
            ),
            resume_text="还有别的想问的？",
        ),
        "debug": StoryNode(
            id="debug",
            lines=(
                "调 bug 啊。那你先回答我：它现在**实际**做了什么？",
                "不是「应该做什么」—— 是你亲眼看到的那一行输出。",
            ),
            choices=(
                StoryChoice(id="debug-read", label="我先把代码读一遍", next_node="debug_read"),
                StoryChoice(id="debug-log", label="我去加日志", next_node="debug_log"),
            ),
            resume_text="说回那个 bug —— 你看到的现象是什么？",
        ),
        "debug_read": StoryNode(
            id="debug_read",
            lines=(
                "读代码可以，但别从第一行读到最后一行，那样只会越来越困。",
                "从你确定「这里肯定是对的」的地方往里切，二分到那一小段为止。",
            ),
            choices=(
                StoryChoice(id="debug-read-back", label="继续说这个 bug", next_node="debug"),
                StoryChoice(id="debug-read-wrap", label="我去切一刀", next_node="wrap"),
            ),
            resume_text="还有别的想问的？",
        ),
        "debug_log": StoryNode(
            id="debug_log",
            lines=(
                "加日志是对的，但别一次加二十条 —— 那样你只是在读另一份代码。",
                "先加一条能区分两种假设的，一条就够。",
            ),
            choices=(
                StoryChoice(id="debug-log-back", label="继续说这个 bug", next_node="debug"),
                StoryChoice(id="debug-log-wrap", label="我去加一条", next_node="wrap"),
            ),
            resume_text="还有别的想问的？",
        ),
        "wrap": StoryNode(
            id="wrap",
            lines=(
                "行，那就先这样。这个据点你想自己逛就自己逛，我懒得带路。",
                "卡住了再回来 —— 不过下次记得带上下文，我不猜。",
                "（这段对话是本站写的同人剧情，不是游戏原文。）",
            ),
            ending=True,
        ),
    },
)

__all__ = ["STORY"]
