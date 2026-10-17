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
    version="1.1.0",
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
                StoryChoice(id="works-rebuild", label="最近在改什么", next_node="rebuild"),
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
                StoryChoice(id="debug-log-a11y", label="顺便问验收的事", next_node="a11y"),
                StoryChoice(id="debug-log-wrap", label="我去加一条", next_node="wrap"),
            ),
            resume_text="还有别的想问的？",
        ),
        "rebuild": StoryNode(
            id="rebuild",
            lines=(
                "最近在给这个据点做视觉还原：手机里的应用、殿堂、手记、导航，一屏一屏对着设计稿改。",
                "改完还得跑验收 —— 截图、色值、触控目标、失败态，一样都不能糊弄。",
            ),
            choices=(
                StoryChoice(id="rebuild-a11y", label="验收都查什么", next_node="a11y"),
                StoryChoice(id="rebuild-works", label="看看改过的作品", next_node="works"),
                StoryChoice(id="rebuild-wrap", label="先不聊这个", next_node="wrap"),
            ),
            resume_text="刚说到视觉还原 —— 你还想听哪一段？",
            cards=(
                ContentRef(kind="path", id="/showcase", label="去我的殿堂看看"),
                ContentRef(kind="recent_posts", id="2", label="最近改版的长文"),
            ),
        ),
        "a11y": StoryNode(
            id="a11y",
            lines=(
                "验收先看能不能用：键盘能不能走完、焦点看不看得见、触控目标够不够大。",
                "再看是不是假的：接口挂掉时必须说「读不到」，不能假装「没有内容」。",
            ),
            choices=(
                StoryChoice(id="a11y-verify", label="怎么自动验证", next_node="verify"),
                StoryChoice(id="a11y-back", label="回到视觉还原", next_node="rebuild"),
                StoryChoice(id="a11y-wrap", label="够了", next_node="wrap"),
            ),
            resume_text="验收还有哪里想细问？",
            cards=(
                ContentRef(kind="path", id="/velvet", label="看看技术证据"),
                ContentRef(kind="path", id="/apps/metanav/mementos", label="印象空间里的事故记录"),
            ),
        ),
        "verify": StoryNode(
            id="verify",
            lines=(
                "用真浏览器跑：对比度算实际像素色、键盘 Tab 走一遍、失败态把接口打挂再访问。",
                "这些脚本都在仓库里，谁接手都能重跑 —— 证据要能复现，不是截图说说而已。",
            ),
            choices=(
                StoryChoice(id="verify-back", label="回到验收", next_node="a11y"),
                StoryChoice(id="verify-wrap", label="明白了", next_node="wrap"),
            ),
            resume_text="还想追问哪一步？",
            cards=(
                ContentRef(kind="recent_posts", id="1", label="读一篇相关长文"),
            ),
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
