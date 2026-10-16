"""问题记录模型与数据库约束（07 §6、07 §8、05 §3 末段）。

重点守两件事：

  1. **工作状态与发布状态是两个独立列**，数据库层面就能表达「已解决但仍是草稿」；
  2. **已解决才有解决时间** —— 这条由真实 CHECK 约束守住，不靠服务层自觉。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.modules.exploration.models import (
    RECORD_STATUSES,
    WORK_STATUSES,
    WORK_STATUS_LABELS,
    ExplorationRecord,
)
from tests.exploration.helpers import make_record, unique_slug

UTC = timezone.utc


def test_slug_is_unique(t09_session: Session) -> None:
    slug = unique_slug("dup")
    make_record(t09_session, slug=slug)
    with pytest.raises(IntegrityError):
        make_record(t09_session, slug=slug, title="另一条记录")
    t09_session.rollback()


@pytest.mark.parametrize("work_status", WORK_STATUSES)
def test_every_work_status_is_accepted(t09_session: Session, work_status: str) -> None:
    resolved_at = datetime.now(UTC) if work_status == "resolved" else None
    record = make_record(
        t09_session,
        slug=unique_slug("ws"),
        work_status=work_status,
        resolved_at=resolved_at,
        outcome="已解决时必须带结果说明" if work_status == "resolved" else "",
    )
    assert record.work_status == work_status
    assert work_status in WORK_STATUS_LABELS


@pytest.mark.parametrize("status", RECORD_STATUSES)
def test_every_publish_status_is_accepted(t09_session: Session, status: str) -> None:
    assert make_record(t09_session, slug=unique_slug("st"), status=status).status == status


def test_work_status_and_publish_status_are_independent_columns(
    t09_session: Session,
) -> None:
    """「已解决但仍是草稿」在数据库层面就是合法状态（验收 3 的基础）。"""
    resolved_draft = make_record(
        t09_session,
        slug=unique_slug("rd"),
        work_status="resolved",
        resolved_at=datetime.now(UTC),
        outcome="修好了。",
        status="draft",
    )
    pending_public = make_record(
        t09_session,
        slug=unique_slug("pp"),
        work_status="pending",
        status="published",
    )
    assert resolved_draft.status == "draft"
    assert resolved_draft.work_status == "resolved"
    assert pending_public.status == "published"
    assert pending_public.work_status == "pending"
    assert isinstance(resolved_draft, ExplorationRecord)


def test_resolved_at_requires_resolved_work_status(t09_session: Session) -> None:
    """真实 CHECK 约束：非「已解决」的行不许带解决时间。"""
    with pytest.raises(IntegrityError):
        make_record(
            t09_session,
            slug=unique_slug("bad"),
            work_status="investigating",
            resolved_at=datetime.now(UTC),
        )
    t09_session.rollback()


def test_unknown_work_status_is_rejected_by_database(t09_session: Session) -> None:
    with pytest.raises(IntegrityError):
        make_record(t09_session, slug=unique_slug("bad"), work_status="closed")
    t09_session.rollback()


def test_raw_insert_with_unknown_work_status_is_rejected(t09_session: Session) -> None:
    """绕过 ORM 直接写非法值也要被拒（约束真的在库里）。"""
    with pytest.raises(IntegrityError):
        t09_session.execute(
            text(
                "insert into exploration_records"
                " (id, slug, title, background, attempts, outcome, evidence_links,"
                "  work_status, status, version)"
                " values (:id, :slug, 'x', '', '', '', '[]'::jsonb, 'closed', 'draft', 1)"
            ),
            {"id": uuid.uuid4(), "slug": unique_slug("raw")},
        )
    t09_session.rollback()


def test_title_length_is_bounded_in_database(t09_session: Session) -> None:
    """标题长度由数据库兜底：`varchar(200)` 或 `ck_..._title_length` 先命中哪个都算数。

    两者都是**数据库**在拒绝，而不是 Python 侧的先验检查 —— 这正是这条用例要守的。
    """
    with pytest.raises((IntegrityError, DataError)):
        t09_session.execute(
            text(
                "insert into exploration_records"
                " (id, slug, title, background, attempts, outcome, evidence_links,"
                "  work_status, status, version)"
                " values (:id, :slug, :title, '', '', '', '[]'::jsonb, 'pending', 'draft', 1)"
            ),
            {"id": uuid.uuid4(), "slug": unique_slug("long"), "title": "字" * 201},
        )
    t09_session.rollback()


def test_record_has_no_requester_or_vote_columns(t09_session: Session) -> None:
    """**明确是站主整理**（验收 4）：表里没有访客请求、认领或投票的列。"""
    columns = set(
        t09_session.execute(
            text(
                "select column_name from information_schema.columns"
                " where table_name = 'exploration_records'"
            )
        ).scalars()
    )
    forbidden = {
        "visitor_id",
        "requester",
        "requester_email",
        "submitted_by",
        "claimed_by",
        "assignee",
        "vote_count",
        "upvotes",
        "due_at",
        "sla_due_at",
        "priority",
    }
    assert not (columns & forbidden), sorted(columns & forbidden)
    assert {
        "id",
        "slug",
        "title",
        "background",
        "attempts",
        "outcome",
        "evidence_links",
        "work_status",
        "resolved_at",
        "status",
    } <= columns


def test_relation_tables_do_not_store_titles(t09_session: Session) -> None:
    """**不复制同一份事实**：关系表只存 id 与顺序，没有标题快照。

    如果这里存了标题，撤回文章 / 作品后就无法保证「不泄漏隐藏标题」——
    快照会一直留在记录里。
    """
    for table in ("exploration_record_posts", "exploration_record_projects"):
        columns = set(
            t09_session.execute(
                text(
                    "select column_name from information_schema.columns"
                    f" where table_name = '{table}'"
                )
            ).scalars()
        )
        assert not (columns & {"title", "name", "summary", "slug"}), (table, sorted(columns))


def test_relation_position_is_unique_per_record(t09_session: Session) -> None:
    from app.modules.exploration.models import exploration_record_projects
    from app.modules.projects.models import Project

    record = make_record(t09_session, slug=unique_slug("pos"))
    first = Project(slug=unique_slug("proj"), title="作品一", summary="一句话")
    second = Project(slug=unique_slug("proj"), title="作品二", summary="一句话")
    t09_session.add_all([first, second])
    t09_session.flush()

    t09_session.execute(
        exploration_record_projects.insert().values(
            record_id=record.id, project_id=first.id, position=0
        )
    )
    with pytest.raises(IntegrityError):
        t09_session.execute(
            exploration_record_projects.insert().values(
                record_id=record.id, project_id=second.id, position=0
            )
        )
    t09_session.rollback()


def test_same_project_cannot_be_attached_twice(t09_session: Session) -> None:
    from app.modules.exploration.models import exploration_record_projects
    from app.modules.projects.models import Project

    record = make_record(t09_session, slug=unique_slug("dup2"))
    project = Project(slug=unique_slug("proj"), title="作品一", summary="一句话")
    t09_session.add(project)
    t09_session.flush()

    t09_session.execute(
        exploration_record_projects.insert().values(
            record_id=record.id, project_id=project.id, position=0
        )
    )
    with pytest.raises(IntegrityError):
        t09_session.execute(
            exploration_record_projects.insert().values(
                record_id=record.id, project_id=project.id, position=1
            )
        )
    t09_session.rollback()


def test_relation_rows_cascade_when_record_is_deleted(t09_session: Session) -> None:
    from app.modules.projects.models import Project

    record = make_record(t09_session, slug=unique_slug("cas"))
    project = Project(slug=unique_slug("proj"), title="作品一", summary="一句话")
    t09_session.add(project)
    t09_session.flush()
    t09_session.execute(
        text(
            "insert into exploration_record_projects (record_id, project_id, position)"
            " values (:r, :p, 0)"
        ),
        {"r": str(record.id), "p": str(project.id)},
    )
    t09_session.execute(
        text("delete from exploration_records where id = :id"), {"id": str(record.id)}
    )
    remaining = t09_session.execute(
        text(
            "select count(*) from exploration_record_projects where record_id = :id"
        ),
        {"id": str(record.id)},
    ).scalar_one()
    assert remaining == 0
    # 作品本身不受影响。
    assert (
        t09_session.execute(
            text("select count(*) from projects where id = :id"), {"id": str(project.id)}
        ).scalar_one()
        == 1
    )
    t09_session.rollback()
