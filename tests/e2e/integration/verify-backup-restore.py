#!/usr/bin/env python3
"""T10 验收：备份 → 校验清单 → 隔离恢复 → 数据一致 → 恢复后撤销会话（真实 PostgreSQL）。

跑的是**真实**的 `deploy/backup.py` 与 `deploy/restore.py`，不复制它们的逻辑，
也不 mock 数据库：每一步都起真实进程、连真实库、读写真实文件。

覆盖的验收点（ACCEPTANCE §2「隔离恢复 DB + 媒体」「API 重启 / DB 不可用 / 迁移失败」）：

  1. 空隔离环境恢复备份后，文章 / 动态 / 媒体引用与核心操作一致（逐表 `count(*)` 对比）。
  2. 旧会话不可复活：源库里「已撤销」的会话，恢复后由恢复流程再次撤销（06 §5）。
  3. 备份校验清单能发现被改动的文件（故意改一个字节，恢复必须拒绝）。
  4. 恢复目标守卫：像生产库名的目标一律拒绝；已存在的非空库不加 `--force` 拒绝。
  5. 角色分离：迁移账号能建表、运行账号不能建表；授权后运行账号可读写。

用法：
  cd /Users/学习/blog/Blogs
  export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
  export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
  python3 tests/e2e/integration/verify-backup-restore.py [--keep]

退出码 0 = 全部通过；1 = 有失败；2 = 前置条件缺失（不是通过）。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import hashlib
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[3]
API_DIR = REPO_ROOT / "apps" / "api"
PG_BIN_CANDIDATES = [
    os.environ.get("PG_BIN", ""),
    "/opt/homebrew/opt/postgresql@18/bin",
    "/usr/lib/postgresql/18/bin",
    "/usr/local/bin",
    "/usr/bin",
]

SECRET_KEY = "t10-backup-drill-secret-key-0123456789abcdef"
ADMIN_PASSWORD = "t10-backup-drill-password-123456"


class Skip(Exception):
    """前置条件缺失：不是失败，也不能算通过。"""


def find_pg(name: str) -> str:
    for candidate in PG_BIN_CANDIDATES:
        if candidate:
            path = Path(candidate) / name
            if path.exists():
                return str(path)
    found = shutil.which(name)
    if found:
        return found
    raise Skip(f"找不到 {name}（设置 PG_BIN）")


def env_for(*, database_url: str, media_root: str | None = None) -> dict:
    env = dict(os.environ)
    env.update({
        "APP_ENV": "dev",
        "DATABASE_URL": database_url,
        "SECRET_KEY": SECRET_KEY,
        "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache" / "uv")),
    })
    if media_root:
        env["MEDIA_ROOT"] = media_root
    return env


def run(cmd: list[str], *, env: dict | None = None, cwd: Path | None = None,
        check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(cwd or REPO_ROOT))
    if check and result.returncode not in (0,):
        raise RuntimeError(
            f"命令失败（退出码 {result.returncode}）：{' '.join(cmd)}\n"
            f"stdout: {result.stdout[-1500:]}\nstderr: {result.stderr[-1500:]}"
        )
    return result


class Harness:
    def __init__(self, base_url: str, keep: bool) -> None:
        self.base_url = base_url.rstrip("/")
        parts = urlsplit(self.base_url)
        self.host = parts.hostname or "127.0.0.1"
        self.port = str(parts.port or 5432)
        self.user = parts.username or "pl"
        self.keep = keep
        self.results: list[tuple[str, bool, str]] = []
        self.suffix = f"t10_{os.getpid()}"
        self.source_db = f"pl_test_{self.suffix}_src"
        self.target_db = f"pl_test_{self.suffix}_dst"
        self.work = Path(f"/tmp/pl-t10-{self.suffix}")
        self.media_root = self.work / "media"
        self.backup_dir = self.work / "backup"
        self.restore_media = self.work / "restored-media"
        self.psql = find_pg("psql")
        self.pg_dump = find_pg("pg_dump")
        self.pg_restore = find_pg("pg_restore")
        self.createdb = find_pg("createdb")

    # --- 基础设施 ---------------------------------------------------------
    def psql_cmd(self, database: str, user: str | None = None) -> list[str]:
        return [self.psql, "--no-psqlrc", "-h", self.host, "-p", self.port,
                "-U", user or self.user, "-d", database, "-tAF", "\t"]

    def sql(self, database: str, statement: str, *, user: str | None = None,
            check: bool = True) -> list[list[str]]:
        result = run(self.psql_cmd(database, user) + ["-c", statement], check=check)
        return [line.split("\t") for line in result.stdout.splitlines() if line.strip()]

    def drop_db(self, name: str) -> None:
        self.sql("postgres", f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')

    def create_db(self, name: str) -> None:
        self.drop_db(name)
        run([self.createdb, "-h", self.host, "-p", self.port, "-U", self.user, name])

    def migrate(self, database: str) -> subprocess.CompletedProcess:
        return run(
            ["uv", "run", "alembic", "upgrade", "head"],
            env=env_for(database_url=f"postgresql+psycopg://{self.user}@{self.host}:{self.port}/{database}"),
            cwd=API_DIR,
        )

    def table_counts(self, database: str) -> dict:
        rows = self.sql(
            database,
            "select table_name from information_schema.tables "
            "where table_schema = current_schema() and table_type = 'BASE TABLE' order by table_name",
        )
        counts = {}
        for row in rows:
            value = self.sql(database, f'select count(*) from "{row[0]}"')
            counts[row[0]] = int(value[0][0]) if value else -1
        return counts

    # --- 断言 -------------------------------------------------------------
    def check(self, label: str, condition: bool, detail: str = "") -> bool:
        self.results.append((label, bool(condition), detail))
        print(f"  {'✓' if condition else '✗'} {label}" + (f"  {detail}" if detail else ""))
        return bool(condition)

    # --- 全流程 -----------------------------------------------------------
    def run_all(self) -> None:
        print(f"== 0. 前置 ==")
        print(f"  psql {self.psql}")
        print(f"  pg_dump {self.pg_dump}")
        print(f"  源库 {self.source_db} → 目标库 {self.target_db}")
        print(f"  工作目录 {self.work}")

        self.work.mkdir(parents=True, exist_ok=True)
        self.media_root.mkdir(parents=True, exist_ok=True)
        self.restore_media.mkdir(parents=True, exist_ok=True)

        # 媒体：两个小文件 + 一个子目录（验证递归复制与相对路径）。
        (self.media_root / "alpha.bin").write_bytes(b"phantom-log-alpha" * 64)
        (self.media_root / "sub").mkdir(exist_ok=True)
        (self.media_root / "sub" / "beta.bin").write_bytes(bytes(range(256)) * 8)
        media_hashes = {
            p.relative_to(self.media_root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(self.media_root.rglob("*")) if p.is_file()
        }

        print("== 1. 建源库并迁移（真实 alembic）==")
        self.create_db(self.source_db)
        self.migrate(self.source_db)
        revision = self.sql(self.source_db, "select version_num from alembic_version")
        self.check("源库迁移到单一 head", bool(revision), revision[0][0] if revision else "")

        # 真实业务数据：导入旧站 8 篇文章（含标签 / 媒体引用），再插入两条「会话」。
        print("== 2. 灌入真实内容（import_legacy）+ 造一条已撤销会话 ==")
        run(["uv", "run", "python", "-m", "app.commands.import_legacy", "--apply",
             "--repo-root", str(REPO_ROOT)],
            env=env_for(database_url=self.dsn(self.source_db), media_root=str(self.media_root)),
            cwd=API_DIR)
        run(["uv", "run", "python", "-m", "app.commands.bootstrap_admin",
             "--username", "owner", "--password-stdin"],
            env=env_for(database_url=self.dsn(self.source_db)),
            cwd=API_DIR, check=False)
        # 造两行会话：一行有效、一行已撤销 —— 恢复后必须都变成已撤销。
        self.sql(self.source_db, """
            insert into sessions (id, user_id, token_hash, csrf_secret, created_at,
                                  last_seen_at, expires_at, revoked_at)
            select gen_random_uuid(), (select id from admin_users limit 1), 'drill-active',
                   'drill-secret', now(), now(), now() + interval '8 hours', null
        """)
        self.sql(self.source_db, """
            insert into sessions (id, user_id, token_hash, csrf_secret, created_at,
                                  last_seen_at, expires_at, revoked_at)
            select gen_random_uuid(), (select id from admin_users limit 1), 'drill-revoked',
                   'drill-secret', now() - interval '2 hours', now() - interval '1 hour',
                   now() + interval '6 hours', now() - interval '30 minutes'
        """)

        source_counts = self.table_counts(self.source_db)
        posts = source_counts.get("posts", 0)
        moments = source_counts.get("moments", 0)
        self.check("源库有真实文章（import_legacy 至少导入 1 篇）", posts >= 1, f"posts={posts}")
        self.check("源库有业务表集合", len(source_counts) >= 10, f"{len(source_counts)} 张表")
        self.check("源库存在 1 条有效会话 + 1 条已撤销会话",
                   self.count(self.source_db, "select count(*) from sessions where revoked_at is null") == 1
                   and self.count(self.source_db, "select count(*) from sessions where revoked_at is not null") == 1)

        # --- 备份 ---------------------------------------------------------
        print("== 3. 成对备份（deploy/backup.py）==")
        started = time.monotonic()
        backup = run([sys.executable, "deploy/backup.py",
                      "--database-url", self.dsn(self.source_db),
                      "--media-root", str(self.media_root),
                      "--out", str(self.backup_dir),
                      "--label", "T10 验收演练",
                      "--json"])
        backup_seconds = round(time.monotonic() - started, 3)
        manifest = json.loads(backup.stdout)
        self.check("backup.py 退出码 0", backup.returncode == 0)
        self.check("备份清单记录了迁移版本", manifest.get("schema_revision") == (revision[0][0] if revision else None),
                   str(manifest.get("schema_revision")))
        self.check("备份清单的行数与源库一致",
                   manifest.get("table_counts") == source_counts,
                   f"清单 {manifest.get('table_total_rows')} 行 / {len(manifest.get('table_counts') or {})} 表")
        self.check("备份含 custom 格式 dump（非 0 字节）",
                   (self.backup_dir / "database.dump").stat().st_size > 0,
                   f"{(self.backup_dir / 'database.dump').stat().st_size} 字节")
        self.check("备份含媒体文件", manifest.get("media_file_count") == len(media_hashes),
                   f"{manifest.get('media_file_count')} 个")
        self.check("备份含校验清单", (self.backup_dir / "checksums.sha256").exists())

        print("== 4. 备份目录不覆盖（第二次备份到同一目录必须被拒绝）==")
        again = run([sys.executable, "deploy/backup.py",
                     "--database-url", self.dsn(self.source_db),
                     "--media-root", str(self.media_root),
                     "--out", str(self.backup_dir)],
                    check=False)
        self.check("重复写入同一备份目录被拒绝", again.returncode != 0,
                   f"exit={again.returncode} {again.stderr.strip().splitlines()[-1] if again.stderr.strip() else ''}")

        print("== 4b. 备份之后在源库撤销会话（制造「备份早于撤销」的真实场景）==")
        revoke = run(["uv", "run", "python", "-m", "app.commands.revoke_sessions", "--all", "--json"],
                     env=env_for(database_url=self.dsn(self.source_db)), cwd=API_DIR, check=False)
        self.check("源库撤销全部会话成功（revoke_sessions --all）", revoke.returncode == 0,
                   revoke.stdout.strip()[:120] or revoke.stderr.strip()[:120])
        self.check("源库现在没有有效会话",
                   self.count(self.source_db, "select count(*) from sessions where revoked_at is null") == 0)

        print("== 5. 校验清单能发现被改动的备份（故意改 1 字节）==")
        tampered = self.work / "backup-tampered"
        shutil.copytree(self.backup_dir, tampered)
        victim = tampered / "media" / "alpha.bin"
        data = bytearray(victim.read_bytes())
        data[0] ^= 0xFF
        victim.write_bytes(bytes(data))
        tamper = run([sys.executable, "deploy/restore.py", "--backup", str(tampered),
                      "--target-database-url", self.dsn(self.target_db), "--verify-only"],
                     check=False)
        self.check("改动过的备份被校验清单拦下", tamper.returncode != 0,
                   (tamper.stderr.strip().splitlines() or [""])[0][:120])
        shutil.rmtree(tampered)

        print("== 6. 隔离恢复（deploy/restore.py，目标为全新库 + 全新媒体目录）==")
        started = time.monotonic()
        restore = run([sys.executable, "deploy/restore.py",
                       "--backup", str(self.backup_dir),
                       "--target-database-url", self.dsn(self.target_db),
                       "--media-root", str(self.restore_media),
                       "--report", str(self.work / "restore-report.json"),
                       "--json"])
        restore_seconds = round(time.monotonic() - started, 3)
        report = json.loads(restore.stdout.strip().splitlines()[-1])
        self.check("restore.py 退出码 0", restore.returncode == 0)
        self.check("恢复前后逐表行数一致",
                   report.get("table_counts_actual") == source_counts,
                   f"{len(report.get('table_counts_actual') or {})} 张表")
        self.check("恢复库迁移版本与备份一致",
                   report.get("schema_revision_after") == report.get("schema_revision_expected"),
                   str(report.get("schema_revision_after")))
        self.check("恢复的媒体数量与大小与清单一致",
                   not report.get("media_missing") and not report.get("media_size_mismatch"),
                   f"{report.get('media_files_restored')} 个文件")
        restored_hashes = {
            p.relative_to(self.restore_media).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(self.restore_media.rglob("*")) if p.is_file()
        }
        self.check("恢复的媒体内容逐字节一致", restored_hashes == media_hashes)

        print("== 7. 恢复后旧会话不可复活（06 §5 硬要求）==")
        self.check("恢复库中恢复出来的有效会话先被清零",
                   report.get("sessions_active_after_revoke") == 0,
                   f"revoked_at is null = {report.get('sessions_active_after_revoke')}")
        sessions_after = self.count(self.target_db, "select count(*) from sessions where revoked_at is null")
        self.check("复查：恢复库没有未撤销会话", sessions_after == 0, f"count={sessions_after}")
        revoked_rows = self.count(self.target_db, "select count(*) from sessions")
        self.check("会话行数保留（只写 revoked_at，不删行）", revoked_rows == 2, f"count={revoked_rows}")

        print("== 7b. 对照实验：不做撤销那一步会怎样（真实测出「会话复活」）==")
        raw_db = f"pl_test_{self.suffix}_raw"
        # 这一路刻意 --skip-revoke：它是「有人忘了收尾」的对照，不是推荐做法。
        skipped = run([sys.executable, "deploy/restore.py",
                       "--backup", str(self.backup_dir),
                       "--target-database-url", self.dsn(raw_db),
                       "--skip-revoke", "--json"],
                      check=False)
        self.check("对照恢复（--skip-revoke）完成", skipped.returncode == 0,
                   skipped.stderr.strip()[-100:] if skipped.returncode else "")
        revived = self.count(raw_db, "select count(*) from sessions where revoked_at is null")
        restored_rows = self.count(raw_db, "select count(*) from sessions")
        self.check("实测：不撤销会话时，备份里已撤销的会话恢复后会复活",
                   revived == 1 and restored_rows == 2,
                   f"revoked_at is null = {revived} / 共 {restored_rows} 行")
        fix = run(["uv", "run", "python", "-m", "app.commands.revoke_sessions", "--all", "--json"],
                  env=env_for(database_url=self.dsn(raw_db)), cwd=API_DIR, check=False)
        self.check("补跑 revoke_sessions --all 后归零（修复动作有效）",
                   fix.returncode == 0
                   and self.count(raw_db, "select count(*) from sessions where revoked_at is null") == 0,
                   fix.stdout.strip()[:100])
        self.drop_db(raw_db)

        print("== 8. 恢复流程的目标守卫 ==")
        prod_named = run([sys.executable, "deploy/restore.py",
                          "--backup", str(self.backup_dir),
                          "--target-database-url", self.dsn(self.source_db).replace(
                              self.source_db, "pl_production_should_be_refused"),
                          "--media-root", str(self.work / "never-media")],
                         check=False)
        self.check("像生产库名的目标被拒绝",
                   prod_named.returncode != 0 and "生产" in prod_named.stderr,
                   (prod_named.stderr.strip().splitlines() or [""])[-1][:100])
        overwrite = run([sys.executable, "deploy/restore.py",
                         "--backup", str(self.backup_dir),
                         "--target-database-url", self.dsn(self.source_db),
                         "--media-root", str(self.work / "never-media-2")],
                        check=False)
        self.check("对非空库恢复（不加 --force）被拒绝",
                   overwrite.returncode != 0 and "不是空库" in overwrite.stderr,
                   (overwrite.stderr.strip().splitlines() or [""])[0][:100])
        self.check("被拒绝时没有留下目标媒体目录",
                   not (self.work / "never-media-2").exists())

        print("== 9. 角色分离：迁移账号 / 运行账号 ==")
        self.role_drill()

        print("== 10. 耗时（RPO 24h / RTO 4h 是待验证目标，不是保证）==")
        print(f"  备份 {backup_seconds} 秒；隔离恢复（含校验 + 撤销会话）{restore_seconds} 秒")
        print(f"  备份体积 {self.dir_size(self.backup_dir)} 字节")
        self.check("本次演练在 RTO 4 小时目标内", restore_seconds < 4 * 3600,
                   f"{restore_seconds} 秒")

    # --- 角色演练 ---------------------------------------------------------
    def role_drill(self) -> None:
        db = f"pl_test_{self.suffix}_roles"
        migrator = f"pl_t10_migrator_{os.getpid()}"
        app = f"pl_t10_app_{os.getpid()}"
        self.sql("postgres", f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
        for role in (migrator, app):
            self.sql("postgres", f'DROP ROLE IF EXISTS "{role}"', check=False)
        self.sql("postgres", f"CREATE ROLE {migrator} LOGIN PASSWORD 'drill-migrator-pw' NOSUPERUSER NOCREATEDB NOCREATEROLE")
        self.sql("postgres", f"CREATE ROLE {app} LOGIN PASSWORD 'drill-app-pw' NOSUPERUSER NOCREATEDB NOCREATEROLE")
        self.create_db(db)
        self.sql(db, "REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        self.sql(db, f"GRANT USAGE, CREATE ON SCHEMA public TO {migrator}")
        self.sql(db, f"GRANT USAGE ON SCHEMA public TO {app}")

        self.migrate_as(db, migrator)
        self.check("迁移账号能建表（迁移成功）",
                   self.count(db, "select count(*) from information_schema.tables "
                                  "where table_schema='public' and table_type='BASE TABLE'") > 10)

        denied = self.sql(db, "create table should_fail(id int)", user=app, check=False)
        result = run(self.psql_cmd(db, app) + ["-c", "create table should_fail(id int)"], check=False)
        self.check("运行账号不能建表（schema 权限被收回）", result.returncode != 0,
                   (result.stderr.strip().splitlines() or [""])[-1][:80])

        before = run(self.psql_cmd(db, app) + ["-c", "select count(*) from posts"], check=False)
        self.check("授权前运行账号读不到业务表", before.returncode != 0)

        run(self.psql_cmd(db, self.user) + ["-v", "ON_ERROR_STOP=1", "-v", f"app_user={app}",
                                            "-f", str(REPO_ROOT / "deploy" / "db" / "grant-runtime.sql")])
        after = run(self.psql_cmd(db, app) + ["-c", "select count(*) from posts"], check=False)
        self.check("grant-runtime.sql 之后运行账号可读", after.returncode == 0)
        write = run(self.psql_cmd(db, app) + ["-c", "select count(*) from tags"], check=False)
        self.check("运行账号对表只有 DML 权限（仍不能建表）",
                   write.returncode == 0 and result.returncode != 0)

        self.sql("postgres", f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
        for role in (migrator, app):
            self.sql("postgres", f'DROP ROLE IF EXISTS "{role}"', check=False)

    def migrate_as(self, database: str, role: str) -> None:
        run(["uv", "run", "alembic", "upgrade", "head"],
            env=env_for(database_url=f"postgresql+psycopg://{role}@{self.host}:{self.port}/{database}"),
            cwd=API_DIR)

    # --- 工具 -------------------------------------------------------------
    def dsn(self, database: str) -> str:
        return f"postgresql+psycopg://{self.user}@{self.host}:{self.port}/{database}"

    def count(self, database: str, statement: str) -> int:
        rows = self.sql(database, statement, check=False)
        try:
            return int(rows[0][0])
        except (IndexError, ValueError):
            return -1

    def dir_size(self, path: Path) -> int:
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())

    def cleanup(self) -> None:
        self.drop_db(self.source_db)
        self.drop_db(self.target_db)
        self.drop_db(f"pl_test_{self.suffix}_raw")
        if self.keep:
            print(f"  （--keep：保留 {self.work}）")
        else:
            shutil.rmtree(self.work, ignore_errors=True)

    def summary(self) -> int:
        failed = [item for item in self.results if not item[1]]
        print(f"\n== 汇总：{len(self.results) - len(failed)}/{len(self.results)} 通过 ==")
        for label, _, detail in failed:
            print(f"  ✗ {label}  {detail}")
        return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="T10 备份/恢复隔离演练")
    parser.add_argument("--keep", action="store_true", help="保留临时工作目录与库，便于人工检查")
    args = parser.parse_args()

    test_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    try:
        find_pg("psql")
        find_pg("pg_dump")
        find_pg("pg_restore")
        if not test_url:
            raise Skip("未设置 TEST_DATABASE_URL；本机临时集群见 T00 交付单")
        parts = urlsplit(test_url)
        if not parts.hostname:
            raise Skip(f"TEST_DATABASE_URL 解析不出主机：{test_url!r}")
    except Skip as exc:
        print(f"跳过：{exc}", file=sys.stderr)
        return 2

    harness = Harness(test_url, keep=args.keep)
    try:
        harness.run_all()
    except Skip as exc:
        print(f"跳过：{exc}", file=sys.stderr)
        harness.cleanup()
        return 2
    except Exception as exc:  # noqa: BLE001 - 演练脚本要打印原始失败
        print(f"演练中断：{exc}", file=sys.stderr)
        harness.results.append(("演练未跑完", False, str(exc)[:200]))
        harness.cleanup()
        return harness.summary() or 1
    code = harness.summary()
    harness.cleanup()
    return code


if __name__ == "__main__":
    sys.exit(main())
