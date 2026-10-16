"""文本规范化（05 §6「NFKC + trim + 不区分大小写」）。

同一套规则给标签 slug、后续导航关键词与搜索复用，避免每个模块各写一份
「看起来差不多」的规范化，最后匹配不上。
"""

from __future__ import annotations

import unicodedata

# 文本长度统一按 Unicode 码点计数（05 §2），不用字节长度。
EMPTY = ""


def normalize_for_match(value: str) -> str:
    """NFKC + 去首尾空白 + 大小写折叠 + 内部空白折叠成单个空格。"""
    if not value:
        return EMPTY
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    return " ".join(normalized.split())


def normalize_tag_slug(name: str) -> str:
    """标签的规范化 slug：在 normalize_for_match 基础上把空白换成 `-`。

    中文标签会原样保留（无需强行拼音化）；空字符串视为非法，由调用方校验。
    """
    return normalize_for_match(name).replace(" ", "-")


def codepoint_length(value: str) -> int:
    return len(value)
