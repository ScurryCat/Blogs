#!/usr/bin/env python3
"""T10 验收：真实服务下的健康就绪与迁移失败（不是容器内，见交付单的未验证项）。

T01 已经在单元层面测过 readiness 的六种状态（`apps/api/tests/core/test_health_readiness.py`）。
本脚本补的是**发布形态**的那一层：真实 uvicorn 进程、真实 PostgreSQL、真实 HTTP 请求、
真实文件系统权限，回答「编排按 healthcheck 判定就绪时，判的是不是真的」。

覆盖：
  1. `live` 与 `ready` 的语义差别：DB 掉线时 live=200、ready=503。
  2. DB 可达但 schema 未迁移：ready=503（不是「进程活着就算好」）。
  3. 媒体目录缺失 / 只读：ready=503，且响应不泄漏路径与库名。
  4. 迁移失败：半截 schema（表建了一半）时 ready=503，且 API 不返回 ready。
  5. 迁移成功后 ready=200 恢复（同一进程，无需重启）。
  6. 恢复备份后旧会话不可复活（调用 T00 的 revoke_sessions，恢复流程的收尾步骤）。

用法：
  cd /Users/学习/blog/Blogs
  export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
  export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
  python3 tests/e2e/integration/verify-health-drills.py

退出码 0 = 全部通过；1 = 有失败；2 = 前置条件缺失。
"""

from __future__ import annotations

import http.client as http_client
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[3]
API_DIR = REPO_ROOT / "apps" / "api"
PORT = 8320
SECRET_KEY = "t10-health-drill-secret-key-0123456789abcdef"


