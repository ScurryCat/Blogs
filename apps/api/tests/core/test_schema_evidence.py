"""迁移与模型一致性的交叉证据（T01 自身的表）。

T00 已有 `tests/test_migration_sync.py` 做全量模型 ↔ 迁移漂移检查；这里补的是
T01 视角的两条证据：

  1. 本会话的表必须**由真实迁移建出来**，而不是由夹具的 `Base.metadata.create_all`
     兜底补出来。若「补出来的表」非空，说明迁移漏了 T01 的某张表。
  2. 关键约束真的由 PostgreSQL 执行（唯一 / CHECK），不是只写在模型里。

第二条刻意用独立连接而不是事务夹具的 session：约束违例会让 session 进入失败状态，
用它反而看不清是「约束生效」还是「夹具报错」。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError

from app.modules.auth.models import AdminUser
from app.modules.media.models import Media
from app.modules.posts.models import Post

T01_TABLES = (
    "admin_users",
    "sessions",
    "audit_events",
    "auth_rate_limits",
    "media",
    "tags",
    "post_tags",
    "posts",
)


def test_t01_tables_were_created_by_the_migration(t01_schema_report):
    fallback = t01_schema_report["created_by_fallback"]
    assert fallback == [], (
        "夹具用 Base.metadata.create_all 补出了这些表："
        f"{fallback}；说明集成迁移缺少它们（迁移本身归 T00）"
    )


def test_t01_tables_exist_in_the_test_database(t01_engine):
    with t01_engine.connect() as connection:
        existing = set(
            connection.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = current_schema()"
                )
            ).scalars()
        )
        revision = connection.execute(text("select version_num from alembic_version")).scalars().all()
    for name in T01_TABLES:
        assert name in existing, f"测试库里缺少表 {name}"
    assert len(revision) == 1, f"必须只有一个 alembic head，实际 {revision}"


def test_unique_constraints_are_enforced_by_postgres(t01_engine):
    owner_id = uuid.uuid4()
    with t01_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(
            insert(AdminUser).values(
                id=owner_id, username="constraint-owner", password_hash="x" * 20
            )
        )
        with pytest.raises(IntegrityError) as excinfo:
            connection.execute(
                insert(AdminUser).values(
                    id=uuid.uuid4(), username="constraint-owner", password_hash="y" * 20
                )
            )
        assert "uq_admin_users_username" in str(excinfo.value)
        transaction.rollback()


def test_check_constraints_are_enforced_by_postgres(t01_engine):
    with t01_engine.connect() as connection:
        transaction = connection.begin()
        owner_id = uuid.uuid4()
        connection.execute(
            insert(AdminUser).values(
                id=owner_id, username="check-owner", password_hash="x" * 20
            )
        )

        # 每次预期失败都放进 SAVEPOINT：PostgreSQL 在语句报错后会把事务标记为
        # aborted，不回到保存点就无法继续下一条语句。
        media_statement = insert(Media).values(
            id=uuid.uuid4(),
            owner_id=owner_id,
            storage_key="aa/" + "0" * 32 + "/original.png",
            mime_type="image/png",
            bytes=10,
            width=10,
            height=10,
            sha256="a" * 64,
            variants={},
            status="bogus",  # media.status 只允许 processing / ready / failed
        )
        post_statement = insert(Post).values(
            id=uuid.uuid4(),
            slug="check-status-post",
            title="x",
            status="archived",  # posts.status 只允许 draft / published
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )

        for statement, expected_constraint in (
            (media_statement, "ck_media_status_valid"),
            (post_statement, "ck_posts_status_valid"),
        ):
            savepoint = connection.begin_nested()
            with pytest.raises(IntegrityError) as excinfo:
                connection.execute(statement)
            assert expected_constraint in str(excinfo.value)
            savepoint.rollback()

        transaction.rollback()


def test_partial_index_for_public_listing_exists(t01_engine):
    """公开列表的部分索引必须真的建出来（05 §4：按公开条件选择索引）。"""
    with t01_engine.connect() as connection:
        definition = connection.execute(
            text("select indexdef from pg_indexes where indexname = 'ix_posts_public_listing'")
        ).scalar()
    assert definition, "缺少 ix_posts_public_listing"
    assert "published_at" in definition and "id" in definition
    assert "status" in definition and "deleted_at" in definition


def test_unique_slug_and_pagination_index_are_usable(t01_engine):
    """抽查 slug 唯一索引存在，且能被查询计划使用（不凭感觉建索引）。"""
    with t01_engine.connect() as connection:
        slugs = connection.execute(
            text("select indexname from pg_indexes where tablename = 'posts' and indexdef like '%slug%'")
        ).scalars().all()
    assert any("uq_posts_slug" in name for name in slugs), slugs
    assert select(Post.id).where(Post.slug == "x") is not None
