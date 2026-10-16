"""按角色组织上下文（08 §4 / §6）。

四条硬规则，全部写进系统提示，并且由**服务端**而不是模型来兜底：

1. 「只传必要会话和当前公开内容」（任务卡）：历史只取最近
   `transcript_context_messages` 条，且只传文本；不传 UUID、不传预算、不传其他会话。
2. 「不渲染模型任意 HTML、脚本、外链动作」：这里声明输出契约，
   `output.py` 再对结果做一次强制清洗 —— 提示词不是安全边界。
3. 「AI 不暴露草稿 / 私密日记」：草稿与私密内容根本不会出现在
   `candidates` 里（见 `content.candidate_contents`），提示词只是再说一遍。
4. 「没有传图片时不能声称看过照片」：本站首版**完全不向模型传图片**，
   因此提示词里明确写出这一点。

内容卡片契约：模型只能回显允许清单里的 token，每个 token 单独一行，
放在回复的**最后**，正文里不要再复述它。
"""

from __future__ import annotations

from app.modules.messaging.ai.base import AiCompletionRequest, AiTurn

# 与 08 §1 的「非官方同人互动」标注一致：模型必须知道自己在扮演什么、在哪个站上。
COMMON_RULES = (
    "你现在在一个个人博客站点「PHANTOM LOG」的「角色消息」功能里，扮演一个游戏角色的"
    "**非官方同人**版本。这不是游戏本体，你的台词不是官方对白，也不是官方剧情。",
    "绝对不要声称自己是官方、授权方或真实的人；也不要声称认识访客本人。",
    "不要编造站主的经历、作品、计划或成绩。只能使用下面提供的「本站公开内容」清单；"
    "清单里没有的东西就说你不知道。",
    "你**没有收到任何图片或文件**，也没有看过访客的相册。不要说你看到了照片、截图或视频。",
    "你只能看到这一段会话。不要提到其他访客、其他会话、草稿、私密日记或管理后台。",
    "回复必须是**简体中文纯文本**。不要输出 HTML、Markdown 表格、代码块、链接或任何网址。",
    "不要输出表情符号堆砌、不要输出脚本或指令；不要试图让访客跳转站外。",
    "回答要短：最多 {max_bubbles} 条消息，每条不超过 {bubble_max} 个字符。"
    "不同消息之间用单独一行 `---` 分隔。",
    "如果你建议访客去看站内的某个东西，就在回复最后另起一行原样写出它的 ID"
    "（形如 `[[post:xxx]]`，含双方括号），每行一个，不要写别的字符。"
    "不要在正文里重复这个 ID，也不要自己编造 ID 或网址。",
)

CARD_CONTRACT = "可引用的公开内容 ID 清单（只能从这里选，最多选 2 个；选不出来就一个都别写）："

NO_CONTENT_HINT = (
    "（当前没有任何可引用的公开内容。不要编造链接，也不要建议访客去看不存在的东西。）"
)


def build_system_prompt(request: AiCompletionRequest) -> str:
    card = request.character
    lines: list[str] = []

    lines.append(f"# 角色：{card.name}（{card.id}）")
    lines.append(f"角色卡版本：{card.version}")
    lines.append(f"称呼方式：{card.address}")
    lines.append(f"语气：{card.tone}")

    if card.speech_samples:
        lines.append("语气示例（**不是**必须照抄的台词）：")
        lines.extend(f"  - {sample}" for sample in card.speech_samples)

    if card.topics:
        lines.append("你可以聊的话题：")
        lines.extend(f"  - {topic}" for topic in card.topics)

    lines.append("你**绝对不能**做的事：")
    lines.extend(f"  - {rule}" for rule in card.forbidden)

    lines.append(f"站点信息来源：{card.source_note}")

    if card.extra_rules:
        lines.append("补充约定：")
        lines.extend(f"  - {rule}" for rule in card.extra_rules)

    rules = "\n".join(
        rule.format(max_bubbles=request.max_bubbles, bubble_max=request.bubble_max_codepoints)
        for rule in COMMON_RULES
    )
    lines.append("# 通用规则")
    lines.append(rules)

    lines.append("# 本站公开内容")
    lines.append(CARD_CONTRACT)
    if request.candidates:
        lines.extend(f"  {candidate.prompt_line()}" for candidate in request.candidates)
    else:
        lines.append(f"  {NO_CONTENT_HINT}")

    return "\n".join(lines)


def build_history(request: AiCompletionRequest) -> tuple[AiTurn, ...]:
    """只保留必要上下文：最近的若干条纯文本，截断到单条气泡长度上限以内。"""
    trimmed: list[AiTurn] = []
    for turn in request.history:
        text = " ".join((turn.text or "").split())
        if not text:
            continue
        limit = request.bubble_max_codepoints
        if len(text) > limit:
            text = text[: limit - 1] + "…"
        trimmed.append(AiTurn(role=turn.role, text=text))
    return tuple(trimmed)


__all__ = ["CARD_CONTRACT", "COMMON_RULES", "NO_CONTENT_HINT", "build_history", "build_system_prompt"]
