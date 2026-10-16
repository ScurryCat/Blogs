"""基线：建立单一 Alembic head

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-16

本迁移**不建任何业务表**。05 §1 要求按里程碑创建实际需要的表，不一次生成所有未来
应用的数据结构；交接计划要求单一 head，且各功能包不得制造平行 head。

它的作用是给出唯一、可复查的起点：T01 起每个模块的迁移都接在这条链上，
`alembic upgrade head` 与 `alembic heads` 从第一天就有确定结果。
"""

from __future__ import annotations

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
