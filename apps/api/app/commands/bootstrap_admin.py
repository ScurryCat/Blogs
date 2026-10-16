"""初始化站主账号（05 §5.1）。

    uv run --project apps/api python -m app.commands.bootstrap_admin --username <名字>

规则：
  - **没有默认账号密码**：用户名必须显式给出，密码从交互式提示或 `--password-stdin` 读取。
  - 密码策略由 `core.passwords.password_policy_error` 统一校验（至少 12 个字符、不等于用户名）。
  - 已存在同名账号时**拒绝静默覆盖**：必须显式 `--reset-password` 才会改密码。
  - 输出只有用户名与 id，从不输出密码或哈希。
  - 重置走同一条受控运维路径（05 §5.1），没有自助重置接口。
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import create_db_engine, create_session_factory, database_name_of, session_scope
from app.core.passwords import hash_password, password_policy_error
from app.modules.auth import service
from app.modules.auth.models import USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_CONFLICT = 3


def _build_engine(settings: Settings) -> Engine:
    return create_db_engine(settings.database_url)


def read_password(*, from_stdin: bool) -> str:
    """读取密码。交互式要求输入两次并要求一致；stdin 模式只读一行。"""
    if from_stdin:
        line = sys.stdin.readline()
        if not line:
            raise ValueError("--password-stdin 没有读到内容")
        return line.rstrip("\n")
    first = getpass.getpass("新密码：")
    second = getpass.getpass("再输入一次：")
    if first != second:
        raise ValueError("两次输入的密码不一致")
    return first


def bootstrap(
    session: Session,
    *,
    username: str,
    password: str,
    reset_password: bool = False,
) -> tuple[bool, str]:
    """创建或重置站主。返回 (是否新建, 用户名)。

    只提交自己这一条记录，不做任何其他写入。
    """
    name = (username or "").strip()
    if not (USERNAME_MIN_LENGTH <= len(name) <= USERNAME_MAX_LENGTH):
        raise ValueError(f"用户名长度必须在 {USERNAME_MIN_LENGTH}–{USERNAME_MAX_LENGTH} 之间")
    policy_error = password_policy_error(password, username=name)
    if policy_error:
        raise ValueError(policy_error)

    existing = service.find_user(session, name)
    if existing is not None and not reset_password:
        raise FileExistsError(f"账号 {existing.username!r} 已存在；如确需改密码请加 --reset-password")
    if existing is not None:
        existing.password_hash = hash_password(password)
        session.commit()
        return False, existing.username

    user = service.create_admin(session, username=name, password_hash=hash_password(password))
    service.record_audit(
        session,
        action="admin.bootstrap",
        entity_type="admin_user",
        entity_id=user.id,
        actor_id=user.id,
        extra={"via": "cli"},
        commit=True,
    )
    return True, user.username


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.commands.bootstrap_admin",
        description="初始化 / 重置 PHANTOM LOG 站主账号（无默认密码）",
    )
    parser.add_argument("--username", required=True, help="站主用户名（3–64 字符）")
    parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="从标准输入读取密码（供受控自动化使用），默认交互式输入",
    )
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="账号已存在时重置其密码（默认拒绝覆盖）",
    )
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果摘要")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    try:
        password = read_password(from_stdin=args.password_stdin)
    except ValueError as exc:
        print(f"错误:{exc}", file=sys.stderr)
        return EXIT_USAGE

    engine = _build_engine(settings)
    factory = create_session_factory(engine)
    try:
        with session_scope(factory) as session:
            created, username = bootstrap(
                session,
                username=args.username,
                password=password,
                reset_password=args.reset_password,
            )
    except FileExistsError as exc:
        print(f"错误:{exc}", file=sys.stderr)
        return EXIT_CONFLICT
    except ValueError as exc:
        print(f"错误:{exc}", file=sys.stderr)
        return EXIT_USAGE
    finally:
        engine.dispose()

    # 只报告账号与目标库名（不含连接串、密码或哈希）。
    summary = {
        "username": username,
        "created": created,
        "password_reset": not created,
        "database": database_name_of(settings.database_url),
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        action = "已创建" if created else "已重置密码"
        print(f"{action}站主账号 {username}（库 {summary['database']}）")
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover - 入口
    raise SystemExit(main())
