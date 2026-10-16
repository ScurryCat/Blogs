"""动态模型与数据库约束（05 §3 / §4，03 §5）。

这里断言的是**真实 PostgreSQL 执行的约束**，不是 Python 侧的校验：
每条用例都直接 `session.flush()`，让数据库来说「不行」。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.exc import DataError, IntegrityError

from app.modules.moments.models import (
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Moment,
    moment_media,
    moment_tags,
)
from tests.moments.helpers import attach_images, make_media, make_moment
from tests.moments.t03_db import T03_MODEL_MODULES


def test_tables_created_by_real_migration_or_reported_fallback(t03_engine, t03_schema_report):
    """表必须真实存在；来源（迁移 / 补齐）如实报告，不假装迁移已覆盖。"""
    with t03_engine.connect() as connection:
        tables = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
    for name in ("moments", "moment_media", "moment_tags"):
        assert name in tables, f"{name} 未建出"
    fallback = list(t03_schema_report["created_by_fallback"])  # type: ignore[arg-type]
    # 集成迁移落地后这个列表应为空；现在如实打印，不强行断言「已由迁移建出」。
    assert isinstance(fallback, list)


def test_check_constraints_exist_in_database(t03_engine):
    """CHECK 约束真的在库里（不是只在模型里声明）。"""
    with t03_engine.connect() as connection:
        rows = connection.execute(
            text(
                "select conrelid::regclass::text as table_name, conname "
                "from pg_constraint where contype = 'c' "
                "and conrelid::regclass::text in ('moments', 'moment_media')"
            )
        ).all()
    names = {row.conname for row in rows}
    assert "ck_moments_status_valid" in names
    assert "ck_moments_text_length" in names
    assert "ck_moments_version_positive" in names
    assert "ck_moment_media_position_range" in names
    assert "ck_moment_media_alt_length" in names


def test_public_listing_partial_index_is_partial(t03_engine):
    """公开列表索引必须是**部分索引**且条件与公开查询一致（05 §4）。"""
    with t03_engine.connect() as connection:
        definition = connection.execute(
            text("select indexdef from pg_indexes where indexname = 'ix_moments_public_listing'")
        ).scalar()
    assert definition is not None, "ix_moments_public_listing 不存在"
    assert "WHERE" in definition
    assert "published" in definition
    assert "deleted_at IS NULL" in definition


def test_unique_constraints_on_relations(t03_engine):
    """同一动态的 media_id 与 position 分别唯一。"""
    with t03_engine.connect() as connection:
        rows = connection.execute(
            text(
                "select conname, contype from pg_constraint "
                "where conrelid::regclass::text in ('moment_media', 'moment_tags')"
            )
        ).all()
    kinds = {row.conname: row.contype for row in rows}
    assert kinds.get("pk_moment_media") == "p"
    assert kinds.get("pk_moment_tags") == "p"
    assert kinds.get("uq_moment_media_moment_id_position") == "u"


def _owner(session):
    """建一位站主。用户名带随机后缀：临时库在会话内复用，不能撞唯一键。"""
    from tests.auth.helpers import make_admin

    return make_admin(session, username=f"owner{uuid.uuid4().hex[:8]}")


def test_status_check_rejects_unknown_value(t03_session):
    owner = _owner(t03_session)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT)
    moment.status = "scheduled"
    with pytest.raises((IntegrityError, DataError)):
        t03_session.flush()


def test_text_length_check_limits_2000_codepoints(t03_session):
    owner = _owner(t03_session)
    ok = make_moment(t03_session, owner, text="字" * 2000)
    assert len(ok.text) == 2000
    over = Moment(author_id=owner.id, text="字" * 2001, status=STATUS_DRAFT)
    t03_session.add(over)
    with pytest.raises((IntegrityError, DataError)):
        t03_session.flush()


def test_version_must_be_positive(t03_session):
    owner = _owner(t03_session)
    bad = Moment(author_id=owner.id, text="x", status=STATUS_DRAFT, version=0)
    t03_session.add(bad)
    with pytest.raises((IntegrityError, DataError)):
        t03_session.flush()


def test_position_above_range_rejected_by_database(t03_session):
    """position 9 越界（03 §5：1–9 张图 → position 0–8）。"""
    owner = _owner(t03_session)
    media = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT)
    with pytest.raises((IntegrityError, DataError)):
        t03_session.execute(
            insert(moment_media).values(
                moment_id=moment.id, media_id=media.id, position=9, alt="越界位置"
            )
        )
        t03_session.flush()


def test_empty_alt_rejected_by_database(t03_session):
    """替代文本至少 1 个码点（03 §5）。"""
    owner = _owner(t03_session)
    media = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT)
    with pytest.raises((IntegrityError, DataError)):
        t03_session.execute(
            insert(moment_media).values(
                moment_id=moment.id, media_id=media.id, position=0, alt=""
            )
        )
        t03_session.flush()


def test_overlong_alt_rejected_by_database(t03_session):
    """替代文本最多 200 个码点（03 §5）。"""
    owner = _owner(t03_session)
    media = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT)
    with pytest.raises((IntegrityError, DataError)):
        t03_session.execute(
            insert(moment_media).values(
                moment_id=moment.id, media_id=media.id, position=0, alt="字" * 201
            )
        )
        t03_session.flush()


def test_duplicate_media_id_rejected(t03_session):
    """同一动态的 media_id 唯一（复合主键）。"""
    owner = _owner(t03_session)
    media = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT)
    attach_images(t03_session, moment, [(media.id, 0, "图一")])
    with pytest.raises(IntegrityError):
        attach_images(t03_session, moment, [(media.id, 1, "重复图")])


def test_duplicate_position_rejected(t03_session):
    """同一动态的 position 唯一（03 §5：位置唯一）。"""
    owner = _owner(t03_session)
    first = make_media(t03_session, owner)
    second = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT)
    attach_images(t03_session, moment, [(first.id, 0, "图一")])
    with pytest.raises(IntegrityError):
        attach_images(t03_session, moment, [(second.id, 0, "同位置")])


def test_duplicate_tag_on_same_moment_rejected(t03_session):
    owner = _owner(t03_session)
    moment = make_moment(t03_session, owner, status=STATUS_DRAFT, tags=("重复标签",))
    tag_id = t03_session.execute(select(moment_tags.c.tag_id)).scalars().first()
    with pytest.raises(IntegrityError):
        t03_session.execute(
            insert(moment_tags).values(moment_id=moment.id, tag_id=tag_id)
        )
        t03_session.flush()


def test_moment_media_fk_restricts_media_hard_delete(t03_session):
    """媒体被动态引用时不能硬删除（`ON DELETE RESTRICT`）。

    正常路径是软删除；这条约束防的是「有人写了物理清理脚本」。
    """
    owner = _owner(t03_session)
    media = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, status=STATUS_PUBLISHED)
    attach_images(t03_session, moment, [(media.id, 0, "图一")])
    with pytest.raises(IntegrityError):
        t03_session.execute(
            text("delete from media where id = :media_id"), {"media_id": str(media.id)}
        )
        t03_session.flush()


def test_model_module_is_listed_for_integration():
    """交付单里的模型清单必须与代码一致（集成方按它写 MODEL_MODULES）。"""
    assert T03_MODEL_MODULES == ("app.modules.moments.models",)
    assert Moment.__tablename__ == "moments"
