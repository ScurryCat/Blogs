"""N3 album_media_sources（收录来源 + 历史相册图片回填独立来源）

Revision ID: b7c3e9a1d2f4
Revises: 528a38f23614
Create Date: 2026-10-17 10:41:00.000000

第三轮任务书 §4.4 / §4.5 / §4.7：

  - 新增 `album_media_sources`：表达「独立相册收录」与「动态相册收录」两类来源；
    同一「相册 + 媒体」允许多来源，三元组 (moment_id, album_id, media_id) 唯一；
  - **迁移前已存在的每一张相册图片都回填为独立来源**，不按「恰好被动态引用」推断；
  - 回退：旧 schema 没有来源概念，直接删表会让「纯动态来源」的 `album_media` 行在
    旧版本里被当成独立收录而获得公开资格。因此回退时先删除**没有任何独立来源**的
    显示关系，再删表 —— 宁可丢动态收录配置，也不能把撤回来源转成独立来源「保数据」。
    回退限制（会丢失动态收录配置与纯动态来源的相册显示关系）见交付报告 §8；
    升级前必须先备份（pg_dump custom format），回退后由用户重新保存收录选择。
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "b7c3e9a1d2f4"
down_revision: str | None = "528a38f23614"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "album_media_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("album_id", sa.Uuid(), nullable=False),
        sa.Column("media_id", sa.Uuid(), nullable=False),
        sa.Column("moment_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["album_id"],
            ["albums.id"],
            name=op.f("fk_album_media_sources_album_id_albums"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["media_id"],
            ["media.id"],
            name=op.f("fk_album_media_sources_media_id_media"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["moment_id"],
            ["moments.id"],
            name=op.f("fk_album_media_sources_moment_id_moments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_album_media_sources")),
        sa.UniqueConstraint(
            "moment_id",
            "album_id",
            "media_id",
            name="uq_album_media_sources_moment_triple",
        ),
    )
    op.create_index(
        "uq_album_media_sources_independent",
        "album_media_sources",
        ["album_id", "media_id"],
        unique=True,
        postgresql_where=sa.text("moment_id IS NULL"),
    )
    op.create_index(
        "ix_album_media_sources_album_id_media_id",
        "album_media_sources",
        ["album_id", "media_id"],
        unique=False,
    )
    op.create_index(
        "ix_album_media_sources_media_id",
        "album_media_sources",
        ["media_id"],
        unique=False,
    )

    # 历史数据回填：迁移前已存在的所有相册图片 = 独立收录（任务书 §4.4 末段）。
    # 用 NOT EXISTS 保证幂等：重复执行 upgrade（例如回退后再升级）不会产生重复来源。
    op.execute(
        """
        INSERT INTO album_media_sources (id, album_id, media_id, moment_id, created_at)
        SELECT gen_random_uuid(), am.album_id, am.media_id, NULL, now()
        FROM album_media AS am
        WHERE NOT EXISTS (
            SELECT 1
            FROM album_media_sources AS s
            WHERE s.album_id = am.album_id
              AND s.media_id = am.media_id
              AND s.moment_id IS NULL
        )
        """
    )


def downgrade() -> None:
    # 安全回退：删除「没有任何独立来源」的显示关系，避免旧版本把纯动态来源误当独立收录。
    op.execute(
        """
        DELETE FROM album_media AS am
        WHERE NOT EXISTS (
            SELECT 1
            FROM album_media_sources AS s
            WHERE s.album_id = am.album_id
              AND s.media_id = am.media_id
              AND s.moment_id IS NULL
        )
        """
    )
    op.drop_index(
        "ix_album_media_sources_media_id", table_name="album_media_sources"
    )
    op.drop_index(
        "ix_album_media_sources_album_id_media_id", table_name="album_media_sources"
    )
    op.drop_index(
        "uq_album_media_sources_independent", table_name="album_media_sources"
    )
    op.drop_table("album_media_sources")
