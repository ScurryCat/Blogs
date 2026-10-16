"""本地模拟服务（**默认供应商**；不联网、不计费、输出可复现）。

它是什么、不是什么 —— 这一段必须被诚实对待（08 §1、任务卡「不得用 mock 回复
宣称混合聊天全部完成」）：

  - 它**不是**语言模型。它是关键词 → 角色语气模板的确定性映射，
    用来在没有供应商配置的情况下把「自由输入 → 回复 → 回到剧情」这条**链路**
    以及降级、预算、幂等、内容卡片全部跑通；
  - 它**没有**推理能力，也不会真的理解访客输入。界面上的 AI 标记与
    `/api/v1/messaging/status` 都会如实说明当前用的是模拟服务；
  - 它**不会**声称看过图片、不会编造站主履历、不会输出链接：
    内容建议只回显服务端允许清单里的 token（与真实供应商同一条校验路径）。

可复现性：分支由关键词决定，措辞变体由 `sha256(角色 + 归一化输入)` 决定，
**不用** Python 的 `hash()`（它每个进程都加盐，会让同一输入跨进程不同结果，
测试也就失去意义）。
"""

from __future__ import annotations

import asyncio
import hashlib
from typing import Literal

from app.core.text import normalize_for_match
from app.modules.messaging.ai.base import (
    AI_ERROR_UPSTREAM,
    AiCompletionRequest,
    AiCompletionResult,
    AiProviderError,
)

PROVIDER_NAME = "simulator"

PROVIDER_NOTE = "本地模拟服务：不是语言模型，只用于验证链路与降级（不联网、不计费）"

FailureMode = Literal["none", "timeout", "error"]

# 关键词分支。顺序即优先级：越具体的越靠前。
_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("thanks", ("谢谢", "感谢", "谢了", "thanks", "thank you", "多谢")),
    ("farewell", ("再见", "拜拜", "走了", "下线", "bye", "goodbye", "回头聊")),
    ("greeting", ("你好", "在吗", "嗨", "哈喽", "hello", "hi", "早", "晚上好", "初次见面")),
    (
        "debug",
        ("bug", "报错", "调试", "崩溃", "异常", "日志", "复现", "栈", "error", "traceback"),
    ),
    (
        "algorithm",
        ("算法", "题", "acm", "复杂度", "超时", "动态规划", "图论", "贪心", "二分", "数据结构"),
    ),
    (
        "project",
        ("项目", "代码", "重构", "性能", "架构", "工程", "部署", "接口", "测试", "写代码"),
    ),
    (
        "recommend",
        ("推荐", "看什么", "有什么", "文章", "动态", "作品", "逛逛", "最近", "看点", "入口"),
    ),
    (
        "about_site",
        ("这个站", "网站", "博客", "据点", "你是谁", "这里是什么", "关于"),
    ),
)

# 每个分支每种角色两条变体。全部是**本站原创**，不是游戏原文。
_LINES: dict[str, dict[str, tuple[str, ...]]] = {
    "thanks": {
        "futaba": ("……谢什么，我又没帮你写。", "行了行了，别客气，怪别扭的。"),
        "morgana": ("嘿嘿，知道本大爷厉害了吧！", "不用谢，带新人本来就是我该做的。"),
    },
    "farewell": {
        "futaba": ("嗯，去吧。卡住了再回来。", "走了就走了，别在门口站着。"),
        "morgana": ("去吧去吧，记得回来汇报！", "下次来直接找我，别乱逛。"),
    },
    "greeting": {
        "futaba": ("哦，来了。有事说事。", "嗯，你好。……然后呢？"),
        "morgana": ("哟！又来一个！", "你好你好，第一次来这儿吧？"),
    },
    "debug": {
        "futaba": (
            "调 bug 先别改代码 —— 你现在**实际**看到的现象是什么？不是你以为的原因。",
            "报错信息整条给我看。你只念半句，我只能猜，猜出来的东西没用。",
        ),
        "morgana": (
            "出错啦？别慌，先看它到底停在哪一步。",
            "唔……本大爷建议你先把复现步骤写下来，写不出来的通常就是没搞清楚。",
        ),
    },
    "algorithm": {
        "futaba": (
            "先分清卡在哪一层：读不懂题、想不出思路、还是写出来不对。这三件事的解法完全不一样。",
            "想不出思路就先写暴力解。知道暴力慢在哪，才知道该优化什么。",
        ),
        "morgana": (
            "算法题啊……本大爷更擅长带路，不过先缩到最小规模手算一遍总没错。",
            "先造三个用例吧：最小的、卡边界的、你能手推出答案的。",
        ),
    },
    "project": {
        "futaba": (
            "先看它现在怎么跑，再决定动哪儿。上来就重构的，最后都在救火。",
            "把改动切小一点。一次改一处，坏了你才知道是哪一处。",
        ),
        "morgana": (
            "项目的事我不太懂啦，不过一步步来总比一次全改强。",
            "先跑通再谈优雅，本大爷的经验之谈！",
        ),
    },
    "recommend": {
        "futaba": (
            "公开的东西就那些，我给你挑一个。没发布的我也看不到，别问我。",
            "喏，这个还行。看不看得下去是你的事。",
        ),
        "morgana": (
            "想看东西？跟着本大爷走，先给你指一个。",
            "这儿有个还不错的，先从它开始吧。",
        ),
    },
    "about_site": {
        "futaba": (
            "就是站主自己搭的据点。图文、长文、导航，都是他一个人弄的。",
            "这儿不是社交平台 —— 没有关注、没有陌生人私信，也没有点赞数。",
        ),
        "morgana": (
            "这是站主的据点！图文动态随手记，长文在文章区，找专题用异世界导航。",
            "别看它花里胡哨，其实就几个地方：动态、文章、导航、地图。",
        ),
    },
    "fallback": {
        "futaba": (
            "嗯……然后呢？你这句信息量太少了，我没法接。",
            "说具体点。你想问的是什么？",
        ),
        "morgana": (
            "唔？本大爷没太听明白，你再说清楚点？",
            "这话题有点跳啊……你是想问路，还是想聊天？",
        ),
    },
}

