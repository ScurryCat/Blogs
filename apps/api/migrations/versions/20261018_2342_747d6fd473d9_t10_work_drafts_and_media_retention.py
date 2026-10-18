"""T10 工作草稿与媒体保留关系（P5 第一批 · 设计书 §3.1 / 契约 §3.1）

Revision ID: 747d6fd473d9
Revises: b7c3e9a1d2f4
Create Date: 2026-10-18 23:42:09.805126

两层数据：正式内容（`moments` / `journal_entries`）与工作草稿（本迁移新增的两张表）
分离。自动保存只写工作草稿；发布 / 更新正式内容走显式提交事务。

新增：

  - `work_drafts`：站主的工作副本。`content_type` 只有 moment / journal；
    `target_id` 为空表示新内容（无外键多态，按 content_type 由 service 解析）；
    `target_version` 是开始编辑时的正式内容版本，供双版本检查；
    `data` 是按内容类型校验的编辑数据（JSONB）；
    `status` 只有 active / committed / discarded；`commit_key` 是提交幂等键。
  - `work_draft_media`：图片保留关系（不塞进 JSONB），`position` 0–8、`alt` 允许空。

部分唯一索引（数据库级保证，不靠应用层「先查再写」）：

  - `uq_work_drafts_active_target`：同一站主 × 内容类型 × 正式内容至多一份
    active 草稿 —— 已有内容重复打开时复用，而不是堆出多份平行草稿；
    新内容 `target_id IS NULL` 不在索引里，允许同时存在多份。
  - `uq_work_drafts_owner_commit_key`：同一站主的所有草稿里 `commit_key` 至多出现
    一次 —— 跨草稿重复使用同一个 key 直接 409，避免错误回放别的草稿的提交结果。

只新增两张表、不修改既有表，因此**不丢旧数据 / 旧公开范围 / 相册来源关系**；
回退只删这两张表（草稿是未发布的编辑中间态，正式内容不受影响）。
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "747d6fd473d9"
down_revision: str | None = "b7c3e9a1d2f4"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "work_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("target_version", sa.Integer(), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("draft_version", sa.Integer(), nullable=False),
        sa.Column("commit_key", sa.Uuid(), nullable=True),
        sa.Column("committed_target_id", sa.Uuid(), nullable=True),
        sa.Column("committed_target_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "content_type in ('moment', 'journal')",
            name=op.f("ck_work_drafts_content_type_valid"),
        ),
        sa.CheckConstraint(
            "status in ('active', 'committed', 'discarded')",
            name=op.f("ck_work_drafts_status_valid"),
        ),
        sa.CheckConstraint(
            "draft_version >= 1", name=op.f("ck_work_drafts_draft_version_positive")
        ),
        sa.CheckConstraint(
            "target_version is null or target_version >= 1",
            name=op.f("ck_work_drafts_target_version_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["admin_users.id"],
            name=op.f("fk_work_drafts_owner_id_admin_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_work_drafts")),
    )
    # 列表分页：(owner_id, content_type, updated_at DESC, id DESC) 的正向索引
    # （B-tree 可反向扫描，等价于 DESC）。
    op.create_index(
        "ix_work_drafts_owner_updated",
        "work_drafts",
        ["owner_id", "content_type", "updated_at", "id"],
        unique=False,
    )
    op.create_index(
        "uq_work_drafts_active_target",
        "work_drafts",
        ["owner_id", "content_type", "target_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND target_id IS NOT NULL"),
    )
    op.create_index(
        "uq_work_drafts_owner_commit_key",
        "work_drafts",
        ["owner_id", "commit_key"],
        unique=True,
        postgresql_where=sa.text("commit_key IS NOT NULL"),
    )

    op.create_table(
        "work_draft_media",
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("media_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("alt", sa.String(length=200), nullable=False),
        sa.CheckConstraint(
            "position >= 0 and position <= 8",
            name=op.f("ck_work_draft_media_position_range"),
        ),
        sa.ForeignKeyConstraint(
            ["draft_id"],
            ["work_drafts.id"],
            name=op.f("fk_work_draft_media_draft_id_work_drafts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["media_id"],
            ["media.id"],
            name=op.f("fk_work_draft_media_media_id_media"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("draft_id", "media_id", name=op.f("pk_work_draft_media")),
        sa.UniqueConstraint(
            "draft_id", "position", name="uq_work_draft_media_draft_id_position"
        ),
    )
    # 媒体删除 / 引用检查的反向查询（按 media_id 找草稿保留关系）。
    op.create_index(
        "ix_work_draft_media_media_id", "work_draft_media", ["media_id"], unique=False
    )


def downgrade() -> None:
    # 草稿是未发布的编辑中间态：回退只删这两张表，正式内容、媒体文件与相册来源
    # 关系都不受影响（本迁移没有改它们）。
    op.drop_index("ix_work_draft_media_media_id", table_name="work_draft_media")
    op.drop_table("work_draft_media")
    op.drop_index("uq_work_drafts_owner_commit_key", table_name="work_drafts")
    op.drop_index("uq_work_drafts_active_target", table_name="work_drafts")
    op.drop_index("ix_work_drafts_owner_updated", table_name="work_drafts")
    op.drop_table("work_drafts")
