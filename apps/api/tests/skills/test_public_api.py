"""技能公开 API（05 §6、07 §6、任务卡验收 1 / 2 / 5 / 6）。

覆盖验收第 1 条（技能 A + B 只返回交集；重复选择、未发布技能、撤回作品、无结果
均有测试）与第 2 条（技能全书与作品详情使用同一关系来源）。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.projects.models import Project
from app.modules.skills.models import STATUS_DRAFT, STATUS_PUBLISHED
from tests.skills.helpers import (
    SKILLS_PATH,
    anonymous_client,
    attach_projects,
    make_skill,
    t09_routers,
    unique_slug,
)


def _project(session: Session, *, title: str = "这个 P5 博客", slug: str | None = None) -> Project:
    project = Project(
        slug=slug or unique_slug("proj"),
        title=title,
        summary="把静态博客改造成怪盗基地",
        role="发起与实现",
        tech_stack=["Next.js", "FastAPI"],
        links=[],
        maintenance="maintained",
    )
    return project


def _published(session: Session, *, title: str, slug: str | None = None) -> Project:
    from datetime import datetime, timedelta, timezone

    project = _project(session, title=title, slug=slug)
    project.status = STATUS_PUBLISHED
    project.published_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    session.add(project)
    session.flush()
    return project


def _published_skill(session: Session, **kwargs):
    kwargs.setdefault("status", STATUS_PUBLISHED)
    return make_skill(session, **kwargs)


# --- 全书列表 / 详情 --------------------------------------------------------


def test_public_list_only_returns_published_skills(t09_session, t09_settings) -> None:
    visible = _published_skill(t09_session, slug=unique_slug("vis"), name="算法")
    make_skill(t09_session, slug=unique_slug("draft"), name="还没写好的技能")
    t09_session.flush()

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(SKILLS_PATH).json()

    slugs = [item["slug"] for item in payload["items"]]
    assert visible.slug in slugs
    assert all(not slug.startswith("draft-") for slug in slugs)
    assert payload["next_cursor"] is None


def test_detail_hides_draft_skill_as_404(t09_session, t09_settings) -> None:
    draft = make_skill(t09_session, slug=unique_slug("draft"))
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(f"{SKILLS_PATH}/{draft.slug}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_detail_reports_scope_evidence_and_links(t09_session, t09_settings) -> None:
    skill = _published_skill(
        t09_session,
        slug=unique_slug("det"),
        name="前端工程",
        domain="frontend",
        scope="能独立完成响应式页面与构建配置。",
        evidence="这个博客的前端与手机宿主，含 320px 适配。",
        links=[{"kind": "repo", "label": "仓库", "url": "https://example.com/blog"}],
    )
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{SKILLS_PATH}/{skill.slug}").json()

    assert payload["domain"] == "frontend"
    assert payload["domain_label"] == "前端工程"
    assert "320px" in payload["evidence"]
    assert payload["links"][0]["url"] == "https://example.com/blog"
    assert payload["projects"] == []
    assert payload["project_count"] == 0
    # 「不自封数值等级」：响应里没有等级 / 分数键。
    assert not ({"level", "rank", "score", "percent"} & set(payload))


def test_no_level_numbers_anywhere_in_public_payload(t09_session, t09_settings) -> None:
    _published_skill(t09_session, slug=unique_slug("num"))
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(SKILLS_PATH).json()
    assert payload["items"], "夹具没有产出公开技能，断言会空过"
    for item in payload["items"]:
        assert not ({"level", "rank", "score", "percent", "years", "stars"} & set(item))


def test_domain_filter_rejects_unknown_value(t09_session, t09_settings) -> None:
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(SKILLS_PATH, params={"domain": "legendary"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNPROCESSABLE"


def test_domain_filter_narrows_results(t09_session, t09_settings) -> None:
    _published_skill(t09_session, slug=unique_slug("fe"), domain="frontend", name="前端工程")
    _published_skill(t09_session, slug=unique_slug("al"), domain="algorithm", name="算法")

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(SKILLS_PATH, params={"domain": "frontend"}).json()

    assert payload["items"], "筛选后应有结果"
    assert all(item["domain"] == "frontend" for item in payload["items"])


# --- 技能 → 作品（同一关系来源）--------------------------------------------


def test_skill_detail_lists_only_public_projects(t09_session, t09_settings) -> None:
    skill = _published_skill(t09_session, slug=unique_slug("proj-skill"))
    public_project = _published(t09_session, title="这个 P5 博客")
    draft_project = _project(t09_session, title="还没发布的作品")
    t09_session.add(draft_project)
    t09_session.flush()
    attach_projects(t09_session, skill, [(public_project, 0), (draft_project, 1)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{SKILLS_PATH}/{skill.slug}").json()

    titles = [item["title"] for item in payload["projects"]]
    assert titles == ["这个 P5 博客"]
    assert payload["project_count"] == 1
    # 草稿作品的标题不能从技能页泄漏出去。
    assert "还没发布的作品" not in str(payload)


def test_tech_overlap_is_derived_not_duplicated(t09_session, t09_settings) -> None:
    """技能名与作品技术栈同名时给出诊断；技能表里**没有**技术标签副本。"""
    skill = _published_skill(t09_session, slug=unique_slug("ts"), name="FastAPI")
    project = _published(t09_session, title="这个 P5 博客")
    attach_projects(t09_session, skill, [(project, 0)])

    columns = {
        str(row)
        for row in t09_session.execute(
            text("select column_name from information_schema.columns where table_name = 'skills'")
        ).scalars()
    }
    assert "tech_stack" not in columns and "tags" not in columns

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{SKILLS_PATH}/{skill.slug}").json()
    assert payload["tech_overlap"] == ["FastAPI"]


def test_tech_overlap_is_empty_when_names_do_not_match(t09_session, t09_settings) -> None:
    skill = _published_skill(t09_session, slug=unique_slug("ts"), name="数据库索引")
    project = _published(t09_session, title="这个 P5 博客")
    attach_projects(t09_session, skill, [(project, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{SKILLS_PATH}/{skill.slug}").json()
    assert payload["tech_overlap"] == []


def test_skills_for_project_matches_the_book(t09_session, t09_settings) -> None:
    """同一关系来源（验收 2）：作品侧与技能侧读的是同一批关系行。"""
    skill_a = _published_skill(t09_session, slug=unique_slug("a"), name="前端工程")
    skill_b = _published_skill(t09_session, slug=unique_slug("b"), name="后端与接口")
    project = _published(t09_session, title="这个 P5 博客")
    attach_projects(t09_session, skill_a, [(project, 0)])
    attach_projects(t09_session, skill_b, [(project, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        from_book_a = client.get(f"{SKILLS_PATH}/{skill_a.slug}").json()
        from_book_b = client.get(f"{SKILLS_PATH}/{skill_b.slug}").json()
        from_project = client.get(f"{SKILLS_PATH}/projects/{project.slug}").json()

    assert [item["slug"] for item in from_book_a["projects"]] == [project.slug]
    assert [item["slug"] for item in from_book_b["projects"]] == [project.slug]
    assert {item["slug"] for item in from_project} == {skill_a.slug, skill_b.slug}


def test_skills_for_project_404_for_unpublished_project(t09_session, t09_settings) -> None:
    project = _project(t09_session, title="还没发布的作品")
    t09_session.add(project)
    t09_session.flush()

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(f"{SKILLS_PATH}/projects/{project.slug}")
    assert response.status_code == 404


def test_skills_for_project_excludes_unpublished_skill(t09_session, t09_settings) -> None:
    public_skill = _published_skill(t09_session, slug=unique_slug("pub"), name="前端工程")
    draft_skill = make_skill(t09_session, slug=unique_slug("hid"), name="秘密技能")
    project = _published(t09_session, title="这个 P5 博客")
    attach_projects(t09_session, public_skill, [(project, 0)])
    attach_projects(t09_session, draft_skill, [(project, 1)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(f"{SKILLS_PATH}/projects/{project.slug}").json()

    assert [item["slug"] for item in payload] == [public_skill.slug]
    assert "秘密技能" not in str(payload)


# --- 「合体」筛选（验收 1）--------------------------------------------------


def _combo_fixture(session: Session):
    """两个技能 + 三件作品：只有「前端 + 后端」同时关联的那件是交集。"""
    frontend = _published_skill(session, slug=unique_slug("fe"), name="前端工程")
    backend = _published_skill(session, slug=unique_slug("be"), name="后端与接口")
    both = _published(session, title="同时用到两者的作品")
    only_frontend = _published(session, title="只有前端的作品")
    only_backend = _published(session, title="只有后端的作品")
    attach_projects(session, frontend, [(both, 0), (only_frontend, 1)])
    attach_projects(session, backend, [(both, 0), (only_backend, 1)])
    return frontend, backend, both, only_frontend, only_backend


def test_combo_returns_intersection_only(t09_session, t09_settings) -> None:
    frontend, backend, both, only_frontend, only_backend = _combo_fixture(t09_session)

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": backend.slug}
        ).json()

    slugs = [item["slug"] for item in payload["items"]]
    assert slugs == [both.slug]
    assert only_frontend.slug not in slugs
    assert only_backend.slug not in slugs
    assert payload["note"] == ""
    assert payload["a"]["slug"] == frontend.slug
    assert payload["b"]["slug"] == backend.slug


def test_combo_is_symmetric(t09_session, t09_settings) -> None:
    frontend, backend, both, _only_fe, _only_be = _combo_fixture(t09_session)

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        forward = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": backend.slug}
        ).json()
        backward = client.get(
            f"{SKILLS_PATH}/combo", params={"a": backend.slug, "b": frontend.slug}
        ).json()

    assert [item["slug"] for item in forward["items"]] == [item["slug"] for item in backward["items"]]


def test_combo_with_same_skill_twice_is_rejected(t09_session, t09_settings) -> None:
    """重复选择同一技能：明确 422，**不**把该技能的全部作品冒充合体结果。"""
    frontend, _backend, _both, only_frontend, _only_be = _combo_fixture(t09_session)

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": frontend.slug}
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "UNPROCESSABLE"
    assert "items" not in body
    assert only_frontend.slug not in response.text


def test_combo_with_same_skill_by_different_case_is_rejected(
    t09_session, t09_settings
) -> None:
    """同一个技能用不同写法（大小写 / 空白）提交也必须是「重复选择」，不能绕过。"""
    frontend, _b, _both, _ofe, _obe = _combo_fixture(t09_session)

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": f"  {frontend.slug}  "}
        )
    assert response.status_code == 422


def test_combo_with_unpublished_skill_is_404(t09_session, t09_settings) -> None:
    """选了未发布的技能：与不存在的技能同形 404，不泄漏站主还没发布的东西。"""
    frontend, _backend, _both, _ofe, _obe = _combo_fixture(t09_session)
    draft = make_skill(t09_session, slug=unique_slug("draft"), name="还没写完的技能")

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        unpublished = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": draft.slug}
        )
        missing = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": "no-such-skill"}
        )

    assert unpublished.status_code == 404
    assert missing.status_code == 404
    assert unpublished.json()["error"]["message"] == missing.json()["error"]["message"]
    assert "还没写完的技能" not in unpublished.text


def test_combo_drops_withdrawn_project(t09_session, t09_settings) -> None:
    """撤回作品后它立刻从交集里消失（公开条件是当前状态，不缓存）。"""
    frontend, backend, both, _ofe, _obe = _combo_fixture(t09_session)

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        before = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": backend.slug}
        ).json()
        assert [item["slug"] for item in before["items"]] == [both.slug]

        # 真实撤回：走 ORM 改状态（等价于管理端 unpublish 的结果）。
        both.status = STATUS_DRAFT
        both.published_at = None
        t09_session.flush()

        after = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": backend.slug}
        ).json()

    assert after["items"] == []
    assert after["note"] == "还没有同时用到这两个技能的公开作品。"
    assert both.slug not in str(after)


def test_combo_empty_result_is_explicit_not_fabricated(t09_session, t09_settings) -> None:
    """完全没有交集：正常 200 + 明确空态，不用 AI 编造一件新作品。"""
    frontend = _published_skill(t09_session, slug=unique_slug("fe"), name="前端工程")
    algorithm = _published_skill(t09_session, slug=unique_slug("al"), name="算法")
    only_frontend = _published(t09_session, title="只有前端的作品")
    only_algorithm = _published(t09_session, title="只有算法的作品")
    attach_projects(t09_session, frontend, [(only_frontend, 0)])
    attach_projects(t09_session, algorithm, [(only_algorithm, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": algorithm.slug}
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == []
    assert payload["note"] == "还没有同时用到这两个技能的公开作品。"
    assert "只有前端的作品" not in response.text
    assert "只有算法的作品" not in response.text


def test_combo_ignores_draft_project_on_either_side(t09_session, t09_settings) -> None:
    """只有草稿作品同时关联两者时，交集依然是空的（草稿不算证据）。"""
    frontend = _published_skill(t09_session, slug=unique_slug("fe"), name="前端工程")
    backend = _published_skill(t09_session, slug=unique_slug("be"), name="后端与接口")
    draft = _project(t09_session, title="还没发布的作品")
    t09_session.add(draft)
    t09_session.flush()
    attach_projects(t09_session, frontend, [(draft, 0)])
    attach_projects(t09_session, backend, [(draft, 0)])

    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        payload = client.get(
            f"{SKILLS_PATH}/combo", params={"a": frontend.slug, "b": backend.slug}
        ).json()

    assert payload["items"] == []
    assert "还没发布的作品" not in str(payload)


def test_combo_requires_both_parameters(t09_session, t09_settings) -> None:
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        response = client.get(f"{SKILLS_PATH}/combo", params={"a": "only-a"})
    assert response.status_code == 422


def test_public_responses_are_not_shared_cached(t09_session, t09_settings) -> None:
    skill = _published_skill(t09_session, slug=unique_slug("cache"))
    with anonymous_client(t09_settings, t09_session, *t09_routers()) as client:
        listing = client.get(SKILLS_PATH)
        detail = client.get(f"{SKILLS_PATH}/{skill.slug}")
    assert "no-store" in listing.headers.get("cache-control", "")
    assert "no-store" in detail.headers.get("cache-control", "")
