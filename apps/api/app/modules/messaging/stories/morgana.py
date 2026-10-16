"""摩尔加纳的一段完整预设剧情（原创同人，不是游戏原文；08 §4）。

主题：新访客引导、「今天看什么」、探索专题与导航用法 —— 与站点的结合点是
**已发布**的图文 / 文章与真实的站内路径。凡是解析不到的引用一律丢弃，
因此不会出现「点了发现是空页面」的卡片（08 §3）。
"""

from __future__ import annotations

from app.modules.messaging.stories.schema import (
    ContentRef,
    StoryChoice,
    StoryDefinition,
    StoryNode,
)

STORY = StoryDefinition(
    id="morgana-first-visit",
    version="1.0.0",
    character_id="morgana",
    start_node="intro",
    nodes={
        "intro": StoryNode(
            id="intro",
            lines=(
                "哟，新面孔！第一次来这个据点吧？",
                "别乱走，跟着我 —— 先说你想看点轻松的，还是想钻进去看长的？",
            ),
            choices=(
                StoryChoice(id="what-to-see", label="今天看什么", next_node="tour"),
                StoryChoice(id="how-to-navigate", label="导航怎么用", next_node="navigate"),
                StoryChoice(id="where-am-i", label="这地方是什么", next_node="map"),
            ),
            resume_text="回来啦？那咱们接着刚才的说。",
        ),
        "tour": StoryNode(
            id="tour",
            lines=(
                "轻松的就是图文动态，一张图一句话，站主随手记的那种。",
                "想看长的就进文章 —— 我手上只有已经公开的，没发布的我也变不出来。",
            ),
            choices=(
                StoryChoice(id="tour-long", label="那看长的", next_node="longform"),
                StoryChoice(id="tour-deep", label="还有别的入口吗", next_node="navigate"),
                StoryChoice(id="tour-wrap", label="够了，我自己逛", next_node="wrap"),
            ),
            resume_text="所以呢，你今天到底想看哪种？",
            cards=(
                ContentRef(kind="recent_moments", id="2", label="看看最近的图文"),
                ContentRef(kind="recent_posts", id="1", label="挑一篇长文"),
            ),
        ),
        "longform": StoryNode(
            id="longform",
            lines=(
                "长文都在文章区。标题下面有摘要，先扫一眼再决定点不点。",
                "我挑不出最好的一篇 —— 那是你自己该判断的事。",
            ),
            choices=(
                StoryChoice(id="longform-back", label="回到刚才的话题", next_node="tour"),
                StoryChoice(id="longform-wrap", label="我去读", next_node="wrap"),
            ),
            resume_text="看完想聊什么？",
            cards=(
                ContentRef(kind="recent_posts", id="3", label="最近的长文"),
            ),
        ),
        "navigate": StoryNode(
            id="navigate",
            lines=(
                "异世界导航是给专题用的：你给一个关键词，它去匹配已经公开的内容。",
                "匹配不到就是匹配不到，它不会为了好看硬凑一个给你。",
            ),
            choices=(
                StoryChoice(id="navigate-phone", label="手机上怎么用", next_node="phone"),
                StoryChoice(id="navigate-back", label="回到刚才的话题", next_node="tour"),
            ),
            resume_text="导航还有哪里没讲清楚？",
            cards=(
                ContentRef(kind="path", id="/apps/metanav", label="打开异世界导航"),
            ),
        ),
        "phone": StoryNode(
            id="phone",
            lines=(
                "手机上从据点进导航，进去以后用手机自己的返回，别用浏览器的 —— 那样音乐会被打断。",
                "想回据点就关掉手机，位置和音乐都还在。",
            ),
            choices=(
                StoryChoice(id="phone-back", label="再说说导航", next_node="navigate"),
                StoryChoice(id="phone-wrap", label="明白了", next_node="wrap"),
            ),
            resume_text="手机上还有别的问题吗？",
        ),
        "map": StoryNode(
            id="map",
            lines=(
                "这儿是站主自己的据点，不是别人的社交账号 —— 没有关注、没有私信陌生人。",
                "地图页上能直接出发去各个地方，走的时候人群会动一下，别被吓到。",
            ),
            choices=(
                StoryChoice(id="map-nav", label="那导航呢", next_node="navigate"),
                StoryChoice(id="map-wrap", label="知道了", next_node="wrap"),
            ),
            resume_text="还想问据点里的什么？",
            cards=(
                ContentRef(kind="path", id="/map", label="打开地图"),
            ),
        ),
        "wrap": StoryNode(
            id="wrap",
            lines=(
                "行，那就先这样。记住：找不到路就回来问我，别硬猜。",
                "对了 —— 我这些台词是本站写的同人，不是游戏里的原话，别当真。",
            ),
            ending=True,
        ),
    },
)

__all__ = ["STORY"]
