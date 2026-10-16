"""技能模型与数据库约束（07 §6、07 §8、05 §3 末段）。

这一组用例守的是「数据库能表达的约束必须落在数据库」：唯一键、复合主键、CHECK 约束
都是**真实 PostgreSQL** 在拒绝写入，而不是 service 里的 Python 判断
（那种判断在绕过 service 的导入脚本 / 手工 SQL 面前毫无作用）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.projects.models import Project
from app.modules.skills.models import (
    DOMAIN_LABELS,
    SKILL_DOMAINS,
    SKILL_STATUSES,
    Skill,
    project_skills,
)
from tests.skills.helpers import attach_projects, make_skill, unique_slug


def test_skill_slug_is_unique(t09_session: Session) -> None:
    slug = unique_slug("dup")
    make_skill(t09_session, slug=slug)
    with pytest.raises(IntegrityError):
        make_skill(t09_session, slug=slug, name="另一个技能")
    t09_session.rollback()


@pytest.mark.parametrize("domain", SKILL_DOMAINS)
def test_every_documented_domain_is_accepted(t09_session: Session, domain: str) -> None:
    skill = make_skill(t09_session, slug=unique_slug("dom"), domain=domain)
    assert skill.domain == domain
    assert domain in DOMAIN_LABELS


@pytest.mark.parametrize("status", SKILL_STATUSES)
def test_documented_statuses_are_accepted(t09_session: Session, status: str) -> None:
    assert make_skill(t09_session, slug=unique_slug("st"), status=status).status == status


def test_unknown_domain_is_rejected_by_database(t09_session: Session) -> None:
    """「领域」是枚举：写一个不存在的值必须是数据库拒绝，不是界面自觉。"""
    with pytest.raises(IntegrityError):
        make_skill(t09_session, slug=unique_slug("bad"), domain="legendary")
    t09_session.rollback()


def test_domain_check_constraint_exists_in_database(t09_session: Session) -> None:
    """约束真的建在库里（而不是只在 `Base.metadata` 里）：直接绕过 ORM 写非法值。"""
    with pytest.raises(IntegrityError):
        t09_session.execute(
            text(
                "insert into skills (id, slug, name, domain, scope, evidence, links, position, status, version)"
                " values (:id, :slug, 'x', 'legendary', '', '', '[]'::jsonb, 0, 'draft', 1)"
            ),
            {"id": uuid.uuid4(), "slug": unique_slug("raw")},
        )
    t09_session.rollback()


def test_status_check_rejects_unknown_value(t09_session: Session) -> None:
    with pytest.raises(IntegrityError):
        t09_session.execute(
            text(
                "insert into skills (id, slug, name, domain, scope, evidence, links, position, status, version)"
                " values (:id, :slug, 'x', 'other', '', '', '[]'::jsonb, 0, 'archived', 1)"
            ),
            {"id": uuid.uuid4(), "slug": unique_slug("raw")},
        )
    t09_session.rollback()


def test_version_must_be_positive(t09_session: Session) -> None:
    with pytest.raises(IntegrityError):
        t09_session.execute(
            text(
                "insert into skills (id, slug, name, domain, scope, evidence, links, position, status, version)"
                " values (:id, :slug, 'x', 'other', '', '', '[]'::jsonb, 0, 'draft', 0)"
            ),
            {"id": uuid.uuid4(), "slug": unique_slug("raw")},
        )
    t09_session.rollback()


def test_position_must_be_non_negative(t09_session: Session) -> None:
    with pytest.raises(IntegrityError):
        t09_session.execute(
            text(
                "insert into skills (id, slug, name, domain, scope, evidence, links, position, status, version)"
                " values (:id, :slug, 'x', 'other', '', '', '[]'::jsonb, -1, 'draft', 1)"
            ),
            {"id": uuid.uuid4(), "slug": unique_slug("raw")},
        )
    t09_session.rollback()


def test_same_project_cannot_be_attached_twice(t09_session: Session) -> None:
    """复合主键：同一技能同一作品只能有一条关系（否则「关联作品数」会虚高）。"""
    skill = make_skill(t09_session, slug=unique_slug("rel"))
    project = Project(slug=unique_slug("proj"), title="作品", summary="一句话")
    t09_session.add(project)
    t09_session.flush()

    attach_projects(t09_session, skill, [(project, 0)])
    with pytest.raises(IntegrityError):
        attach_projects(t09_session, skill, [(project, 1)])
    t09_session.rollback()


def test_position_is_unique_within_a_skill(t09_session: Session) -> None:
    skill = make_skill(t09_session, slug=unique_slug("pos"))
    first = Project(slug=unique_slug("proj"), title="作品一", summary="一句话")
    second = Project(slug=unique_slug("proj"), title="作品二", summary="一句话")
    t09_session.add_all([first, second])
    t09_session.flush()

    attach_projects(t09_session, skill, [(first, 0)])
    with pytest.raises(IntegrityError):
        attach_projects(t09_session, skill, [(second, 0)])
    t09_session.rollback()


def test_project_skills_has_project_id_index(t09_session: Session) -> None:
    """反向查询（按作品找技能）必须有索引：作品详情的「使用的技能」从这里进。"""
    names = set(
        t09_session.execute(
            text("select indexname from pg_indexes where tablename = 'project_skills'")
        ).scalars()
    )
    assert "ix_project_skills_project_id" in names, names


def test_relation_cascades_when_skill_is_deleted(t09_session: Session) -> None:
    """技能被物理删除时关系随之清理（正常路径是软删除，级联只是兜底）。"""
    skill = make_skill(t09_session, slug=unique_slug("cas"))
    project = Project(slug=unique_slug("proj"), title="作品", summary="一句话")
    t09_session.add(project)
    t09_session.flush()
    attach_projects(t09_session, skill, [(project, 0)])

    t09_session.execute(
        text("delete from skills where id = :id"), {"id": str(skill.id)}
    )
    t09_session.flush()
    remaining = t09_session.execute(
        text("select count(*) from project_skills where skill_id = :id"), {"id": str(skill.id)}
    ).scalar_one()
    assert remaining == 0
    # 作品本身不受影响（不能因为删技能顺手删掉真实作品）。
    assert (
        t09_session.execute(
            text("select count(*) from projects where id = :id"), {"id": str(project.id)}
        ).scalar_one()
        == 1
    )
    t09_session.rollback()


def test_skill_has_no_level_or_score_column(t09_session: Session) -> None:
    """**不伪造等级数字**：这张表里根本没有可以塞掌握度的列。"""
    columns = set(
        t09_session.execute(
            text(
                "select column_name from information_schema.columns where table_name = 'skills'"
            )
        ).scalars()
    )
    forbidden = {
        "level",
        "rank",
        "score",
        "percent",
        "percentage",
        "years",
        "stars",
        "rating",
        "mastery",
        "proficiency",
    }
    assert not (columns & forbidden), sorted(columns & forbidden)
    # 反过来确认关键列真的存在（避免表名写错导致上面的断言空过）。
    assert {"id", "slug", "name", "domain", "scope", "evidence", "links", "position", "status"} <= columns


def test_skill_self_contained_fields_round_trip(t09_session: Session) -> None:
    skill = make_skill(
        t09_session,
        slug=unique_slug("rt"),
        name="前端工程",
        domain="frontend",
        links=[{"kind": "repo", "label": "仓库", "url": "https://example.com/repo"}],
        position=7,
    )
    t09_session.refresh(skill)
    assert skill.name == "前端工程"
    assert skill.links[0]["url"] == "https://example.com/repo"
    assert skill.position == 7
    assert isinstance(skill, Skill)
