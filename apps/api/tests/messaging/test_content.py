"""公开内容读取与内容卡片（08 §3 / §6「公开内容读取」）。

验收要求：「私密日记 / 草稿 / 其他会话 → 不进入模型输入或内容卡片」。
这里逐条证明它**不是靠提示词**，而是靠「候选清单里根本没有那些东西」。

另外核对 `STATIC_LINKS`：白名单里的每个站内路径都必须真的存在对应页面，
否则剧本会给出一个指向 404 的卡片（08 §3「不能链接到空页面」）。
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from pathlib import Path

import pytest

from app.core.db import utcnow
from app.modules.messaging import content
from app.modules.messaging.stories.schema import ContentRef

REPO_ROOT = Path(__file__).resolve().parents[4]
WEB_APP_DIR = REPO_ROOT / "apps" / "web" / "app"


def _post(session, *, slug: str, title: str, excerpt: str, status: str, offset_hours: int = -1):
    from app.modules.posts.models import Post

    row = Post(
        slug=slug,
        title=title,
        excerpt=excerpt,
        content_md=f"{excerpt} 的正文",
        category="tech",
        status=status,
        published_at=utcnow() + timedelta(hours=offset_hours) if status == "published" else None,
    )
    session.add(row)
    session.flush()
    return row


def _author(session):
    """动态必须有作者（`moments.author_id` NOT NULL → admin_users）。

    这里直接建一个站主行，只用于满足外键；不涉及任何登录或权限。
    """
    from app.modules.auth.models import AdminUser

    row = AdminUser(
        username=f"t08-author-{uuid.uuid4().hex[:8]}",
        password_hash="not-a-real-hash",
    )
    session.add(row)
    session.flush()
    return row


def _moment(session, *, text: str, status: str, offset_hours: int = -1, author=None):
    from app.modules.moments.models import Moment

    row = Moment(
        author_id=(author or _author(session)).id,
        text=text,
        status=status,
        published_at=utcnow() + timedelta(hours=offset_hours) if status == "published" else None,
    )
    session.add(row)
    session.flush()
    return row


def test_recent_posts_only_returns_published_ones(t08_session):
    _post(t08_session, slug="public-one", title="公开文章", excerpt="摘要", status="published")
    _post(t08_session, slug="draft-one", title="草稿文章", excerpt="不该出现", status="draft")
    _post(
        t08_session,
        slug="future-one",
        title="未来文章",
        excerpt="也不该出现",
        status="published",
        offset_hours=+48,
    )

    cards = content.recent_posts(t08_session, 10)
    assert [card.id for card in cards] == ["public-one"]
    assert cards[0].url == "/posts/public-one"
    assert cards[0].summary == "摘要"


def test_recent_moments_only_returns_published_ones(t08_session):
    _moment(t08_session, text="公开动态", status="published")
    _moment(t08_session, text="草稿动态", status="draft")

    cards = content.recent_moments(t08_session, 10)
    assert len(cards) == 1
    assert cards[0].kind == "moment"
    assert cards[0].url.startswith("/apps/ins/")


def test_find_post_and_moment_respect_visibility(t08_session):
    _post(t08_session, slug="visible", title="可见", excerpt="x", status="published")
    _post(t08_session, slug="hidden", title="不可见", excerpt="x", status="draft")

    assert content.find_post(t08_session, "visible") is not None
    assert content.find_post(t08_session, "hidden") is None
    assert content.find_post(t08_session, "missing") is None

    from app.modules.moments.models import Moment

    visible = _moment(t08_session, text="可见动态", status="published")
    hidden = _moment(t08_session, text="隐藏动态", status="draft")
    assert content.find_moment(t08_session, str(visible.id)) is not None
    assert content.find_moment(t08_session, str(hidden.id)) is None
    assert content.find_moment(t08_session, "not-a-uuid") is None
    assert content.find_moment(t08_session, str(uuid.uuid4())) is None
    assert Moment is not None


def test_resolve_refs_drops_what_is_not_public_and_caps_the_count(t08_session):
    _post(t08_session, slug="public-one", title="公开文章", excerpt="摘要", status="published")
    _post(t08_session, slug="draft-one", title="草稿", excerpt="x", status="draft")
    _moment(t08_session, text="公开动态", status="published")

    refs = (
        ContentRef(kind="post", id="public-one", label="看这篇"),
        ContentRef(kind="post", id="draft-one", label="草稿不能出现"),
        ContentRef(kind="path", id="/about", label="关于"),
        ContentRef(kind="path", id="/admin", label="管理路径不在白名单"),
        ContentRef(kind="recent_moments", id="5", label="最新动态"),
        ContentRef(kind="unknown_kind", id="x", label="未知类型"),
    )
    cards = content.resolve_refs(t08_session, refs)
    ids = [card.id for card in cards]
    # 上限 2：草稿、白名单外的路径、未知 kind 都被丢弃
    assert ids == ["public-one", "/about"]
    assert all("draft-one" not in card.url for card in cards)


def test_resolve_refs_keeps_order_and_never_links_admin_paths(t08_session):
    refs = (
        ContentRef(kind="path", id="/apps/metanav", label="导航"),
        ContentRef(kind="path", id="/admin/moments", label="管理"),
    )
    cards = content.resolve_refs(t08_session, refs)
    assert [card.id for card in cards] == ["/apps/metanav"]
    assert all(not card.url.startswith("/admin") for card in cards)


def test_candidate_contents_only_contains_public_items(t08_session):
    _post(t08_session, slug="public-one", title="公开文章", excerpt="摘要", status="published")
    _post(t08_session, slug="draft-one", title="草稿标题泄露", excerpt="x", status="draft")
    _moment(t08_session, text="公开动态", status="published")
    _moment(t08_session, text="草稿动态泄露", status="draft")

    candidates = content.candidate_contents(t08_session, 12)
    rendered = "\n".join(candidate.prompt_line() + candidate.token for candidate in candidates)
    assert "公开文章" in rendered
    assert "公开动态" in rendered
    assert "泄露" not in rendered
    # 固定站内入口始终可用，保证「推荐」分支至少有一个真实去处
    assert any(candidate.token.startswith("[[path:") for candidate in candidates)


def test_extract_cards_from_model_output_ignores_unknown_ids(t08_session):
    _post(t08_session, slug="public-one", title="公开文章", excerpt="摘要", status="published")
    candidates = content.candidate_contents(t08_session, 12)
    allowed_token = next(
        candidate.token for candidate in candidates if candidate.token.startswith("[[post:")
    )
    text, cards = content.extract_cards(
        f"看看这个 {allowed_token} 还有 [[moment:{uuid.uuid4()}]] 和 [[path:/etc/passwd]]",
        candidates,
    )
    assert len(cards) == 1
    assert cards[0].url == "/posts/public-one"
    assert "passwd" not in text
    assert "[[" not in text


def _route_files_for(url: str) -> list[Path]:
    """把一个站内 URL 映射到**候选页面文件**。

    真实路径优先；某一层没有同名目录时，接受 `[param]` 动态段
    （Next.js 的 App Router 就是这么解析的）。
    """
    segments = [segment for segment in url.split("?")[0].strip("/").split("/") if segment]
    options: list[list[str]] = [[]]
    for index, segment in enumerate(segments):
        directory = WEB_APP_DIR.joinpath(*segments[:index])
        expanded: list[list[str]] = []
        for prefix in options:
            expanded.append([*prefix, segment])
            if directory.is_dir():
                for child in directory.iterdir():
                    if child.is_dir() and child.name.startswith("[") and child.name.endswith("]"):
                        expanded.append([*prefix, child.name])
        options = expanded
    return [WEB_APP_DIR.joinpath(*option) / "page.tsx" for option in options]


def test_every_resolvable_card_url_matches_a_real_route(t08_session):
    """卡片给出的 URL 必须真的有页面，不能指向空页面（08 §3）。"""
    if not WEB_APP_DIR.is_dir():  # pragma: no cover - 前端目录缺失时跳过
        pytest.skip("apps/web/app 不存在，无法核对站内路径")

    _post(t08_session, slug="public-one", title="公开文章", excerpt="摘要", status="published")
    _moment(t08_session, text="公开动态", status="published")

    urls = [link.path for link in content.STATIC_LINKS]
    urls += [card.url for card in content.recent_posts(t08_session, 3)]
    urls += [card.url for card in content.recent_moments(t08_session, 3)]
    assert len(urls) >= 4

    for url in urls:
        candidates = _route_files_for(url)
        assert any(path.is_file() for path in candidates), (
            f"卡片 URL {url} 在 apps/web/app 下没有对应页面；候选：{candidates}"
        )


def test_static_links_has_no_posts_index():
    """`/posts` 目前没有索引页，因此不能出现在白名单里（会 404）。"""
    assert "/posts" not in {link.path for link in content.STATIC_LINKS}


def test_static_links_contains_no_admin_paths():
    for link in content.STATIC_LINKS:
        assert not link.path.startswith("/admin")
        assert link.path.startswith("/")
        assert link.label and link.description
