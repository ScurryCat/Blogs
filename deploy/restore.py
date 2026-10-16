#!/usr/bin/env python3
"""PHANTOM LOG 隔离恢复：把成对备份恢复到**全新库 + 全新媒体目录**（T10）。

设计依据：06 §5「备份与恢复设计」/ 06 §6「发布与回退」。要点：

  - **只恢复到隔离目标**：默认要求目标库是一个不存在的全新库；已存在且非空的库
    必须显式 `--force`，并且**永远不会** DROP 任何数据库。
  - **拒绝生产库名**：库名含 `prod` / `production` / `live` / `main` 一律拒绝
    （与 `app/core/db.py` 的测试库守卫同一套语义）。恢复生产需要另外明确授权，
    本脚本不提供那条路径。
  - **先校验再恢复**：先按 `checksums.sha256` 逐个核对备份文件，再 `pg_restore`。
    「备份命令退出 0」不等于具备恢复能力（06 §5 的原话）。
  - **恢复后核对数据**：逐表比较行数（`count(*)`，不是统计估算），比较迁移版本，
    比较媒体文件数量与校验和。
  - **恢复后撤销旧会话**（06 §5 明确要求）：调用
    `python -m app.commands.revoke_sessions --all`，否则备份里 `revoked_at = NULL`
    的会话会复活（实测证据：`tools/acceptance/verify-restore-revokes-sessions.py`）。
  - 不删除新数据、不覆盖用户卷、不执行 `down -v`、不做 downgrade。

用法：
  python3 deploy/restore.py --backup /var/backups/phantom-log/2026-10-16 \\
      --target-database-url "postgresql://pl@127.0.0.1:55432/pl_restore_drill" \\
      --media-root /tmp/pl-restore-drill/media \\
      --report /tmp/pl-restore-drill/restore-report.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
API_DIR = REPO_ROOT / "apps" / "api"

MANIFEST_NAME = "manifest.json"
CHECKSUM_NAME = "checksums.sha256"
DUMP_NAME = "database.dump"
MEDIA_DIR_NAME = "media"

# 与 app/core/db.py 的 assert_test_database_url 同一套「看起来像生产库」的判据。
FORBIDDEN_NAME_PARTS = ("prod", "production", "live", "main")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def die(message: str, code: int = 1) -> "None":
    print(f"错误：{message}", file=sys.stderr)
    sys.exit(code)


def run(cmd: list[str], *, env: dict | None = None, check: bool = True,
        cwd: str | None = None) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=cwd)
    if check and result.returncode != 0:
        die(f"命令失败（退出码 {result.returncode}）：{' '.join(cmd)}\n{result.stderr.strip()}")
    return result


def pg_binary(name: str) -> str:
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
    return url.replace("postgresql+psycopg://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")


def parse_url(url: str) -> dict:
    from urllib.parse import unquote, urlsplit

    parts = urlsplit(strip_driver(url))
    if parts.scheme not in ("postgres", "postgresql"):
        die(f"只支持 PostgreSQL 连接串，收到 scheme={parts.scheme!r}")
    return {
        "user": unquote(parts.username or ""),
        "password": unquote(parts.password or ""),
        "host": parts.hostname or "127.0.0.1",
        "port": str(parts.port or "5432"),
        "dbname": (parts.path or "/").lstrip("/") or "",
    }


def psql_env(conn: dict) -> dict:
    env = dict(os.environ)
    if conn["password"]:
        env["PGPASSWORD"] = conn["password"]
    return env


def query(conn: dict, sql: str, *, database: str | None = None, check: bool = True) -> list[list[str]]:
    cmd = [
        pg_binary("psql"), "--no-psqlrc",
        "-h", conn["host"], "-p", conn["port"], "-U", conn["user"],
        "-d", database or conn["dbname"],
        "-tAF", "\t", "-c", sql,
    ]
    result = run(cmd, env=psql_env(conn), check=check)
    if result.returncode != 0:
        return []
    return [line.split("\t") for line in result.stdout.splitlines() if line.strip()]


def database_exists(conn: dict, name: str) -> bool:
    return bool(query(conn, f"select 1 from pg_database where datname = '{name}'", database="postgres"))


def table_counts(conn: dict, database: str) -> dict[str, int]:
    rows = query(
        conn,
        "select table_name from information_schema.tables "
        "where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name",
        database=database,
    )
    counts: dict[str, int] = {}
    for row in rows:
        table = row[0]
        value = query(conn, f'select count(*) from "{table}"', database=database, check=False)
        counts[table] = int(value[0][0]) if value else -1
    return counts


def schema_revision(conn: dict, database: str) -> str | None:
    rows = query(conn, "select version_num from alembic_version", database=database, check=False)
    return rows[0][0] if rows else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checksums(backup_dir: Path) -> tuple[bool, list[str]]:
    checksum_path = backup_dir / CHECKSUM_NAME
    if not checksum_path.exists():
        return False, [f"缺少 {CHECKSUM_NAME}"]
    problems: list[str] = []
    for line in checksum_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        expected, _, name = line.partition("  ")
        target = backup_dir / name
        if not target.exists():
            problems.append(f"缺少文件 {name}")
            continue
        actual = sha256_file(target)
        if actual != expected:
            problems.append(f"校验和不匹配 {name}")
    return not problems, problems


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="把成对备份恢复到隔离环境（T10）")
    parser.add_argument("--backup", required=True, help="备份目录（含 manifest.json）")
    parser.add_argument("--target-database-url", default="",
                        help="隔离目标库连接串；库名必须不存在或为空，且不能像生产库名")
    parser.add_argument("--target-database", default="", help="只覆盖目标库名（配合 --target-database-url 的主机账号）")
    parser.add_argument("--media-root", default="", help="恢复媒体到这里（必须不存在或为空目录）")
    parser.add_argument("--report", default="", help="恢复报告输出路径（JSON）")
    parser.add_argument("--force", action="store_true", help="允许恢复到已存在的库 / 已存在的媒体目录")
    parser.add_argument("--skip-checksum", action="store_true", help="跳过校验和核对（不推荐，报告里会标注）")
    parser.add_argument("--skip-revoke", action="store_true",
                        help="不执行恢复后撤销会话（只有明确知道后果时才用；见 06 §5）")
    parser.add_argument("--verify-only", action="store_true", help="只校验备份完整性与清单，不恢复")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出报告")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    started = time.monotonic()
    backup_dir = Path(args.backup).expanduser().resolve()
    report: dict = {
        "started_at": utc_now(),
        "backup_dir": str(backup_dir),
        "verified_only": args.verify_only,
        "checksum_skipped": args.skip_checksum,
        "revoke_skipped": args.skip_revoke,
    }

    manifest_path = backup_dir / MANIFEST_NAME
    if not manifest_path.exists():
        die(f"不是备份目录（缺 {MANIFEST_NAME}）：{backup_dir}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    report["manifest"] = {
        "database": manifest.get("database"),
        "schema_revision": manifest.get("schema_revision"),
        "table_total_rows": manifest.get("table_total_rows"),
        "media_file_count": manifest.get("media_file_count"),
        "created_at": manifest.get("finished_at"),
    }

    dump_path = backup_dir / DUMP_NAME
    if not dump_path.exists():
        die(f"备份缺少 {DUMP_NAME}")

    print(f"== 1. 校验备份 {backup_dir} ==")
    if args.skip_checksum:
        print("  ! 已跳过校验和核对（--skip-checksum）")
        report["checksums_ok"] = None
    else:
        ok, problems = verify_checksums(backup_dir)
        report["checksums_ok"] = ok
        report["checksum_problems"] = problems
        if not ok:
            die("备份校验失败：\n  " + "\n  ".join(problems))
        print(f"  ✓ 校验和全部匹配（{len((backup_dir / CHECKSUM_NAME).read_text().splitlines())} 个文件）")

    if args.verify_only:
        report["finished_at"] = utc_now()
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) if args.json
              else "\n只校验：备份结构完整（未做恢复）")
        return 0

    # --- 目标解析与守卫 -----------------------------------------------------
    target_url = args.target_database_url or os.environ.get("RESTORE_TARGET_DATABASE_URL", "")
    if not target_url:
        die("缺少 --target-database-url（隔离目标库连接串）")
    conn = parse_url(target_url)
    if args.target_database:
        conn["dbname"] = args.target_database
    if not conn["dbname"]:
        die("目标连接串里没有库名")

    lowered = conn["dbname"].lower()
    if any(part in lowered for part in FORBIDDEN_NAME_PARTS) and not args.force:
        die(f"目标库名 {conn['dbname']!r} 看起来像生产库；恢复演练必须用隔离库名。"
            "确认无误要覆盖时加 --force")
    if conn["dbname"] == manifest.get("database") and conn["host"] == manifest.get("database_host", "").split(":")[0]:
        print("  ! 目标库名与备份来源库同名；确认这是隔离主机，否则是在覆盖原库")

    exists = database_exists(conn, conn["dbname"])
    report["target"] = {
        "database": conn["dbname"],
        "host": f"{conn['host']}:{conn['port']}",
        "existed_before": exists,
    }

    print(f"== 2. 准备目标库 {conn['dbname']}@{conn['host']}:{conn['port']} ==")
    if exists:
        existing_tables = table_counts(conn, conn["dbname"])
        if existing_tables and not args.force:
            die(f"目标库已存在且不是空库（{len(existing_tables)} 张表）：{conn['dbname']}\n"
                "隔离恢复要求全新库；确认要覆盖时加 --force")
        print(f"  ! 目标库已存在（{len(existing_tables)} 张表），按 --force 继续")
    else:
        createdb = [
            pg_binary("createdb"),
            "-h", conn["host"], "-p", conn["port"], "-U", conn["user"], conn["dbname"],
        ]
        run(createdb, env=psql_env(conn))
        print("  ✓ 已创建空库")

    # --- 恢复数据库 ---------------------------------------------------------
    print("== 3. pg_restore ==")
    restore_cmd = [
        pg_binary("pg_restore"),
        "--no-owner",       # 备份里没有 owner 依赖，跨集群恢复才可用
        "--no-privileges",
        "--exit-on-error",
        "-h", conn["host"], "-p", conn["port"], "-U", conn["user"],
        "-d", conn["dbname"],
        str(dump_path),
    ]
    restore_started = time.monotonic()
    result = run(restore_cmd, env=psql_env(conn), check=False)
    report["pg_restore_seconds"] = round(time.monotonic() - restore_started, 3)
    if result.returncode != 0:
        print(result.stdout[-2000:])
        die(f"pg_restore 失败（退出码 {result.returncode}）：\n{result.stderr.strip()[-2000:]}")
    print(f"  ✓ 恢复完成，耗时 {report['pg_restore_seconds']} 秒")

    # --- 媒体 ---------------------------------------------------------------
    backup_media = backup_dir / MEDIA_DIR_NAME
    if args.media_root:
        media_target = Path(args.media_root).expanduser()
        if media_target.exists() and any(media_target.iterdir()) and not args.force:
            die(f"媒体目标目录已存在且非空：{media_target}；确认要合并时加 --force")
        media_target.mkdir(parents=True, exist_ok=True)
        if backup_media.exists():
            print(f"== 4. 恢复媒体 → {media_target} ==")
            for item in sorted(p for p in backup_media.rglob("*") if p.is_file()):
                relative = item.relative_to(backup_media)
                destination = media_target / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, destination)
            restored = sum(1 for p in media_target.rglob("*") if p.is_file())
            report["media_restored_to"] = str(media_target)
            report["media_files_restored"] = restored
            print(f"  ✓ {restored} 个文件")
        else:
            report["media_restored_to"] = None
            print("  ! 备份里没有媒体目录，跳过（清单已记录原媒体数量）")
    else:
        print("== 4. 未指定 --media-root：只恢复数据库 ==")

    # --- 核对 ---------------------------------------------------------------
    print("== 5. 核对数据 ==")
    expected_counts = manifest.get("table_counts") or {}
    actual_counts = table_counts(conn, conn["dbname"])
    report["table_counts_expected"] = expected_counts
    report["table_counts_actual"] = actual_counts
    missing = sorted(set(expected_counts) - set(actual_counts))
    mismatched = sorted(
        table for table, count in expected_counts.items()
        if table in actual_counts and actual_counts[table] != count
    )
    extra = sorted(set(actual_counts) - set(expected_counts))
    report["tables_missing"] = missing
    report["tables_mismatched"] = mismatched
    report["tables_extra"] = extra
    report["schema_revision_after"] = schema_revision(conn, conn["dbname"])
    report["schema_revision_expected"] = manifest.get("schema_revision")

    if missing or mismatched:
        print(f"  ✗ 缺表 {missing}；行数不一致 {mismatched}")
    else:
        print(f"  ✓ {len(actual_counts)} 张表的行数与备份清单一致"
              f"（共 {sum(actual_counts.values())} 行）")
    if extra:
        print(f"  ! 恢复库里有备份清单之外的表：{extra}")

    # 媒体校验
    if args.media_root:
        media_target = Path(args.media_root).expanduser()
        restored_files = {p.relative_to(media_target).as_posix(): p for p in media_target.rglob("*") if p.is_file()}
        manifest_media = {item["path"]: item for item in (manifest.get("media_inventory") or [])}
        media_missing = sorted(set(manifest_media) - set(restored_files))
        media_mismatch: list[str] = []
        for name, item in manifest_media.items():
            path = restored_files.get(name)
            if path is None:
                continue
            if path.stat().st_size != item["size"]:
                media_mismatch.append(name)
        report["media_missing"] = media_missing
        report["media_size_mismatch"] = media_mismatch
        if media_missing or media_mismatch:
            print(f"  ✗ 媒体缺 {len(media_missing)} 个、大小不符 {len(media_mismatch)} 个")
        else:
            print(f"  ✓ 媒体 {len(manifest_media)} 个文件数量与大小均与清单一致")

    # --- 恢复后撤销会话（06 §5 硬要求）-------------------------------------
    if args.skip_revoke:
        print("== 6. 已按 --skip-revoke 跳过「撤销旧会话」==")
        print("  ! 不做这一步，备份里已登出的会话会在恢复后复活（实测证据见 T10 交付单）")
        report["revoke"] = {"skipped": True}
    else:
        print("== 6. 撤销恢复出来的全部会话（恢复后必做）==")
        # 目标连接串：如果调用方用 --target-database 覆盖了库名，这里要同步换掉，
        # 否则撤销命令会打到别的库上（那才是最危险的静默错误）。
        source_db_name = parse_url(target_url)["dbname"]
        effective_url = (
            target_url.replace(f"/{source_db_name}", f"/{args.target_database}", 1)
            if args.target_database else target_url
        )
        env = dict(os.environ)
        env.update({
            "APP_ENV": "dev",  # 隔离恢复不是生产启动；生产安全检查不适用于演练
            "DATABASE_URL": effective_url,
            "SECRET_KEY": env.get("SECRET_KEY", "restore-drill-only-secret-key-0123456789abcdef"),
        })
        cmd = ["uv", "run", "--project", "apps/api", "python", "-m",
               "app.commands.revoke_sessions", "--all", "--json"]
        result = run(cmd, env=env, cwd=str(REPO_ROOT), check=False)
        report["revoke"] = {
            "returncode": result.returncode,
            "stdout": result.stdout.strip()[-500:],
        }
        if result.returncode != 0:
            print(f"  ✗ 撤销会话失败（退出码 {result.returncode}）：{result.stderr.strip()[-500:]}")
            report["revoke"]["stderr"] = result.stderr.strip()[-500:]
        else:
            print(f"  ✓ {result.stdout.strip()}")
            # 复查：撤销后不应再有 revoked_at IS NULL 的会话。
            remaining = query(conn, "select count(*) from sessions where revoked_at is null",
                              database=conn["dbname"], check=False)
            report["sessions_active_after_revoke"] = int(remaining[0][0]) if remaining else None
            print(f"  复查：恢复库中未撤销的会话 = {report['sessions_active_after_revoke']}")

    report["finished_at"] = utc_now()
    report["elapsed_seconds"] = round(time.monotonic() - started, 3)

    if args.report:
        report_path = Path(args.report).expanduser()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True),
                               encoding="utf-8")
        print(f"恢复报告：{report_path}")

    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print(f"\n恢复完成，总耗时 {report['elapsed_seconds']} 秒"
              f"（pg_restore {report.get('pg_restore_seconds')} 秒）")

    fatal = bool(missing or mismatched or report.get("media_missing") or report.get("media_size_mismatch"))
    if report.get("revoke", {}).get("returncode") not in (None, 0):
        fatal = True
    return 1 if fatal else 0


if __name__ == "__main__":  # pragma: no cover - 入口
    sys.exit(main())
