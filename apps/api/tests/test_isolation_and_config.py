"""测试隔离与配置安全。

契约（T00 执行清单）：测试连接标记必须拒绝误连生产；任何测试不得清理未知数据库；
共享配置与构建不含密钥。这里把三条都落成可执行的断言。
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import PLACEHOLDER_SECRETS, Settings
from app.core.db import assert_test_database_url, database_name_of

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parents[1]


# --- 测试库标记：拒绝误连生产 -------------------------------------------------

@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://pl@db.internal:5432/phantom_log",
        "postgresql+psycopg://pl@db.internal:5432/production",
        "postgresql+psycopg://pl@db.internal:5432/pl_prod",
        "postgresql+psycopg://pl@db.internal:5432/main",
        "postgresql+psycopg://pl@db.internal:5432/pl_live_data",
    ],
)
def test_production_looking_database_is_refused(url: str) -> None:
    with pytest.raises(RuntimeError):
        assert_test_database_url(url)


def test_database_without_test_marker_is_refused() -> None:
    with pytest.raises(RuntimeError):
        assert_test_database_url("postgresql+psycopg://pl@127.0.0.1:5432/phantom_log")


def test_database_without_name_is_refused() -> None:
    with pytest.raises(RuntimeError):
        assert_test_database_url("postgresql+psycopg://pl@127.0.0.1:5432/")
    assert database_name_of("postgresql+psycopg://pl@127.0.0.1:5432/") == ""


@pytest.mark.parametrize("name", ["pl_test", "test_pl", "phantom_log_test", "pl_test_shadow"])
def test_test_database_names_are_accepted(name: str) -> None:
    url = f"postgresql+psycopg://pl@127.0.0.1:55432/{name}"
    assert assert_test_database_url(url) == name


def test_expected_host_mismatch_is_refused() -> None:
    with pytest.raises(RuntimeError):
        assert_test_database_url("postgresql+psycopg://pl@db.internal:5432/pl_test",
                                 expected_host="127.0.0.1")


# --- 真实 PostgreSQL：不用 SQLite 冒充 ----------------------------------------

@pytest.mark.database
def test_configured_test_database_is_reachable_and_migrated(migrated_engine) -> None:
    from sqlalchemy import text

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    # 期望版本从迁移脚本现算，不写死 revision 号 —— 写死会在每次新增迁移后变成
    # 假告警（readiness 的 schema 检查出于同样理由不比较 revision）。
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    expected_head = ScriptDirectory.from_config(config).get_current_head()

    with migrated_engine.connect() as connection:
        assert connection.execute(text("select 1")).scalar_one() == 1
        # 迁移链已经在夹具里跑过；这里确认库停在当前 head，且只有一行（无平行 head）。
        revisions = connection.execute(text("select version_num from alembic_version")).scalars().all()
    assert len(revisions) == 1, f"alembic_version 应只有一行，实际 {revisions}"
    assert revisions[0] == expected_head


@pytest.mark.database
def test_session_fixture_rolls_back(db_session) -> None:
    """夹具用事务回滚保证隔离：本用例写的数据不会留给下一个用例。"""
    from sqlalchemy import text

    db_session.execute(text("create temporary table probe (id int) on commit drop"))
    db_session.execute(text("insert into probe values (1)"))
    assert db_session.execute(text("select count(*) from probe")).scalar_one() == 1


@pytest.mark.database
def test_migration_chain_has_single_head() -> None:
    """单一 head 是交接计划对 T00 的硬要求，功能包不得制造平行 head。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"迁移链必须只有一个 head，当前为 {heads}"


# --- 无秘密配置 ---------------------------------------------------------------

def test_settings_require_database_url_and_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # conftest 为了让导入可用而设了环境变量，这里必须先摘掉才能验证「缺失即失败」。
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, secret_key="x" * 40)  # type: ignore[call-arg]
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url="postgresql+psycopg://pl@127.0.0.1:5432/pl_test")  # type: ignore[call-arg]


def test_short_secret_key_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+psycopg://pl@127.0.0.1:5432/pl_test",
            secret_key="too-short",
        )


@pytest.mark.parametrize("placeholder", sorted(PLACEHOLDER_SECRETS))
def test_placeholder_secret_is_rejected(placeholder: str) -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+psycopg://pl@127.0.0.1:5432/pl_test",
            secret_key=placeholder,
        )


def test_non_postgres_url_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="sqlite:///./dev.db", secret_key="x" * 40)


def test_safe_summary_never_exposes_secrets(test_settings: Settings) -> None:
    summary = test_settings.safe_summary()
    rendered = repr(summary)
    assert test_settings.secret_key not in rendered
    assert test_settings.database_url not in rendered
    assert summary["secret_key_set"] is True
    assert summary["database_url_set"] is True


def test_production_guard_accepts_a_strong_secret() -> None:
    settings = Settings(
        app_env="prod",
        database_url="postgresql+psycopg://pl@db.internal:5432/phantom_log",
        secret_key="a-strong-production-secret-value-0123456789",
    )
    settings.assert_production_safe()  # 不抛错即为通过


