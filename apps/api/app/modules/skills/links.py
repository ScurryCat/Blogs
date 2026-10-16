"""站外链接的校验与归一化（技能与问题记录共用）。

为什么需要一个独立文件：07 §6 的技能「证据」与 07 §6 的问题记录「结果 / 验证链接」
是同一件事的两种出现——**反复出现的真实证据链接**。两处各写一份 `urlsplit` 判断，
早晚会一份允许 `javascript:` 而另一份不允许。这个模块是本包内的唯一实现，
`app/modules/exploration/` 直接复用它（同属 T09，不跨所有权边界）。

规则（与 T06 `projects.schemas.normalize_link_url` 同形）：

  - 只接受 `http` / `https`；
  - 必须有主机名；
  - 按码点限制长度（05 §2）；
  - **不**接受 `javascript:` / `data:` / `file:` / 本机绝对路径
    （SHARED-CONTRACTS §1「不新增任意 HTML / 脚本执行」、验收 §1
    「不新增绝对本机素材路径」）。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from urllib.parse import urlsplit

from app.modules.skills.models import LINK_LABEL_MAX_LENGTH, LINK_URL_MAX_LENGTH

LINK_KINDS = ("repo", "demo", "docs", "proof", "other")

LINK_KIND_LABELS = {
    "repo": "仓库",
    "demo": "演示",
    "docs": "文档",
    "proof": "验证",
    "other": "链接",
}


def normalize_link_url(raw: str) -> str:
    """校验并归一化一个站外链接。不接受非 http(s) 与非绝对地址。"""
    candidate = (raw or "").strip()
    if not candidate:
        raise ValueError("链接不能为空")
    if len(candidate) > LINK_URL_MAX_LENGTH:
        raise ValueError(f"链接最长 {LINK_URL_MAX_LENGTH} 个字符")
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https"):
        raise ValueError("链接必须是以 http:// 或 https:// 开头的站外地址")
    if not parts.netloc:
        raise ValueError("链接缺少主机名")
    return candidate


def normalize_link(label: str, url: str, kind: str = "other") -> dict[str, str]:
    """一条链接 → `{kind, label, url}`。label 只去空白，不替站主改写。"""
    text = (label or "").strip()
    if not text:
        raise ValueError("链接文字不能只有空白")
    if len(text) > LINK_LABEL_MAX_LENGTH:
        raise ValueError(f"链接文字最长 {LINK_LABEL_MAX_LENGTH} 个字符")
    resolved_kind = kind if kind in LINK_KINDS else "other"
    return {"kind": resolved_kind, "label": text, "url": normalize_link_url(url)}


def normalize_links(raw_links: Iterable[Mapping[str, object]] | None) -> list[dict[str, str]]:
    """完整替换用的归一化：去重（按 kind + url），保持传入顺序。"""
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_links or []:
        entry = normalize_link(
            str(raw.get("label", "")),
            str(raw.get("url", "")),
            str(raw.get("kind", "other")),
        )
        key = (entry["kind"], entry["url"])
        if key in seen:
            continue
        seen.add(key)
        normalized.append(entry)
    return normalized


__all__ = [
    "LINK_KIND_LABELS",
    "LINK_KINDS",
    "normalize_link",
    "normalize_link_url",
    "normalize_links",
]
