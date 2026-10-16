"""认知定位：三关键词的**确定性**匹配（04 §4B / §6、05 §6）。

对应验收用例 2（标准值 / 别名 / 全角 / 多匹配都给正确结果）与「未找到与服务故障有不同反馈」。
匹配不允许任何模型推断：规则就是 NFKC + trim + 大小写折叠 + 空白折叠，然后三字段求交集。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.nav import ratelimit
from app.modules.nav.models import Palace, PalaceAlias, PalacePost
from tests.nav.helpers import (
    assert_error,
    make_palace,
    make_published_palace,
    unique_keyword,
    unique_slug,
)
from tests.posts.helpers import make_draft, make_post

UTC = timezone.utc


def resolve(client, name: str, location: str, cognition: str):
    return client.post(
        "/api/v1/nav/resolve",
        json={"name": name, "location": location, "cognition": cognition},
    )


def test_standard_values_are_found(public_client, t04_session: Session):
    post = make_post(t04_session)
    palace = make_published_palace(
        t04_session,
        posts=(post,),
        title="怪盗据点工程",
        name="ScurryCat",
        location="个人博客",
        cognition="据点",
    )
    response = resolve(public_client, "ScurryCat", "个人博客", "据点")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "found"
    assert [item["slug"] for item in payload["matches"]] == [palace.slug]
    match = payload["matches"][0]
    assert match["keywords"] == {"name": "ScurryCat", "location": "个人博客", "cognition": "据点"}
    assert match["title"] == "怪盗据点工程"


def test_nfkc_trim_and_case_insensitive_matching(public_client, t04_session: Session):
    """全角 / 大小写 / 首尾空白差异都按同一规则归一（04 §6 第 1 条）。"""
    post = make_post(t04_session)
    palace = make_published_palace(
        t04_session,
        posts=(post,),
        name="ScurryCat",
        location="个人博客",
        cognition="Hideout",
    )
    cases = [
        # 首尾空白 + 大小写不同
        ("  ScurryCat  ", "个人博客", "hideout"),
        # 全角（NFKC 归一后等价）
        ("ＳｃｕｒｒｙＣａｔ", "个人博客", "ＨＩＤＥＯＵＴ"),
        # 全角空白与制表符
        ("　ScurryCat\t", " 个人博客 ", "Hideout "),
    ]
    for name, location, cognition in cases:
        response = resolve(public_client, name, location, cognition)
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "found", (name, location, cognition, response.json())
        assert response.json()["matches"][0]["slug"] == palace.slug


def test_alias_matching_uses_the_same_normalization(public_client, t04_session: Session):
    """别名按与标准值完全相同的规则保存与匹配。"""
    post = make_post(t04_session)
    palace = make_published_palace(
        t04_session,
        posts=(post,),
        name="ScurryCat",
        location="个人博客",
        cognition="据点",
        aliases=(
            ("name", "PHANTOM"),
            ("name", "怪盗手记"),
            ("location", "Blog"),
            ("cognition", "基地"),
            ("cognition", "Hideout"),
        ),
    )
    # 标准值 + 别名混合也能命中（三项分别来自不同来源）。
    for name, location, cognition in [
        ("phantom", "个人博客", "hideout"),   # 别名（大小写不同）
        ("怪盗手记", "blog", "基地"),          # 别名 + 别名
        ("ＳＣＵＲＲＹＣＡＴ", "ＢＬＯＧ", "据点"),  # 全角标准值 / 全角别名
    ]:
        payload = resolve(public_client, name, location, cognition).json()
        assert payload["status"] == "found", (name, location, cognition, payload)
        assert payload["matches"][0]["slug"] == palace.slug


def test_intersection_is_required(public_client, t04_session: Session):
    """三项必须命中**同一座**殿堂；跨殿堂的命中不算找到（求交集，不做并集）。"""
    post = make_post(t04_session)
    make_published_palace(t04_session, posts=(post,), name="Alpha", location="东京", cognition="迷宫")
    make_published_palace(t04_session, posts=(post,), name="Beta", location="涩谷", cognition="工房")

    payload = resolve(public_client, "Alpha", "涩谷", "迷宫").json()
    assert payload["status"] == "not_found"
    assert payload["matches"] == []


def test_alias_overlap_returns_ambiguous_with_deterministic_order(public_client, t04_session: Session):
    """别名重叠 → `ambiguous`，列出全部候选且顺序可复现（不随机挑一个）。"""
    post = make_post(t04_session)
    shared_name = unique_keyword("同名目标")
    older = make_published_palace(
        t04_session,
        posts=(post,),
        title="较早的殿堂",
        name=shared_name,
        location="共享地点",
        published_at=datetime.now(UTC) - timedelta(days=10),
    )
    newer = make_published_palace(
        t04_session,
        posts=(post,),
        title="较新的殿堂",
        name=shared_name,
        location="共享地点",
        published_at=datetime.now(UTC) - timedelta(days=1),
    )

    # 三项都同时命中两座殿堂 → ambiguous，并且按 (published_at DESC, id DESC) 排序。
    payload = resolve(public_client, shared_name, "共享地点", "据点").json()
    assert payload["status"] == "ambiguous"
    assert [item["slug"] for item in payload["matches"]] == [newer.slug, older.slug]

    # 同一请求重复 5 次顺序完全一致。
    orders = {
        tuple(
            item["slug"]
            for item in resolve(public_client, shared_name, "共享地点", "据点").json()["matches"]
        )
        for _ in range(5)
    }
    assert orders == {(newer.slug, older.slug)}


def test_alias_overlap_from_alias_of_another_palace(public_client, t04_session: Session):
    """一座殿堂的**别名**与另一座的**标准值**重叠时同样返回多候选。"""
    post = make_post(t04_session)
    standard = make_published_palace(
        t04_session, posts=(post,), name="ScurryCat", location="Blog", cognition="据点"
    )
    aliased = make_published_palace(
        t04_session,
        posts=(post,),
        name="Other",
        location="Other",
        cognition="Other",
        aliases=(("name", "ScurryCat"), ("location", "Blog"), ("cognition", "据点")),
    )
    payload = resolve(public_client, "scurrycat", "Blog", "据点").json()
    assert payload["status"] == "ambiguous"
    assert {item["slug"] for item in payload["matches"]} == {standard.slug, aliased.slug}


def test_not_found_is_a_normal_business_result(public_client, t04_session: Session):
    post = make_post(t04_session)
    make_published_palace(t04_session, posts=(post,))
    response = resolve(public_client, "没有任何专题用它", "也不会有", "不存在")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "not_found"
    assert payload["matches"] == []


def test_draft_palace_and_palace_without_public_post_never_match(public_client, t04_session: Session):
    public_post = make_post(t04_session)
    draft_post = make_draft(t04_session)
    draft = make_palace(t04_session, posts=(public_post,), name="DraftOnly", location="L", cognition="C")
    no_public = make_published_palace(
        t04_session, posts=(draft_post,), name="NoPublic", location="L2", cognition="C2"
    )

    for name, location, cognition in [
        ("DraftOnly", "L", "C"),
        ("NoPublic", "L2", "C2"),
    ]:
        payload = resolve(public_client, name, location, cognition).json()
        assert payload["status"] == "not_found", (name, payload)
    assert draft.slug and no_public.slug


def test_retracted_palace_stops_matching(public_client, t04_session: Session):
    """撤回后重新匹配不到（验收 3 的匹配部分）。"""
    post = make_post(t04_session)
    palace = make_published_palace(t04_session, posts=(post,), name="Revoke", location="L", cognition="C")
    assert resolve(public_client, "Revoke", "L", "C").json()["status"] == "found"

    palace.status = "draft"
    t04_session.commit()
    assert resolve(public_client, "Revoke", "L", "C").json()["status"] == "not_found"


def test_input_validation_is_422_not_not_found(public_client, t04_session: Session):
    """输入不合法（空白 / 超长 / 缺字段）是 422，不是「未找到」（验收 2）。"""
    blank = resolve(public_client, "   ", "个人博客", "据点")
    assert_error(blank, status=422, code="UNPROCESSABLE")

    too_long = resolve(public_client, "x" * 81, "个人博客", "据点")
    assert_error(too_long, status=422, code="UNPROCESSABLE")

    missing = public_client.post("/api/v1/nav/resolve", json={"name": "a", "location": "b"})
    assert_error(missing, status=422, code="UNPROCESSABLE")
    assert "cognition" in missing.json()["error"]["fields"]


def test_resolve_has_no_side_effects(public_client, t04_session: Session):
    """定位是只读的：不写库、不改版本、不产生足迹（05 §5）。"""
    post = make_post(t04_session)
    palace = make_published_palace(t04_session, posts=(post,), name="ReadOnly", location="L", cognition="C")
    t04_session.commit()

    def counts() -> dict[str, int]:
        return {
            "palaces": t04_session.execute(select(func.count()).select_from(Palace)).scalar_one(),
            "aliases": t04_session.execute(select(func.count()).select_from(PalaceAlias)).scalar_one(),
            "relations": t04_session.execute(select(func.count()).select_from(PalacePost)).scalar_one(),
        }

    before = counts()
    version_before = palace.version
    for _ in range(3):
        assert resolve(public_client, "ReadOnly", "L", "C").status_code == 200
    t04_session.expire_all()
    assert counts() == before
    assert t04_session.get(Palace, palace.id).version == version_before


def test_resolve_rate_limit_returns_429_with_retry_after(public_client, t04_session: Session, monkeypatch):
    """超过每分钟限额 → 429 + Retry-After（05 §9）。"""
    post = make_post(t04_session)
    make_published_palace(t04_session, posts=(post,), name="Rate", location="L", cognition="C")
    monkeypatch.setattr(ratelimit, "RESOLVE_PER_MINUTE", 3)

    for _ in range(3):
        assert resolve(public_client, "Rate", "L", "C").status_code == 200
    limited = resolve(public_client, "Rate", "L", "C")
    assert_error(limited, status=429, code="RATE_LIMITED")
    assert int(limited.headers["Retry-After"]) >= 1

    # 搜索是独立的计数桶：定位被限流不影响搜索。
    assert public_client.get("/api/v1/nav/search", params={"q": "Rate"}).status_code == 200