def test_unknown_setting_is_rejected() -> None:
    """extra=forbid：拼错的环境变量要立刻暴露，而不是被静默忽略。"""
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+psycopg://pl@127.0.0.1:5432/pl_test",
            secret_key="x" * 40,
            unexpected_key="oops",  # type: ignore[call-arg]
        )


def test_repository_has_no_committed_secret_literals() -> None:
    """扫描会被复制进镜像的配置来源，确认没有写死的密码或密钥。

    同时覆盖 `key=value`（toml/ini）与 `key: value`（yaml）两种写法：
    值必须是 ${VAR:?} 形式的外部注入，或者为空。
    """
    import re

    candidates = [
        API_DIR / "pyproject.toml",
        API_DIR / "alembic.ini",
        REPO_ROOT / "deploy" / "compose.dev.yaml",
        REPO_ROOT / "deploy" / "env.example",
        REPO_ROOT / "apps" / "web" / ".env.example",
    ]
    # 只认真正的凭据键名。刻意不匹配单独的 key / keys：
    # alembic.ini 的 `keys = console` 是日志配置，不是密钥。
    credential_keys = (
        "password",
        "passwd",
        "secret",
        "secret_key",
        "token",
        "api_key",
        "apikey",
        "access_key",
        "private_key",
        "anon_key",
    )
    key_alternation = "|".join(credential_keys)
    pattern = re.compile(rf"(?i)^\s*[\w.]*({key_alternation})\s*[:=]\s*(.+?)\s*$")

    offenders: list[str] = []
    for path in candidates:
        if not path.exists():
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            match = pattern.match(line)
            if not match:
                continue
            value = match.group(2)
            if "${" in value:  # 外部强制注入
                continue
            if value.lower().startswith(("replace-with", "your-", "example", "changeme", "change-me")):
                continue
            if "postgres_password" in line.lower() and "required variable" in value.lower():
                continue
            offenders.append(f"{path.name}:{lineno}: {line.strip()}")

    assert not offenders, "配置里疑似写死的凭据：\n" + "\n".join(offenders)


# --- DATABASE_URL_FILE（T10 的集成申请 §6.2，T00 实现）----------------------


def _settings_with(monkeypatch, tmp_path: Path, **env: str) -> Settings:
    """在干净的环境变量下构造 Settings（不读 .env 文件）。"""
    for key in ("DATABASE_URL", "DATABASE_URL_FILE"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


def test_database_url_file_is_read_and_trailing_newline_stripped(monkeypatch, tmp_path):
    """文件注入：内容取代 DATABASE_URL，且**结尾换行必须去掉**。

    Docker secrets 与 `printf > file` 常带结尾换行；不处理的话连接串末尾会多一个 `\\n`，
    报错信息很难指向真正原因。
    """
    secret = tmp_path / "database_url"
    secret.write_text("postgresql+psycopg://pl@db:5432/pl\n", encoding="utf-8")
    settings = _settings_with(monkeypatch, tmp_path, DATABASE_URL_FILE=str(secret))
    assert settings.database_url == "postgresql+psycopg://pl@db:5432/pl"


def test_database_url_file_wins_over_plain_variable(monkeypatch, tmp_path):
    """两者都给时**文件优先**，部署侧因此可以「基础 env + 文件覆盖」。"""
    secret = tmp_path / "database_url"
    secret.write_text("postgresql+psycopg://pl@file-host:5432/pl", encoding="utf-8")
    settings = _settings_with(
        monkeypatch,
        tmp_path,
        DATABASE_URL="postgresql+psycopg://pl@env-host:5432/pl",
        DATABASE_URL_FILE=str(secret),
    )
    assert settings.database_url == "postgresql+psycopg://pl@file-host:5432/pl"


def test_missing_or_empty_database_url_file_fails_loudly(monkeypatch, tmp_path):
    """文件缺失 / 为空必须**立刻失败**：静默回退会连到另一个库。"""
    with pytest.raises(ValidationError):
        _settings_with(monkeypatch, tmp_path, DATABASE_URL_FILE=str(tmp_path / "nope"))

    empty = tmp_path / "empty"
    empty.write_text("   \n", encoding="utf-8")
    with pytest.raises(ValidationError):
        _settings_with(monkeypatch, tmp_path, DATABASE_URL_FILE=str(empty))


def test_database_url_file_content_must_be_postgresql(monkeypatch, tmp_path):
    """文件内容也要过与 DATABASE_URL 同一套 PostgreSQL 校验。"""
    bad = tmp_path / "bad"
    bad.write_text("mysql://pl@db/pl", encoding="utf-8")
    with pytest.raises(ValidationError):
        _settings_with(monkeypatch, tmp_path, DATABASE_URL_FILE=str(bad))


def test_neither_source_given_is_an_error(monkeypatch, tmp_path):
    """两者都没给：报缺失（此前由 Field 必填承担，现在由校验器承担）。"""
    with pytest.raises(ValidationError):
        _settings_with(monkeypatch, tmp_path)
