"""公开内容读取与内容卡片解析（08 §3 / §6「公开内容读取」）。

职责边界（08 §6 表格最后一行）：
  - 取当前**公开且允许推荐**的文章 / 动态摘要；
  - **不**取草稿、私密日记、管理员资料、其他人的会话。

两条硬规则：

1. **模型输出的是 token，不是链接。** 服务端把候选内容渲染成
   `[[post:slug]]` / `[[moment:uuid]]` / `[[path:/posts]]` 这样的允许清单交给模型；
   模型回复里只提取**同时出现在允许清单里**的 token，再按数据库的当前状态
   重新解析成标题、摘要与 URL。模型给的任何 URL / HTML 都不进响应、不入库。

2. **解析不到就丢弃。** 剧本里写死的引用同样走这条路径：文章被撤回、
   动态被删除之后就解析不出来，卡片直接消失，而不是留下一个指向空页面的链接。

`STATIC_LINKS` 是**白名单**：只有这里列出的站内路径才可能成为卡片。
`tests/messaging/test_content.py` 会核对每个路径在 `apps/web/app` 下真的存在对应页面。
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.messaging.stories.schema import ContentRef

# 单条消息最多展示的卡片数：多了会把气泡挤成列表，且和「短气泡」冲突（08 §5）。
MAX_CARDS_PER_MESSAGE = 2

# 摘要长度：卡片是入口而不是正文。
SUMMARY_MAX_CODEPOINTS = 80

TOKEN_PATTERN = re.compile(r"\[\[([a-z_]+):([^\[\]\s]{1,80})\]\]")


@dataclass(frozen=True)
class StaticLink:
    path: str
    label: str
    description: str


# 只有这些站内路径可以出现在卡片上。路径必须**真实存在**，由
# `tests/messaging/test_content.py::test_every_resolvable_card_url_matches_a_real_route`
# 逐个核对到 `apps/web/app` 下的页面文件。
#
# 注意：这里**没有** `/posts`。当前仓库里 `app/posts/` 只有 `[slug]`，没有索引页，
# 因此 `/posts` 会 404 —— 长文入口只通过 `recent_posts` 给出具体文章
# （`/posts/<slug>`），不给一个指向空页面的「列表」入口。
STATIC_LINKS: tuple[StaticLink, ...] = (
    StaticLink("/apps/ins", "图文动态", "本站自己的图文手记"),
    StaticLink("/apps/metanav", "异世界导航", "按关键词找专题"),
    StaticLink("/map", "地图", "从据点出发去各个地方"),
    StaticLink("/about", "关于", "这个站点是什么"),
)

_STATIC_BY_PATH = {link.path: link for link in STATIC_LINKS}


@dataclass(frozen=True)
class ResolvedCard:
    """一个**已经按当前公开状态验证过**的站内内容引用。

    字段与 `messages.cards` 的 JSONB 形状一致；`url` 由服务端生成，
    前端只用它 + `SiteLink` 渲染，不再自己拼路径（08 §3）。
    """

    kind: str
    id: str
    title: str
    summary: str
    url: str

    def as_payload(self) -> dict[str, str]:
        return {
            "kind": self.kind,
            "id": self.id,
            "title": self.title,
            "summary": self.summary,
            "url": self.url,
        }


def _excerpt(text: str, limit: int = SUMMARY_MAX_CODEPOINTS) -> str:
    """把正文压成一行摘要。**不**做任何 HTML 处理：前端按纯文本渲染。"""
    flattened = " ".join((text or "").split())
    if len(flattened) <= limit:
        return flattened
    return flattened[: limit - 1] + "…"


def post_card(slug: str, title: str, excerpt: str) -> ResolvedCard:
    return ResolvedCard(
        kind="post",
        id=slug,
        title=title.strip() or slug,
        summary=_excerpt(excerpt),
        url=f"/posts/{slug}",
    )


def moment_card(moment_id: uuid.UUID, text: str) -> ResolvedCard:
    return ResolvedCard(
        kind="moment",
        id=str(moment_id),
        title=_excerpt(text, 24) or "一条图文动态",
        summary=_excerpt(text),
        url=f"/apps/ins/{moment_id}",
    )


def path_card(link: StaticLink) -> ResolvedCard:
    return ResolvedCard(
        kind="path",
        id=link.path,
        title=link.label,
        summary=link.description,
        url=link.path,
    )


# --- 读取当前公开内容 ------------------------------------------------------


def recent_posts(session: Session, limit: int) -> list[ResolvedCard]:
    """最近发布的公开文章。只读 T01 的公开条件，不做第二套权限判断。"""
    if limit <= 0:
        return []
    from app.modules.posts import service as posts_service

    posts, _cursor = posts_service.list_public_posts(session, limit=min(limit, 30))
    return [post_card(post.slug, post.title, post.excerpt or post.content_md) for post in posts]


def recent_moments(session: Session, limit: int) -> list[ResolvedCard]:
    """最近发布的公开动态。"""
    if limit <= 0:
        return []
    from app.modules.moments import service as moments_service

    moments, _cursor = moments_service.list_public_moments(session, limit=min(limit, 30))
    return [moment_card(moment.id, moment.text) for moment in moments]


def find_post(session: Session, slug: str) -> ResolvedCard | None:
    """按 slug 取**公开**文章；草稿 / 撤回 / 未到时间 / 不存在都返回 None。"""
    from app.modules.posts import service as posts_service

    post = posts_service.get_public_post(session, slug)
    if post is None:
        return None
    return post_card(post.slug, post.title, post.excerpt or post.content_md)


def find_moment(session: Session, moment_id: str) -> ResolvedCard | None:
    """按 UUID 取**公开**动态；非 UUID 或不可见都返回 None。"""
    from app.modules.moments import service as moments_service

    try:
        parsed = uuid.UUID(moment_id)
    except (ValueError, AttributeError, TypeError):
        return None
    moment = moments_service.get_public_moment(session, parsed)
    if moment is None:
        return None
    return moment_card(moment.id, moment.text)


def resolve_refs(session: Session, refs: tuple[ContentRef, ...]) -> list[ResolvedCard]:
    """把剧本里的引用解析成卡片。解析不到的**静默丢弃**（不产生空链接）。"""
    cards: list[ResolvedCard] = []
    for ref in refs:
        resolved: list[ResolvedCard] = []
        kind = (ref.kind or "").strip()
        if kind == "post":
            single = find_post(session, ref.id)
            resolved = [single] if single else []
        elif kind == "moment":
            single = find_moment(session, ref.id)
            resolved = [single] if single else []
        elif kind == "recent_posts":
            resolved = recent_posts(session, _count(ref.id))
        elif kind == "recent_moments":
            resolved = recent_moments(session, _count(ref.id))
        elif kind == "path":
            link = _STATIC_BY_PATH.get(ref.id.strip())
            resolved = [path_card(link)] if link else []
        # 未知 kind：丢弃。剧本校验不拦这一项是有意的 —— 新 kind 只影响渲染，
        # 不应该让整本站点起不来；测试会断言所有在用 kind 都被覆盖。
        for card in resolved:
            if len(cards) >= MAX_CARDS_PER_MESSAGE:
                return cards
            cards.append(card)
    return cards


def _count(raw: str, *, default: int = 2) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(0, min(value, MAX_CARDS_PER_MESSAGE))


# --- 交给模型的允许清单 ----------------------------------------------------


@dataclass(frozen=True)
class CandidateContent:
    """一条候选公开内容：`token` 是模型唯一被允许回显的东西。"""

    token: str
    card: ResolvedCard

    def prompt_line(self) -> str:
        return f"{self.token} — {self.card.title}：{self.card.summary}"


def candidate_contents(session: Session, limit: int) -> list[CandidateContent]:
    """当前允许推荐的公开内容清单（文章 + 动态 + 固定站内入口）。

    只包含**公开**内容：草稿、私密日记、他人的会话在这里根本不出现，
    因此「AI 不暴露草稿 / 私密日记」不是靠提示词，而是靠这里没有它们。
    """
    candidates: list[CandidateContent] = []
    per_kind = max(0, limit // 2)
    for card in recent_posts(session, per_kind):
        candidates.append(CandidateContent(token=f"[[post:{card.id}]]", card=card))
    for card in recent_moments(session, per_kind):
        candidates.append(CandidateContent(token=f"[[moment:{card.id}]]", card=card))
    for link in STATIC_LINKS:
        card = path_card(link)
        candidates.append(CandidateContent(token=f"[[path:{card.id}]]", card=card))
    return candidates[: max(limit, len(STATIC_LINKS))]


def extract_cards(
    raw_output: str, candidates: list[CandidateContent]
) -> tuple[str, list[ResolvedCard]]:
    """从模型原始输出里提取**允许清单内**的 token，并返回 (清理后的文本, 卡片)。

    - 清理后的文本里 token 已被移除（前端拿到的正文里不会出现奇怪标记）；
    - 未在允许清单里的 token 一律忽略，且不影响正文；
    - 卡片按允许清单里的顺序去重，最多 `MAX_CARDS_PER_MESSAGE` 条。
    """
    allowed = {candidate.token: candidate.card for candidate in candidates}
    found: list[ResolvedCard] = []
    seen: set[str] = set()

    def _replace(match: re.Match[str]) -> str:
        token = match.group(0)
        card = allowed.get(token)
        if card is not None and card.id not in seen and len(found) < MAX_CARDS_PER_MESSAGE:
            seen.add(card.id)
            found.append(card)
        return " "

    cleaned = TOKEN_PATTERN.sub(_replace, raw_output or "")
    return " ".join(cleaned.split()), found


__all__ = [
    "MAX_CARDS_PER_MESSAGE",
    "STATIC_LINKS",
    "CandidateContent",
    "ResolvedCard",
    "StaticLink",
    "candidate_contents",
    "extract_cards",
    "find_moment",
    "find_post",
    "moment_card",
    "path_card",
    "post_card",
    "recent_moments",
    "recent_posts",
    "resolve_refs",
]