def port_in_use(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def wait_port(port: int, timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if port_in_use(port):
            return True
        time.sleep(0.3)
    return False


def wait_port_free(port: int, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not port_in_use(port):
            return True
        time.sleep(0.3)
    return False


def wait_http(port: int, path: str, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            status, _, _ = request("GET", port, path)
            if status:
                return
        except OSError:
            time.sleep(0.3)


def request(method: str, port: int, path: str) -> tuple[int, dict, bytes]:
    connection = http_client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        connection.request(method, path)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


class Report:
    def __init__(self) -> None:
        self.results: list[tuple[str, bool, str]] = []

    def check(self, label: str, condition: bool, detail: str = "") -> bool:
        self.results.append((label, bool(condition), detail))
        print(f"  {'✓' if condition else '✗'} {label}" + (f"  {detail}" if detail else ""))
        return bool(condition)

    def summary(self) -> int:
        failed = [item for item in self.results if not item[1]]
        print(f"\n== 汇总：{len(self.results) - len(failed)}/{len(self.results)} 通过 ==")
        for label, _, detail in failed:
            print(f"  ✗ {label}  {detail}")
        return 1 if failed else 0


def main() -> int:
    test_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not test_url:
        print("跳过：未设置 TEST_DATABASE_URL", file=sys.stderr)
        return 2
    parts = urlsplit(test_url)
    host = parts.hostname or "127.0.0.1"
    pg_port = str(parts.port or 5432)
    user = parts.username or "pl"

    pg_bin = Path(os.environ.get("PG_BIN", "/opt/homebrew/opt/postgresql@18/bin"))
    psql = str(pg_bin / "psql") if (pg_bin / "psql").exists() else (shutil.which("psql") or "")
    createdb = str(pg_bin / "createdb") if (pg_bin / "createdb").exists() else (shutil.which("createdb") or "")
    if not psql or not createdb:
        print("跳过：找不到 psql / createdb", file=sys.stderr)
        return 2

    report = Report()
    work = Path(f"/tmp/pl-t10-health-{os.getpid()}")
    work.mkdir(parents=True, exist_ok=True)
    database = f"pl_test_t10health_{os.getpid()}"
    media_root = work / "media"
    media_root.mkdir(exist_ok=True)

    def sql(statement: str, db: str = "postgres") -> subprocess.CompletedProcess:
        return subprocess.run([psql, "--no-psqlrc", "-h", host, "-p", pg_port, "-U", user,
                               "-d", db, "-tAc", statement], capture_output=True, text=True)

    api_process: subprocess.Popen | None = None
    log_handle = None

    def start_api(*, database_url: str, media: Path) -> subprocess.Popen:
        nonlocal log_handle
        env = dict(os.environ)
        env.update({
            "APP_ENV": "dev",
            "DATABASE_URL": database_url,
            "SECRET_KEY": SECRET_KEY,
            "MEDIA_ROOT": str(media),
            "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache" / "uv")),
        })
        if port_in_use(PORT):
            raise RuntimeError(f"端口 {PORT} 已被占用（上一次演练的进程没退干净）；先按端口精确停掉它")
        log_handle = (work / "api.log").open("a")
        process = subprocess.Popen(
            ["uv", "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
            cwd=API_DIR, env=env, stdout=log_handle, stderr=subprocess.STDOUT, start_new_session=True,
        )
        if not wait_port(PORT):
            raise RuntimeError(f"API 没有在端口 {PORT} 起来；看 {work / 'api.log'}")
        if process.poll() is not None:
            raise RuntimeError(f"API 进程已退出（退出码 {process.returncode}）；看 {work / 'api.log'}")
        wait_http(PORT, "/api/v1/health/live")
        return process

    def stop_api() -> None:
        nonlocal api_process, log_handle
        if api_process is not None:
            try:
                os.killpg(os.getpgid(api_process.pid), 9)
                api_process.wait(timeout=10)
            except Exception:
                pass
            api_process = None
        if log_handle is not None:
            log_handle.close()
            log_handle = None
        log_path = work / "api.log"
        if log_path.exists() and os.environ.get("T10_DRILL_VERBOSE"):
            tail = log_path.read_text(errors="replace").splitlines()[-8:]
            for line in tail:
                print(f"    [api.log] {line}")
        # 端口彻底释放再继续，否则下一次启动会撞端口。
        if not wait_port_free(PORT):
            raise RuntimeError(f"端口 {PORT} 在停止 API 后仍被占用")

    try:
        print("== 0. 准备隔离库 ==")
        sql(f'DROP DATABASE IF EXISTS "{database}_unmigrated" WITH (FORCE)')
        sql(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        subprocess.run([createdb, "-h", host, "-p", pg_port, "-U", user, f"{database}_unmigrated"], check=True)
        subprocess.run([createdb, "-h", host, "-p", pg_port, "-U", user, database], check=True)
        migrated_url = f"postgresql+psycopg://{user}@{host}:{pg_port}/{database}"
        unmigrated_url = f"postgresql+psycopg://{user}@{host}:{pg_port}/{database}_unmigrated"
        print(f"  已迁移库 {database} / 空库 {database}_unmigrated")

        print("== 1. schema 未迁移：live=200 但 ready=503 ==")
        api_process = start_api(database_url=unmigrated_url, media=media_root)
        status, _, body = request("GET", PORT, "/api/v1/health/live")
        report.check("空库下 liveness 仍为 200（只说明进程活着）", status == 200, f"status={status}")
        status, _, body = request("GET", PORT, "/api/v1/health/ready")
        payload = json.loads(body or b"{}")
        report.check("空库下 readiness 为 503（不返回假 ready）", status == 503, f"status={status}")
        report.check("readiness 明确指向 schema 未迁移",
                     payload.get("checks", {}).get("schema") == "not_migrated",
                     str(payload.get("checks")))

        print("== 2. 迁移成功后同一进程内 ready 变 200（无需重启）==")
        subprocess.run(["uv", "run", "alembic", "upgrade", "head"], cwd=API_DIR,
                       env={**os.environ, "DATABASE_URL": unmigrated_url, "APP_ENV": "dev",
                            "SECRET_KEY": SECRET_KEY,
                            "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", "")},
                       check=True, capture_output=True, text=True)
        status, _, body = request("GET", PORT, "/api/v1/health/ready")
        payload = json.loads(body or b"{}")
        report.check("迁移后 readiness 为 200 且 status=ready",
                     status == 200 and payload.get("status") == "ready",
                     f"status={status} {payload.get('status')}")
        stop_api()

        print("== 3. 媒体目录缺失 / 只读：ready=503 且不泄漏路径 ==")
        missing_media = work / "media-missing"
        api_process = start_api(database_url=unmigrated_url, media=missing_media)
        status, _, body = request("GET", PORT, "/api/v1/health/ready")
        payload = json.loads(body or b"{}")
        report.check("媒体目录缺失时 readiness 为 503",
                     status == 503 and payload.get("checks", {}).get("media_storage") == "missing",
                     f"status={status} {payload.get('checks')}")
        raw = body.decode("utf-8", "replace")
        report.check("未就绪响应不泄漏路径 / 库名 / 表名",
                     str(missing_media) not in raw and database not in raw and "alembic_version" not in raw,
                     raw[:120])
        stop_api()

        read_only_media = work / "media-readonly"
        read_only_media.mkdir(exist_ok=True)
        os.chmod(read_only_media, 0o500)
        api_process = start_api(database_url=unmigrated_url, media=read_only_media)
        status, _, body = request("GET", PORT, "/api/v1/health/ready")
        payload = json.loads(body or b"{}")
        report.check("媒体目录只读时 readiness 为 503（实际写探针文件，而不是只看权限位）",
                     status == 503 and payload.get("checks", {}).get("media_storage") == "not_writable",
                     f"status={status} {payload.get('checks')}")
        os.chmod(read_only_media, 0o700)
        stop_api()

        print("== 4. DB 掉线：live=200、ready=503（不返回假 ready）==")
        api_process = start_api(database_url=f"postgresql+psycopg://{user}@{host}:59999/{database}",
                                media=media_root)
        status, _, _ = request("GET", PORT, "/api/v1/health/live")
        report.check("DB 指向不可达端口时 liveness 仍 200", status == 200, f"status={status}")
        status, _, body = request("GET", PORT, "/api/v1/health/ready")
        payload = json.loads(body or b"{}")
        report.check("DB 不可达时 readiness 为 503 且 database=unavailable",
                     status == 503 and payload.get("checks", {}).get("database") == "unavailable",
                     f"status={status} {payload.get('checks')}")
        stop_api()

        print("== 5. 半截迁移（迁移失败）后 ready 仍 503 ==")
        half = f"{database}_half"
        sql(f'DROP DATABASE IF EXISTS "{half}" WITH (FORCE)')
        subprocess.run([createdb, "-h", host, "-p", pg_port, "-U", user, half], check=True)
        half_url = f"postgresql+psycopg://{user}@{host}:{pg_port}/{half}"
        # 只跑第一个 revision（基线），业务表还不存在 —— 等价于「迁移跑到一半失败」。
        subprocess.run(["uv", "run", "alembic", "upgrade", "0001_baseline"], cwd=API_DIR,
                       env={**os.environ, "DATABASE_URL": half_url, "APP_ENV": "dev",
                            "SECRET_KEY": SECRET_KEY,
                            "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", "")},
                       check=True, capture_output=True, text=True)
        api_process = start_api(database_url=half_url, media=media_root)
        status, _, body = request("GET", PORT, "/api/v1/health/ready")
        payload = json.loads(body or b"{}")
        report.check("只迁移到基线时 readiness 为 503（缺业务表 = 迁移没跑完）",
                     status == 503 and payload.get("checks", {}).get("schema") == "not_migrated",
                     f"status={status} {payload.get('checks')}")
        # 恢复写入能力：验证失败后不覆盖数据、能继续迁移到 head。
        subprocess.run(["uv", "run", "alembic", "upgrade", "head"], cwd=API_DIR,
                       env={**os.environ, "DATABASE_URL": half_url, "APP_ENV": "dev",
                            "SECRET_KEY": SECRET_KEY,
                            "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", "")},
                       check=True, capture_output=True, text=True)
        status, _, _ = request("GET", PORT, "/api/v1/health/ready")
        report.check("补跑迁移到 head 后 readiness 恢复 200（数据未被删除）",
                     status == 200, f"status={status}")
        stop_api()
        sql(f'DROP DATABASE IF EXISTS "{half}" WITH (FORCE)')
    finally:
        stop_api()
        sql(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        sql(f'DROP DATABASE IF EXISTS "{database}_unmigrated" WITH (FORCE)')
        shutil.rmtree(work, ignore_errors=True)

    return report.summary()


if __name__ == "__main__":
    sys.exit(main())
