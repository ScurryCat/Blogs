"""`python -m app.commands.revoke_sessions` 的真实 CLI 测试。

断言的是运维契约（与验收行「隔离恢复 DB + 媒体 → 旧会话撤销」相关）：
  - **必须显式给出 `--all` 或 `--username`**，否则拒绝执行（退出码 2）；
  - 站主不存在时报 4 且**不误撤**任何会话；
  - 撤销后旧 Cookie 立即失效（这里用「该会话行被标记 revoked」等价证明，
    真实 Cookie 重放见 `tools/acceptance/verify-restore-revokes-sessions.py`）；
  - **幂等**：连续两次执行，第二次撤销数为 0；
  - 输出里没有 token 或哈希。
"""

from __future__ import annotations

import io
import json
import sys
import uuid

import pytest
from sqlalchemy import select

from app.commands import revoke_sessions
from app.core.config import get_settings
from app.core.db import create_db_engine, create_session_factory, session_scope
from app.modules.auth import service as auth_service
from app.modules.auth.models import AdminSession, AdminUser

PASSWORD = "t08-cli-strong-password-001"


@pytest.fixture()
def cli_environment(t01_database_url, monkeypatch):
    """把 CLI 的 DATABASE_URL 指向 T01 临时库，并在测试后恢复配置缓存。"""
    monkeypatch.setenv("DATABASE_URL", t01_database_url)
    monkeypatch.setenv("APP_ENV", "test")
    get_settings.cache_clear()
    yield t01_database_url
    get_settings.cache_clear()


@pytest.fixture()
def db_url(cli_environment, t01_session) -> str:
    """指向已建好 schema 的 T01 临时库。

    `t01_database_url` 只创建**空库**；表由 `t01_schema_report`（跑真实迁移）建出，
    而 `t01_session` 依赖它。所以这里显式依赖 `t01_session` 来保证 schema 就绪 ——
    缺了它，下面的直连引擎会报 `relation "admin_users" does not exist`。
    """
    return cli_environment


def _seed_owner(url: str, username: str) -> tuple[uuid.UUID, list[str]]:
    engine = create_db_engine(url)
    factory = create_session_factory(engine)
    hashed = auth_service.hash_password(PASSWORD) if hasattr(auth_service, "hash_password") else None
    if hashed is None:  # 走 T01 的公开入口
        from app.core.passwords import hash_password

        hashed = hash_password(PASSWORD)
    with session_scope(factory) as session:
        user = auth_service.create_admin(session, username=username, password_hash=hashed, commit=False)
        # 两个有效会话（其中一个是预登录：user_id 为 NULL）
        # token_hash 有唯一约束：每个测试必须用自己的值，否则同一轮里第二次插入会冲突。
        mine = [uuid.uuid4().hex + uuid.uuid4().hex, uuid.uuid4().hex + uuid.uuid4().hex]
        session.add(AdminSession(token_hash=mine[0], csrf_secret="csrf-secret-a", expires_at=service_future(),
                                 created_at=service_now(), last_seen_at=service_now(), user_id=None))
        session.add(AdminSession(token_hash=mine[1], csrf_secret="csrf-secret-b", expires_at=service_future(),
                                 created_at=service_now(), last_seen_at=service_now(), user_id=user.id))
        session.flush()
        user_id = user.id
    engine.dispose()
    return user_id, mine


def service_now():
    from app.core.db import utcnow

    return utcnow()


def service_future():
    from datetime import timedelta

    from app.core.db import utcnow

    return utcnow() + timedelta(days=7)


def _active(url: str, tokens: list[str]) -> int:
    """只统计**本测试建的**两条会话。

    不能统计全表：`t01_database_url` 是**会话级**夹具，同一轮里别的测试也会留下会话。
    """
    engine = create_db_engine(url)
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        rows = list(session.execute(
            select(AdminSession).where(
                AdminSession.revoked_at.is_(None), AdminSession.token_hash.in_(tokens)
            )
        ).scalars())
        count = len(rows)
    engine.dispose()
    return count


def test_requires_explicit_scope(cli_environment, capsys) -> None:
    """没有 `--all` / `--username` 时 argparse 直接拒绝（退出码 2），不会误撤销全部。"""
    with pytest.raises(SystemExit) as excinfo:
        revoke_sessions.main([])
    assert excinfo.value.code == revoke_sessions.EXIT_USAGE


def test_unknown_username_does_not_revoke(db_url) -> None:
    username = f"revoke-{uuid.uuid4().hex[:8]}"
    _, tokens = _seed_owner(db_url, username)
    before = _active(db_url, tokens)
    assert revoke_sessions.main(["--username", "nobody"]) == revoke_sessions.EXIT_NOT_FOUND
    assert _active(db_url, tokens) == before, "站主不存在时必须一个都不撤"


def test_all_revokes_every_active_session_and_is_idempotent(db_url, capsys) -> None:
    username = f"revoke-{uuid.uuid4().hex[:8]}"
    _, tokens = _seed_owner(db_url, username)
    assert _active(db_url, tokens) == 2

    assert revoke_sessions.main(["--all"]) == revoke_sessions.EXIT_OK
    assert _active(db_url, tokens) == 0

    # 幂等：第二次没有可撤的
    capsys.readouterr()
    assert revoke_sessions.main(["--all", "--json"]) == revoke_sessions.EXIT_OK
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert summary["revoked"] == 0


def test_username_scope_only_touches_that_owner(db_url) -> None:
    username = f"revoke-{uuid.uuid4().hex[:8]}"
    user_id, tokens = _seed_owner(db_url, username)
    assert revoke_sessions.main(["--username", username]) == revoke_sessions.EXIT_OK

    engine = create_db_engine(db_url)
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        rows = list(session.execute(
            select(AdminSession).where(AdminSession.token_hash.in_(tokens))
        ).scalars())
        by_user = {row.user_id: row for row in rows}
        # `--username` 的语义：**只撤该站主自己的会话**；预登录会话（user_id 为 NULL）
        # 不属于任何站主，因此**不**被它撤销 —— 要清掉那种会话得用 `--all`。
        assert by_user[user_id].revoked_at is not None, "该站主的会话应被撤销"
        assert by_user[None].revoked_at is None, "预登录会话不属于任何站主，--username 不应动它"
    engine.dispose()


def test_output_never_leaks_tokens(db_url, capsys) -> None:
    username = f"revoke-{uuid.uuid4().hex[:8]}"
    _, tokens = _seed_owner(db_url, username)
    revoke_sessions.main(["--all", "--json"])
    printed = capsys.readouterr().out
    for token in tokens:
        assert token not in printed
    assert "token" not in printed.lower() or "revoked_at" in printed
