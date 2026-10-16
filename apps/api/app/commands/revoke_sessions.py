"""撤销站主会话（运维用）。

    uv run --project apps/api python -m app.commands.revoke_sessions --all
    uv run --project apps/api python -m app.commands.revoke_sessions --username <名字>

**为什么需要它**：备份若早于「登出 / 撤销」，恢复会把 `sessions.revoked_at` 覆盖回
`NULL`，于是持有旧 Cookie 的人**重新获得站主访问权** —— 这是实测到的（复现脚本：
`tools/acceptance/verify-restore-revokes-sessions.py`）。验收行「隔离恢复 DB + 媒体」
明确要求「旧会话撤销」，因此**恢复流程必须包含这一步**。本命令把这一步变成一条命令，
而不是让人临场回忆 SQL。

规则：
  - **必须显式给出 `--all` 或 `--username`**：没有默认值，避免误撤销全部会话。
  - **只写 `revoked_at`，不删除行**：审计上更可追溯（哪次、什么时候被撤销）。
  - 输出只有数量与用户名，**从不输出 token 或哈希**。
  - 幂等：已撤销的会话不会被重复计时。
"""

from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import create_db_engine, create_session_factory, database_name_of, session_scope, utcnow
from app.modules.auth.models import AdminSession, AdminUser

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_NOT_FOUND = 4


def _build_engine(settings: Settings) -> Engine:
    return create_db_engine(settings.database_url)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="撤销站主会话（恢复备份后必须执行；见 T10 恢复流程）"
    )
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--all", action="store_true", help="撤销全部有效会话（恢复备份后用这个）")
    who.add_argument("--username", help="只撤销该站主的有效会话")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果摘要")
    return parser


def revoke(
    session: Session,
    *,
    username: str | None,
    now=None,
) -> dict[str, object]:
    """把目标会话标记为已撤销，返回摘要。只改 `revoked_at`，不删行。"""
    moment = now or utcnow()
    statement = select(AdminSession).where(AdminSession.revoked_at.is_(None))
    target_user_id = None
    if username is not None:
        user = session.execute(
            select(AdminUser).where(AdminUser.username == username)
        ).scalars().first()
        if user is None:
            raise LookupError(username)
        target_user_id = user.id
        statement = statement.where(AdminSession.user_id == user.id)

    rows = list(session.execute(statement).scalars())
    for row in rows:
        row.revoked_at = moment
    return {
        "scope": "all" if username is None else f"user:{username}",
        "target_user_id": str(target_user_id) if target_user_id else None,
        "revoked": len(rows),
        "revoked_at": moment.isoformat(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = get_settings()
    engine = _build_engine(settings)
    factory = create_session_factory(engine)

    try:
        with session_scope(factory) as session:
            try:
                summary = revoke(session, username=args.username)
            except LookupError as exc:
                print(f"没有这个站主：{exc}", file=sys.stderr)
                return EXIT_NOT_FOUND
    finally:
        engine.dispose()

    summary["database"] = database_name_of(settings.database_url)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        scope = "全部" if args.username is None else f"站主 {args.username}"
        print(f"已撤销{scope}的有效会话 {summary['revoked']} 个（库 {summary['database']}）")
        if summary["revoked"] == 0:
            print("（没有需要撤销的会话）")
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover - 入口
    sys.exit(main())