# 需要附上内容建议的分支。
_CARD_BRANCHES = ("recommend",)


def classify(text: str) -> str:
    """把访客输入归到一个分支。纯函数，可单测。"""
    normalized = normalize_for_match(text)
    if not normalized:
        return "fallback"
    for branch, keywords in _KEYWORDS:
        for keyword in keywords:
            if keyword in normalized:
                return branch
    return "fallback"


def _variant_index(character_id: str, user_text: str, count: int) -> int:
    """确定性变体选择。用 sha256 而不是内置 `hash()`（后者逐进程加盐）。"""
    if count <= 0:
        return 0
    seed = f"{character_id}\x00{normalize_for_match(user_text)}".encode("utf-8")
    return hashlib.sha256(seed).digest()[0] % count


def draft_reply(character_id: str, user_text: str) -> str:
    """生成一次模拟回复的原始文本（含 `---` 分隔符）。

    内容 ID **不在这里**生成：它由 `_pick_token` 从服务端的允许清单里挑，
    走的正是真实供应商那条「只回显允许清单里的 token」的路径。
    """
    branch = classify(user_text)
    table = _LINES.get(branch) or _LINES["fallback"]
    variants = table.get(character_id) or table["futaba"]
    primary = variants[_variant_index(character_id, user_text, len(variants))]

    lines = [primary]
    # 第二个气泡：偶尔补一句追问，让「最多 3 条短气泡」这条规则真的被用到。
    if branch in ("debug", "algorithm", "project") and len(user_text) > 8:
        follow_ups = {
            "futaba": "把你手上最小能跑的那份贴出来，我看看它第一步做了什么。",
            "morgana": "你要是说不清楚，就先从「你想让它做什么」开始讲。",
        }
        lines.append(follow_ups.get(character_id, follow_ups["futaba"]))

    return "\n---\n".join(lines)


class SimulatorProvider:
    """`AiProvider` 的模拟实现。构造参数只影响延迟与故障注入。"""

    name = PROVIDER_NAME

    def __init__(
        self,
        *,
        latency_seconds: float = 0.0,
        failure_mode: FailureMode = "none",
    ) -> None:
        self.latency_seconds = max(0.0, latency_seconds)
        self.failure_mode = failure_mode

    async def complete(self, request: AiCompletionRequest) -> AiCompletionResult:
        if self.failure_mode == "timeout":
            # 故意睡过**服务层**的截止时间：让 `service` 里的 `asyncio.wait_for`
            # 真的触发并取消这次调用，而不是伪造一个 timeout 异常
            # （伪造异常测不到「截止时间由服务掌握」这件事本身）。
            await asyncio.sleep(request.timeout_seconds * 3 + 0.5)
        elif self.latency_seconds:
            await asyncio.sleep(self.latency_seconds)

        if self.failure_mode == "error":
            raise AiProviderError(
                AI_ERROR_UPSTREAM,
                "模拟上游返回了错误",
                detail="simulator_failure_mode=error",
            )

        body = draft_reply(request.character.id, request.user_text)
        token = self._pick_token(request, body)
        raw = f"{body}\n{token}" if token else body

        return AiCompletionResult(
            raw_text=raw,
            provider=self.name,
            model=None,
            attempts=1,
            notes=(PROVIDER_NOTE,),
        )

    @staticmethod
    def _pick_token(request: AiCompletionRequest, body: str) -> str:
        """只有「推荐」分支才附一个允许清单里的 token。"""
        if classify(request.user_text) not in _CARD_BRANCHES:
            return ""
        if not request.candidates:
            return ""
        index = _variant_index(request.character.id, request.user_text, len(request.candidates))
        return request.candidates[index].token


__all__ = [
    "PROVIDER_NAME",
    "PROVIDER_NOTE",
    "FailureMode",
    "SimulatorProvider",
    "classify",
    "draft_reply",
]
