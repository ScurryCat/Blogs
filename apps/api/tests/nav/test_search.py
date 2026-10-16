"""普通搜索：字段、排序、游标、转义与草稿隔离（04 §6、05 §6）。

搜索与「认知定位」是两条独立路径：搜索是模糊查找（多词全部命中），定位是确定性匹配。
排名规则统一在 API 里实现（手机与独立页面不能各算一套）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from tests.nav.helpers import (
    assert_error,
    make_palace,
    make_published_palace,
    unique_keyword,
    unique_slug,
)
from tests.posts.helpers import make_draft, make_post

UTC = timezone.utc

ITEM_KEYS = {"kind", "id", "slug", "title", "excerpt", "href"}


def search(client, **params):
    return client.get("/api/v1/nav/search", params=params)


def slugs(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["slug"] for item in response.json()["items"]]


def test_search_finds_public_post_by_title_and_returns_server_side_href(public_client, t04_session: Session):
    post = make_post(t04_session, title="用纯 CSS 复刻斜切菜单", slug=unique_slug("post"))
    response = search(public_client, q="斜切菜单")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"items", "next_cursor"}
    item = payload["items"][0]
    assert set(item) == ITEM_KEYS
    assert item["kind"] == "post"
    assert item["slug"] == post.slug
    assert item["href"] == f"/posts/{post.slug}"
    assert item["title"] == post.title


def test_search_finds_palace_by_title_summary_alias_and_derived_tag(public_client, t04_session: Session):
    post = make_post(t04_session, title="公开文章", tags=(unique_keyword("派生素材"),))
    palace = make_published_palace(
        t04_session,
        posts=(post,),
        title="怪盗据点工程",
        summary="把博客改造成怪盗的基地",
        aliases=(("name", "PHANTOM"),),
    )
    # 标题 / 摘要 / 别名 / 派生标签四条路径都能找到同一座殿堂。
    for q in ["怪盗据点", "怪盗的基地", "PHANTOM", "派生素材"]:
        found = slugs(search(public_client, q=q, kind="palace"))
        assert palace.slug in found, (q, found)
    href = search(public_client, q="怪盗据点", kind="palace").json()["items"][0]["href"]
    assert href == f"/apps/metanav/palaces/{palace.slug}"


def test_draft_and_deleted_content_is_never_searchable(public_client, t04_session: Session):
    """首版不检索草稿：草稿文章、草稿殿堂、只有草稿文章的殿堂都搜不到（验收 4）。"""
    public_post = make_post(t04_session, title="公开文章")
    draft_tag = unique_keyword("草稿标签")
    draft_post = make_draft(t04_session, title="草稿专用标题", tags=(draft_tag,))
    draft_palace = make_palace(
        t04_session, posts=(public_post,), title="草稿殿堂标题", aliases=(("name", "DRAFTALIAS"),)
    )
    palace_with_draft_only = make_published_palace(
        t04_session, posts=(draft_post,), title="只有草稿文章的殿堂"
    )
    deleted_palace = make_published_palace(
        t04_session, posts=(public_post,), title="已删除殿堂标题", deleted_at=datetime.now(UTC)
    )

    for q in ("草稿专用标题", "草稿殿堂标题", "DRAFTALIAS", "已删除殿堂标题"):
        assert search(public_client, q=q).json()["items"] == [], q
    assert search(public_client, q=draft_tag).json()["items"] == []
    assert palace_with_draft_only.slug not in slugs(search(public_client, q="只有草稿文章的殿堂"))
    # 公开文章本身仍在：不是「整个搜索坏了」，而是草稿确实不出现。
    assert public_post.slug in slugs(search(public_client, q="公开文章"))


def test_palace_derived_tags_come_from_public_posts_only(public_client, t04_session: Session):
    """标签筛选：殿堂的标签只由**公开**文章派生，草稿文章的标签不算（05 §6）。"""
    draft_only_tag = unique_keyword("仅草稿标签")
    public_tag = unique_keyword("公开标签")
    draft_post = make_draft(t04_session, tags=(draft_only_tag,))
    public_post = make_post(t04_session, tags=(public_tag,))
    palace = make_published_palace(t04_session, posts=(public_post, draft_post), title="混合殿堂")

    # 只挂在草稿文章上的标签不会让殿堂出现在筛选结果里。
    assert slugs(search(public_client, q="混合", tag=draft_only_tag)) == []
    assert palace.slug in slugs(search(public_client, q="混合", tag=public_tag))


def test_ranking_title_exact_then_title_then_tag_then_excerpt(public_client, t04_session: Session):
    """标题完全匹配 → 标题 / 别名命中 → 标签命中 → 摘要命中；同档按时间倒序。"""
    word = unique_keyword("排序词")
    moment = datetime.now(UTC)
    exact = make_post(t04_session, title=word, published_at=moment - timedelta(days=4))
    in_title = make_post(t04_session, title=f"关于{word}的做法", published_at=moment - timedelta(days=3))
    in_tag = make_post(
        t04_session,
        title="只有标签命中的文章",
        tags=(word,),
        published_at=moment - timedelta(days=2),
    )
    in_excerpt = make_post(
        t04_session, title="只有摘要命中的文章", excerpt=f"这里提到{word}", published_at=moment - timedelta(days=1)
    )

    found = slugs(search(public_client, q=word))
    assert found == [exact.slug, in_title.slug, in_tag.slug, in_excerpt.slug], found


def test_ranking_is_stable_within_the_same_tier(public_client, t04_session: Session):
    """同档按 `published_at DESC, id DESC`：同时间戳也不会漏项或顺序漂移。"""
    word = unique_keyword("同档词")
    moment = datetime.now(UTC) - timedelta(hours=2)
    posts = [make_post(t04_session, title=f"{word} 第 {index} 篇", published_at=moment) for index in range(4)]
    expected = [post.slug for post in sorted(posts, key=lambda item: item.id, reverse=True)]
    assert slugs(search(public_client, q=word)) == expected


def test_multi_word_query_requires_every_word(public_client, t04_session: Session):
    both = make_post(t04_session, title="前端无障碍清单")
    only_first = make_post(t04_session, title="前端工程笔记")
    only_second = make_post(t04_session, title="无障碍入门")

    found = slugs(search(public_client, q="前端 无障碍"))
    assert found == [both.slug]
    assert only_first.slug not in found and only_second.slug not in found

    # 中文词组作为子串处理，不声称有完善的中文分词（04 §6）。
    assert slugs(search(public_client, q="前端无障")) == [both.slug]


def test_full_width_and_case_input_is_normalized(public_client, t04_session: Session):
    post = make_post(t04_session, title="P5R Platinum Notes")
    assert slugs(search(public_client, q="ｐ５ｒ")) == [post.slug]
    assert slugs(search(public_client, q="  platinum  ")) == [post.slug]


def test_like_wildcards_are_escaped(public_client, t04_session: Session):
    """`%` / `_` 按普通输入处理，不让用户输入变成通配查询（05 §6 末）。"""
    literal_percent = make_post(t04_session, title="折扣 100% 记录")
    literal_underscore = make_post(t04_session, title="字段 snake_case 说明")
    plain = make_post(t04_session, title="普通文章标题")

    # "%" 只匹配真的含百分号的那篇，而不是全部文章。
    assert slugs(search(public_client, q="100%")) == [literal_percent.slug]
    assert slugs(search(public_client, q="%")) == [literal_percent.slug]
    # "_" 不匹配任意单字符：`snake_case` 命中，`snakeXcase` 不存在也不该模糊命中。
    assert slugs(search(public_client, q="snake_case")) == [literal_underscore.slug]
    assert slugs(search(public_client, q="snake_case_")) == []
    assert plain.slug not in slugs(search(public_client, q="%"))


def test_kind_and_tag_filters(public_client, t04_session: Session):
    word = unique_keyword("筛选词")
    tag = unique_keyword("筛选标签")
    post = make_post(t04_session, title=f"{word} 文章", tags=(tag,))
    palace = make_published_palace(t04_session, posts=(post,), title=f"{word} 殿堂")
    other = make_post(t04_session, title=f"{word} 无标签文章")

    assert set(slugs(search(public_client, q=word, kind="post"))) == {post.slug, other.slug}
    assert slugs(search(public_client, q=word, kind="palace")) == [palace.slug]
    assert set(slugs(search(public_client, q=word, tag=tag))) == {post.slug, palace.slug}


def test_search_pagination_is_stable_across_pages(public_client, t04_session: Session):
    """跨页不漏不重：排序键是四元组 (rank, published_at, id, kind)。"""
    word = unique_keyword("分页词")
    moment = datetime.now(UTC) - timedelta(minutes=30)
    posts = [make_post(t04_session, title=f"{word} 第 {index} 篇", published_at=moment) for index in range(5)]

    collected: list[str] = []
    cursor = None
    for _ in range(6):
        params = {"q": word, "limit": 2}
        if cursor:
            params["cursor"] = cursor
        payload = search(public_client, **params).json()
        collected.extend(item["slug"] for item in payload["items"])
        cursor = payload["next_cursor"]
        if cursor is None:
            break
    assert cursor is None
    assert len(collected) == 5 == len(set(collected))
    expected = [post.slug for post in sorted(posts, key=lambda item: item.id, reverse=True)]
    assert collected == expected


def test_cursor_is_bound_to_the_current_filters(public_client, t04_session: Session):
    """跨页切换筛选会校验指纹：旧游标 400，而不是悄悄给出错误的一页（验收 4）。"""
    word = unique_keyword("指纹词")
    for index in range(4):
        make_post(t04_session, title=f"{word} 第 {index} 篇")
    limit_one = search(public_client, q=word, limit=1).json()
    cursor = limit_one["next_cursor"]
    assert cursor

    # 换 q / 换 kind / 换 tag / 换大小写形态（fingerprint 用规范形态）都要分开判定。
    for params in (
        {"q": f"{word} 第", "limit": 1, "cursor": cursor},
        {"q": word, "kind": "palace", "limit": 1, "cursor": cursor},
        {"q": word, "tag": unique_keyword("别的标签"), "limit": 1, "cursor": cursor},
    ):
        assert_error(search(public_client, **params), status=400, code="VALIDATION_FAILED")

    # 同一个筛选继续翻页是允许的。
    assert search(public_client, q=word, limit=1, cursor=cursor).status_code == 200


def test_invalid_cursor_and_query_validation(public_client, t04_session: Session):
    assert_error(search(public_client, q="x", cursor="!!!not-base64!!!"), status=400, code="VALIDATION_FAILED")
    assert_error(search(public_client, q="   "), status=422, code="UNPROCESSABLE")
    assert_error(search(public_client, q="x" * 81), status=422, code="UNPROCESSABLE")
    assert_error(search(public_client, q="x", kind="moment"), status=422, code="UNPROCESSABLE")
    assert_error(search(public_client, q="x", limit=31), status=422, code="UNPROCESSABLE")


def test_retracted_content_disappears_from_search(public_client, t04_session: Session):
    word = unique_keyword("撤回词")
    post = make_post(t04_session, title=f"{word} 文章")
    palace = make_published_palace(t04_session, posts=(post,), title=f"{word} 殿堂")
    assert set(slugs(search(public_client, q=word))) == {post.slug, palace.slug}

    post.status = "draft"
    t04_session.commit()
    assert slugs(search(public_client, q=word)) == []


def test_tag_used_only_by_deleted_palace_does_not_leak(public_client, t04_session: Session):
    """标签筛选不会因为「某座殿堂被删除」而暴露它的私有标签集合。"""
    tag = unique_keyword("删除标签")
    post = make_post(t04_session, title="另一篇文章", tags=(tag,))
    palace = make_published_palace(t04_session, posts=(post,), title="将被删除的殿堂")
    assert palace.slug in slugs(search(public_client, q="将被删除", tag=tag))

    palace.deleted_at = datetime.now(UTC)
    t04_session.commit()
    assert slugs(search(public_client, q="将被删除", tag=tag)) == []
    # 文章本身仍然公开：与殿堂的撤回状态无关。
    assert post.slug in slugs(search(public_client, q="另一篇文章", tag=tag))
