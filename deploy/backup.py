#!/usr/bin/env python3
"""PHANTOM LOG 成对备份：PostgreSQL 逻辑备份 + 媒体文件 + 校验清单（T10）。

设计依据：06 §5「备份与恢复设计」。要点逐条落地：

  - 备份是**成对**的：只备份数据库或只备份媒体文件都不算可恢复的备份。
  - `pg_dump` 用 **custom 格式**（`-Fc`），并记录数据库名与迁移版本（alembic revision）。
  - 媒体文件与校验和（SHA-256）一起进清单；恢复时按清单逐个核对。
  - 备份目录**不覆盖**：目标目录已存在且非空时直接拒绝，除非显式 `--force`
    （06 §6：不能发现失败就悄悄覆盖）。
  - 只在**目标目录**里写东西；不删除、不移动、不覆盖任何其他路径。
  - `--dry-run` 只打印计划与预估体积，不写任何文件。

本脚本**不**做数据库以外的破坏性动作：没有 `DROP`、没有 `down -v`、不碰卷。

用法：
  python3 deploy/backup.py --database-url "postgresql://pl@127.0.0.1:55432/pl" \\
      --media-root apps/api/var/media --out /tmp/pl-backup --dry-run
  python3 deploy/backup.py --database-url "$DATABASE_URL" \\
      --media-root /var/lib/phantom-log/media --out /var/backups/phantom-log/2026-10-16

环境变量（可代替命令行参数）：
  DATABASE_URL     数据库连接串（去掉 `+psycopg` 之类的驱动后缀后交给 pg_dump）
  MEDIA_ROOT       媒体根目录
  PL_BACKUP_DIR    默认备份根目录
  PG_BIN           放 pg_dump / psql 的目录（默认从 PATH 找）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

MANIFEST_NAME = "manifest.json"
CHECKSUM_NAME = "checksums.sha256"
DUMP_NAME = "database.dump"
MEDIA_DIR_NAME = "media"

# pg_restore / pg_dump 的 custom 格式需要版本足够接近的服务端；这里只做提示不阻断。
DEFAULT_PG_PORT = "5432"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def die(message: str, code: int = 1) -> "None":
    print(f"错误：{message}", file=sys.stderr)
    sys.exit(code)


def run(cmd: list[str], *, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if check and result.returncode != 0:
        die(f"命令失败（退出码 {result.returncode}）：{' '.join(cmd)}\n{result.stderr.strip()}")
    return result


def pg_binary(name: str) -> str:
    """找 pg_dump / pg_restore / psql / createdb。"""
    prefix = os.environ.get("PG_BIN")
    if prefix:
        candidate = Path(prefix) / name
        if candidate.exists():
            return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    die(f"找不到 {name}；设置 PG_BIN 指向 PostgreSQL 的 bin 目录")
    raise AssertionError("unreachable")


def strip_driver(url: str) -> str:
    """`postgresql+psycopg://…` → `postgresql://…`（pg_dump 不认 SQLAlchemy 驱动后缀）。"""
    return url.replace("postgresql+psycopg://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")


def parse_url(url: str) -> dict:
    """从连接串里取出纯连接参数，交给 pg_dump 的 `--dbname` 使用。"""
    from urllib.parse import unquote, urlsplit

    parts = urlsplit(strip_driver(url))
    if parts.scheme not in ("postgres", "postgresql"):
        die(f"只支持 PostgreSQL 连接串，收到 scheme={parts.scheme!r}")
    return {
        "user": unquote(parts.username or ""),
        "password": unquote(parts.password or ""),
        "host": parts.hostname or "127.0.0.1",
        "port": str(parts.port or DEFAULT_PG_PORT),
        "dbname": (parts.path or "/").lstrip("/") or "",
    }


def psql_env(conn: dict) -> dict:
    env = dict(os.environ)
    if conn["password"]:
        env["PGPASSWORD"] = conn["password"]
    # 备份与恢复都不记录密码到文件。
    return env


def query(conn: dict, sql: str, *, database: str | None = None, check: bool = True) -> list[list[str]]:
    cmd = [
        pg_binary("psql"),
        "--no-psqlrc",
        "-h", conn["host"],
        "-p", conn["port"],
        "-U", conn["user"],
        "-d", database or conn["dbname"],
        "-tAF", "\t",
        "-c", sql,
    ]
    result = run(cmd, env=psql_env(conn), check=check)
    if result.returncode != 0:
        return []
    rows = [line.split("\t") for line in result.stdout.splitlines() if line.strip()]
    return rows


def database_exists(conn: dict, name: str) -> bool:
    rows = query(conn, f"select 1 from pg_database where datname = '{name}'", database="postgres")
    return bool(rows)


def table_inventory(conn: dict, database: str) -> dict:
    """数据库里的用户表 + 每张表的精确行数（`count(*)`，不用统计估算值）。"""
    rows = query(
        conn,
        "select table_name from information_schema.tables "
        "where table_schema = current_schema() and table_type = 'BASE TABLE' "
        "order by table_name",
        database=database,
    )
    tables = [row[0] for row in rows]
    counts: dict[str, int] = {}
    for table in tables:
        # 表名来自 information_schema，不是用户输入；仍用标识符引号包一层。
        value = query(conn, f'select count(*) from "{table}"', database=database)
        counts[table] = int(value[0][0]) if value else 0
    return counts


def schema_revision(conn: dict, database: str) -> str | None:
    """当前迁移版本（alembic_version 只有一行；多行 = 平行 head，由 readiness 检查发现）。"""
    rows = query(conn, "select version_num from alembic_version", database=database, check=False)
    return rows[0][0] if rows else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dir_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


def git_revision() -> dict:
    info = {"commit": None, "dirty": None}
    try:
        commit = run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], check=False)
        if commit.returncode == 0:
            info["commit"] = commit.stdout.strip()
        status = run(["git", "-C", str(REPO_ROOT), "status", "--porcelain"], check=False)
        if status.returncode == 0:
            info["dirty"] = bool(status.stdout.strip())
    except Exception:  # pragma: no cover - git 不可用不该让备份失败
        pass
    return info


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="成对备份 PostgreSQL + 媒体文件（T10）")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""),
                        help="数据库连接串（默认取 DATABASE_URL）")
    parser.add_argument("--media-root", default=os.environ.get("MEDIA_ROOT", ""),
                        help="媒体根目录（默认取 MEDIA_ROOT）")
    parser.add_argument("--out", default="",
                        help="备份输出目录（默认 PL_BACKUP_DIR/backup-<UTC 时间戳>）")
    parser.add_argument("--label", default="", help="写进清单的备注，便于人工辨认")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划与体积，不写文件")
    parser.add_argument("--force", action="store_true", help="允许写入已存在的非空输出目录")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果摘要")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    started = time.monotonic()

    if not args.database_url:
        die("缺少 --database-url（或 DATABASE_URL）")
    conn = parse_url(args.database_url)
    if not conn["dbname"]:
        die("连接串里没有数据库名")

    media_root = Path(args.media_root).expanduser() if args.media_root else None
    if media_root is not None and not media_root.exists():
        die(f"媒体根目录不存在：{media_root}（缺失的媒体目录不等于空媒体库，必须显式确认）")

    out_dir = Path(args.out).expanduser() if args.out else Path(
        os.environ.get("PL_BACKUP_DIR", str(REPO_ROOT / "deploy" / "backups"))
    ) / f"backup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"

    # --- 计划与前置检查 -----------------------------------------------------
    summary: dict = {
        "started_at": utc_now(),
        "database": conn["dbname"],
        "database_host": f"{conn['host']}:{conn['port']}",
        "media_root": str(media_root) if media_root else None,
        "output_dir": str(out_dir),
        "dry_run": args.dry_run,
        "label": args.label,
    }

    if out_dir.exists() and any(out_dir.iterdir()) and not args.force:
        die(f"输出目录已存在且非空：{out_dir}\n拒绝覆盖；换一个 --out，或在确认后加 --force")

    version = run([pg_binary("pg_dump"), "--version"], check=False)
    summary["pg_dump_version"] = (version.stdout or version.stderr).strip()

    tables_before = table_inventory(conn, conn["dbname"])
    summary["schema_revision"] = schema_revision(conn, conn["dbname"])
    summary["table_counts"] = tables_before
    summary["table_total_rows"] = sum(tables_before.values())

    media_files: list[dict] = []
    if media_root is not None:
        for item in sorted(p for p in media_root.rglob("*") if p.is_file()):
            relative = item.relative_to(media_root).as_posix()
            media_files.append({"path": relative, "size": item.stat().st_size})
    summary["media_file_count"] = len(media_files)
    summary["media_total_bytes"] = sum(item["size"] for item in media_files)
    summary["media_inventory"] = media_files

    free = shutil.disk_usage(out_dir.parent if out_dir.parent.exists() else Path.cwd()).free
    estimated = summary["media_total_bytes"] + max(1, summary["table_total_rows"]) * 1024
    summary["free_bytes_at_target"] = free
    summary["estimated_bytes"] = estimated

    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
        print("\n（--dry-run：没有写入任何文件）", file=sys.stderr)
        return 0

    if free < estimated:
        die(f"目标磁盘可用空间不足：需要约 {estimated} 字节，可用 {free} 字节")

    # --- 1. 数据库逻辑备份 --------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    dump_path = out_dir / DUMP_NAME
    dump_cmd = [
        pg_binary("pg_dump"),
        "-Fc",  # custom 格式：pg_restore 可选对象、并行、失败可续
        "--no-owner",  # 不写 owner：跨集群恢复时角色名可能不同（06 §5）
        "--no-privileges",
        "-h", conn["host"],
        "-p", conn["port"],
        "-U", conn["user"],
        "-d", conn["dbname"],
        "-f", str(dump_path),
    ]
    run(dump_cmd, env=psql_env(conn))
    if not dump_path.exists() or dump_path.stat().st_size == 0:
        die("pg_dump 没有生成有效备份文件")
    dump_path.chmod(0o600)
    summary["dump_bytes"] = dump_path.stat().st_size

    # --- 2. 媒体文件 --------------------------------------------------------
    if media_root is not None:
        target_media = out_dir / MEDIA_DIR_NAME
        shutil.copytree(media_root, target_media, symlinks=False)

    # --- 3. 校验和清单 ------------------------------------------------------
    entries: list[tuple[str, str]] = []
    for path in sorted(p for p in out_dir.rglob("*") if p.is_file()):
        entries.append((path.relative_to(out_dir).as_posix(), sha256_file(path)))
    checksum_path = out_dir / CHECKSUM_NAME
    checksum_path.write_text(
        "".join(f"{digest}  {name}\n" for name, digest in entries), encoding="utf-8"
    )
    summary["checksum_entries"] = len(entries)

    summary["finished_at"] = utc_now()
    summary["elapsed_seconds"] = round(time.monotonic() - started, 3)
    summary["git"] = git_revision()
    summary["host"] = {"hostname": socket.gethostname(), "platform": platform.platform()}

    manifest_path = out_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True),
                             encoding="utf-8")
    manifest_path.chmod(0o600)

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print(f"备份完成：{out_dir}")
        print(f"  数据库 {conn['dbname']}@{conn['host']}:{conn['port']}"
              f"  迁移版本 {summary['schema_revision']}")
        print(f"  表 {len(tables_before)} 张 / {summary['table_total_rows']} 行"
              f"  → {DUMP_NAME} {summary['dump_bytes']} 字节")
        print(f"  媒体 {summary['media_file_count']} 个 / {summary['media_total_bytes']} 字节")
        print(f"  校验清单 {summary['checksum_entries']} 条（{CHECKSUM_NAME}）")
        print(f"  耗时 {summary['elapsed_seconds']} 秒")
    return 0


if __name__ == "__main__":  # pragma: no cover - 入口
    sys.exit(main())
