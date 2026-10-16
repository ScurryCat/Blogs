"""`python -m app.commands.bootstrap_admin` 的真实 CLI 测试（05 §5.1）。

断言的是 05 §5.1 的三条硬要求：
  - 初始化只能走部署期 CLI；
  - **没有默认账号密码**（必须显式提供用户名与密码，且密码要过策略）；
  - 输出里没有密码、哈希或连接串。
"""

from __future__ import annotations

import io
import json
import sys
import uuid

import pytest
from sqlalchemy import select

from app.commands import bootstrap_admin
from app.core.config import get_settings
from app.core.passwords import verify_password
from app.modules.auth import service as auth_service
from app.modules.auth.models import AdminUser, AuditEvent

PASSWORD = "t01-cli-strong-password-001"


@pytest.fixture()
def cli_environment(t01_database_url, monkeypatch):
    """把 CLI 的 DATABASE_URL 指向 T01 临时库，并在测试后恢复配置缓存。"""
    monkeypatch.setenv("DATABASE_URL", t01_database_url)
    monkeypatch.setenv("APP_ENV", "test")
    get_settings.cache_clear()
    yield t01_database_url
    get_settings.cache_clear()


def run_cli(monkeypatch, capsys, argv: list[str], password: str | None = None):
    """执行 CLI 并立即取走输出，返回 (退出码, stdout, stderr)。"""
    arguments = list(argv)
    if password is not None:
        monkeypatch.setattr(sys, "stdin", io.StringIO(password + "\n"))
        arguments.append("--password-stdin")
    exit_code = bootstrap_admin.main(arguments)
    captured = capsys.readouterr()
    return exit_code, captured.out, captured.err


def test_bootstrap_creates_admin_without_printing_secrets(
    cli_environment, t01_session, monkeypatch, capsys
):
    username = f"cli-owner-{uuid.uuid4().hex[:8]}"
    exit_code, out, err = run_cli(
        monkeypatch, capsys, ["--username", username, "--json"], password=PASSWORD
    )
    assert exit_code == 0
    payload = json.loads(out)
    assert payload["username"] == username
    assert payload["created"] is True
    assert payload["database"] == "pl_test_t01"
    # 输出里不得出现密码、哈希或连接串。
    for leaked in (PASSWORD, "argon2", "postgresql", "psycopg", "55432"):
        assert leaked not in out
        assert leaked not in err

    user = auth_service.find_user(t01_session, username)
    assert user is not None
    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    assert verify_password(PASSWORD, user.password_hash)


def test_bootstrap_refuses_to_overwrite_existing_account(
    cli_environment, t01_session, monkeypatch, capsys
):
    username = f"cli-dup-{uuid.uuid4().hex[:8]}"
    first, _, _ = run_cli(monkeypatch, capsys, ["--username", username], password=PASSWORD)
    assert first == 0

    exit_code, out, err = run_cli(
        monkeypatch, capsys, ["--username", username], password="another-strong-password-9"
    )
    assert exit_code == bootstrap_admin.EXIT_CONFLICT
    assert "已存在" in err
    assert out.strip() == ""

    # 原密码仍然有效（没有被静默覆盖）
    user = auth_service.find_user(t01_session, username)
    assert verify_password(PASSWORD, user.password_hash)


def test_bootstrap_reset_password_updates_hash(
    cli_environment, t01_session, monkeypatch, capsys
):
    username = f"cli-reset-{uuid.uuid4().hex[:8]}"
    assert run_cli(monkeypatch, capsys, ["--username", username], password=PASSWORD)[0] == 0
    before = auth_service.find_user(t01_session, username).password_hash

    new_password = "t01-cli-rotated-password-002"
    exit_code, out, err = run_cli(
        monkeypatch,
        capsys,
        ["--username", username, "--reset-password", "--json"],
        password=new_password,
    )
    assert exit_code == 0, err
    payload = json.loads(out)
    assert payload["created"] is False and payload["password_reset"] is True

    user = auth_service.find_user(t01_session, username)
    assert user.password_hash != before
    assert verify_password(new_password, user.password_hash)
    assert not verify_password(PASSWORD, user.password_hash)


@pytest.mark.parametrize(
    "bad_password,reason",
    [
        ("short", "至少"),
        ("cli-weak-owner", "不能与用户名相同"),
    ],
)
def test_bootstrap_enforces_password_policy(
    cli_environment, monkeypatch, capsys, bad_password, reason
):
    exit_code, _, err = run_cli(
        monkeypatch, capsys, ["--username", "cli-weak-owner"], password=bad_password
    )
    assert exit_code == bootstrap_admin.EXIT_USAGE
    assert reason in err


def test_bootstrap_rejects_invalid_username(cli_environment, monkeypatch, capsys):
    exit_code, _, err = run_cli(monkeypatch, capsys, ["--username", "ab"], password=PASSWORD)
    assert exit_code == bootstrap_admin.EXIT_USAGE
    assert "用户名长度" in err


def test_bootstrap_writes_audit_event(cli_environment, t01_session, monkeypatch, capsys):
    username = f"cli-audit-{uuid.uuid4().hex[:8]}"
    assert run_cli(monkeypatch, capsys, ["--username", username], password=PASSWORD)[0] == 0

    events = list(
        t01_session.execute(
            select(AuditEvent).where(AuditEvent.action == "admin.bootstrap")
        ).scalars()
    )
    assert events, "初始化站主必须留下审计事件"
    for event in events:
        assert "password" not in str(event.extra).lower()
    users = list(t01_session.execute(select(AdminUser)).scalars())
    assert any(user.username == username for user in users)
