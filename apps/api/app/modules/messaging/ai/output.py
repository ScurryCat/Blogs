"""输出校验（08 §7「只允许纯文本 / 受限消息结构与站内内容 ID」）。

**提示词不是安全边界**：这里对模型原始输出做强制清洗与切分，
所有供应商共用同一套规则，因此换模型不会换掉安全语义。

四件事，逐条有测试：
  1. `sanitize` 去标签、去 Markdown 链接、去裸露 URL、去控制字符；
  2. `split_bubbles` 切成 ≤ max_bubbles 条短气泡，每条 ≤ bubble_max_codepoints；
  3. `normalize_bubbles` 合并 / 丢弃空气泡；
  4. 全空 → `AiProviderError(invalid_output)`，让上层走**明确的降级**而不是
     发一条空气泡给访客。
"""

from __future__ import annotations

import re
import unicodedata

from app.modules.messaging.ai.base import AI_ERROR_INVALID_OUTPUT, AiProviderError

# 气泡之间模型应当使用的分隔符；也兼容空行。
BUBBLE_SEPARATOR = "---"

_HTML_TAG = re.compile(r"<[^<>]{0,400}>")
_MARKDOWN_LINK = re.compile(r"!?\[([^\]\n]{0,200})\]\((?:[^()\n]{0,400})\)")
_ANGLE_LINK = re.compile(r"<https?://[^>\s]{1,400}>")
_BARE_URL = re.compile(r"(?:https?://|www\.)[^\s<>（）()\[\]「」【】]{1,400}")
# 控制字符（保留换行与制表符，后面会折叠掉）。
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SENTENCE_END = re.compile(r"(?<=[。！？!?；;…])")
_CODE_FENCE = re.compile(r"```[a-zA-Z0-9_+-]{0,20}")


def sanitize(text: str) -> str:
    """把一段模型输出压成安全的纯文本（可以包含换行）。"""
    if not text:
        return ""
    cleaned = unicodedata.normalize("NFKC", text)
    cleaned = _CODE_FENCE.sub(" ", cleaned)
    cleaned = _ANGLE_LINK.sub(" ", cleaned)
    cleaned = _MARKDOWN_LINK.sub(r"\1", cleaned)
    cleaned = _HTML_TAG.sub(" ", cleaned)
    cleaned = _BARE_URL.sub(" ", cleaned)
    cleaned = _CONTROL.sub(" ", cleaned)
    # 折叠行内空白，保留换行结构（切气泡要用）。
    lines = [" ".join(line.split()) for line in cleaned.splitlines()]
    return "\n".join(lines).strip()


def _split_long(piece: str, limit: int) -> list[str]:
    """把超长的一段按句子边界切开；仍超长就硬切。"""
    if len(piece) <= limit:
        return [piece]
    chunks: list[str] = []
    current = ""
    for sentence in _SENTENCE_END.split(piece):
        if not sentence:
            continue
        if len(current) + len(sentence) <= limit:
            current += sentence
            continue
        if current:
            chunks.append(current)
            current = ""
        while len(sentence) > limit:
            chunks.append(sentence[:limit])
            sentence = sentence[limit:]
        current = sentence
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if chunk.strip()]


def split_bubbles(raw_text: str, *, max_bubbles: int, bubble_max_codepoints: int) -> list[str]:
    """把清理过的文本切成短气泡。

    切分优先级：显式分隔符 `---` → 空行 → 句子边界 → 硬切。
    最多返回 `max_bubbles` 条；超出部分被丢弃而不是合并成一条超长气泡
    ——「每次最多 3 个短消息气泡」是硬上限（08 §7）。
    """
    cleaned = sanitize(raw_text)
    if not cleaned:
        return []

    blocks: list[str] = []
    for chunk in re.split(rf"(?m)^\s*{re.escape(BUBBLE_SEPARATOR)}\s*$", cleaned):
        for paragraph in re.split(r"\n\s*\n", chunk):
            text = " ".join(paragraph.split())
            if text:
                blocks.append(text)

    bubbles: list[str] = []
    for block in blocks:
        for piece in _split_long(block, bubble_max_codepoints):
            bubbles.append(piece)
            if len(bubbles) >= max_bubbles:
                return bubbles
    return bubbles[:max_bubbles]


def normalize_bubbles(
    raw_text: str, *, max_bubbles: int, bubble_max_codepoints: int
) -> list[str]:
    """切分 + 去重相邻重复 + 空结果即失败。

    「相邻重复」是指模型把同一句话写了两遍；连续两条一样的短消息在 UI 上
    看起来像发送了两次，因此合并（不改变语义）。
    """
    bubbles = split_bubbles(
        raw_text, max_bubbles=max_bubbles, bubble_max_codepoints=bubble_max_codepoints
    )
    deduped: list[str] = []
    for bubble in bubbles:
        if deduped and deduped[-1] == bubble:
            continue
        deduped.append(bubble)
    if not deduped:
        raise AiProviderError(
            AI_ERROR_INVALID_OUTPUT,
            "模型没有返回可用的文本",
            detail=f"raw length={len(raw_text or '')}",
        )
    return deduped


__all__ = ["BUBBLE_SEPARATOR", "normalize_bubbles", "sanitize", "split_bubbles"]
