"""作品模型与数据库约束（T06 执行清单第 1、2 条）。

断言的是**真实 PostgreSQL 的约束行为**，不是「模型里写了 CheckConstraint」：

  - status / maintenance / version 的取值域；
  - 同一作品的 `media_id` 唯一、`position` 唯一（复合主键 + 唯一约束）；
  - `position` 范围与 `alt` 长度的 CHECK；
  - slug 唯一；
  - 删除专题时 `projects.palace_id` 走 `ON DELETE SET NULL`，**作品不会被连带删除**
    （验收 5：「专题撤回不连带删除作品」的数据库级保证）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.modules.projects.models import Project, project_media
from tests.projects.helpers import attach_images, make_media, make_project
from tests.support.t06_shared import make_admin, unique_slug
from tests.support.t06_db import T06_TABLES


def _palace_row(engine) -> uuid.UUID:
    """插一条最小 palaces 行（T04 的表），用于 FK / ON DELETE SET NULL 用例。

    只写这一张表，不动 T04 的模型代码；字段取值与 nav 的 CHECK 一致。
    """
    palace_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "insert into palaces (id, slug, title, summary, name, location, cognition,"
                " status, created_at, updated_at, version)"
                " values (:id, :slug, '测试专题', '', 'n', 'l', 'c', 'draft', now(), now(), 1)"
            ),
            {"id": palace_id, "slug": f"t06-palace-{uuid.uuid4().hex[:8]}"},
        )
    return palace_id


def test_t06_tables_exist(t06_schema_report, t06_engine) -> None:
    """四张表都在（迁移或夹具补齐 —— 报告会如实说明是谁建的）。"""
    with t06_engine.connect() as connection:
        names = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
    assert set(T06_TABLES) <= names, t06_schema_report


def test_slug_must_be_unique(t06_session) -> None:
    owner = make_admin(t06_session)
    slug = unique_slug("dup")
    make_project(t06_session, slug=slug)
    with pytest.raises(IntegrityError):
        make_project(t06_session, slug=slug, title="第二件")


def test_status_and_maintenance_check_constraints(t06_session) -> None:
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update projects set status = 'archived' where id = :id"), {"id": project.id}
        )
    t06_session.rollback()

    project = make_project(t06_session, slug=unique_slug())
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update projects set maintenance = 'unknown' where id = :id"),
            {"id": project.id},
        )
    t06_session.rollback()


def test_version_must_be_positive(t06_session) -> None:
    project = make_project(t06_session, slug=unique_slug())
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update projects set version = 0 where id = :id"), {"id": project.id}
        )
    t06_session.rollback()


def test_same_media_cannot_appear_twice(t06_session) -> None:
    """同一作品的 `media_id` 唯一（复合主键）—— 一张图不能在一次作品里占两格。"""
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    media = make_media(t06_session, owner)
    attach_images(t06_session, project, [(media.id, 0, "cover")])
    with pytest.raises(IntegrityError):
        attach_images(t06_session, project, [(media.id, 1, "detail")])


def test_same_position_cannot_appear_twice(t06_session) -> None:
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    first = make_media(t06_session, owner)
    second = make_media(t06_session, owner)
    attach_images(t06_session, project, [(first.id, 0, "cover")])
    with pytest.raises(IntegrityError):
        attach_images(t06_session, project, [(second.id, 0, "detail")])


def test_position_range_check(t06_session) -> None:
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    media = make_media(t06_session, owner)
    with pytest.raises(IntegrityError):
        t06_session.execute(
            project_media.insert().values(
                project_id=project.id,
                media_id=media.id,
                position=20,
                kind="detail",
                alt="越界",
                caption="",
            )
        )


def test_alt_length_check(t06_session) -> None:
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    media = make_media(t06_session, owner)
    with pytest.raises(IntegrityError):
        t06_session.execute(
            project_media.insert().values(
                project_id=project.id,
                media_id=media.id,
                position=0,
                kind="detail",
                alt="",
                caption="",
            )
        )


def test_media_reference_is_restricted_not_cascaded(t06_session) -> None:
    """媒体被引用时不能物理删除（RESTRICT）：文件仍可能被别的公开内容引用。"""
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    media = make_media(t06_session, owner)
    attach_images(t06_session, project, [(media.id, 0, "cover")])
    with pytest.raises(IntegrityError):
        t06_session.execute(text("delete from media where id = :id"), {"id": media.id})


def test_palace_link_is_a_real_fk_with_set_null(t06_engine) -> None:
    """`projects.palace_id` 是**带外键验证**的可空关联，删除专题时置 NULL 而不删作品。

    这里查 `information_schema` 而不是真的去 `delete from palaces`：真实删除需要
    两个独立事务（本机实测，用例事务里未提交的 projects 行会让另一个连接的 delete
    等 3 分钟以上），而**契约本身**（可空 + 外键 + SET NULL + 不级联删除）完全可以从
    目录里断言。行为级证据在 `test_public_api.py` 的「专题撤回不连带删除作品」用例里
    （软删除路径，那才是产品语义上的「撤回」）。
    """
    with t06_engine.connect() as connection:
        row = connection.execute(
            text(
                "select rc.delete_rule, c.is_nullable"
                " from information_schema.referential_constraints rc"
                " join information_schema.table_constraints tc"
                "   on tc.constraint_name = rc.constraint_name"
                "  and tc.constraint_schema = rc.constraint_schema"
                " join information_schema.key_column_usage kcu"
                "   on kcu.constraint_name = rc.constraint_name"
                "  and kcu.constraint_schema = rc.constraint_schema"
                " join information_schema.columns c"
                "   on c.table_name = kcu.table_name"
                "  and c.column_name = kcu.column_name"
                " where tc.table_name = 'projects' and kcu.column_name = 'palace_id'"
            )
        ).first()
    assert row is not None, "projects.palace_id 必须有真实外键（05 §11：不做无外键验证的任意资源 ID）"
    delete_rule, is_nullable = row
    assert delete_rule == "SET NULL", delete_rule
    assert is_nullable == "YES", is_nullable


def test_deleting_project_releases_media_rows(t06_session) -> None:
    """删除作品时关系行随 CASCADE 消失，媒体行本身不动。"""
    owner = make_admin(t06_session)
    project = make_project(t06_session, slug=unique_slug())
    media = make_media(t06_session, owner)
    attach_images(t06_session, project, [(media.id, 0, "cover")])
    t06_session.execute(delete(Project).where(Project.id == project.id))
    t06_session.flush()
    remaining = t06_session.execute(
        select(project_media.c.media_id).where(project_media.c.project_id == project.id)
    ).scalars().all()
    assert remaining == []
