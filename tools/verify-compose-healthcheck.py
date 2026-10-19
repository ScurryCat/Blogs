#!/usr/bin/env python3
"""D1 验证：在**隔离 Compose 环境**里验证生产编排的健康检查契约与依赖启动。

背景（2026-10-19 独立验收 D1）：
  deploy/compose.prod.yaml 的 API healthcheck 期望 `{"status": "ok"}`，
  而 apps/api/app/core/health.py 的就绪成功响应是 `{"status": "ready"}`（未就绪 503
  `not_ready`）。结果是：API 即使完全就绪也会被判 unhealthy，网关的
  `depends_on: api: condition: service_healthy` 永远等不到 —— 编排错配。

本脚本做的是**真实容器验证**，不是静态审查：
  1. `docker compose -f deploy/compose.prod.yaml` 用隔离项目名 / 隔离端口起整套
     （gateway + web + api + db + migrate），镜像由 `--api-image/--web-image` 指定
     （通常先用 `--build` 从 deploy/prod.Dockerfile.* 构建）；
  2. 等待 db → migrate → grants（运行账号授权）→ api → web → gateway 的健康/依赖启动链全部就绪；
  3. 通过网关真实请求 `/api/v1/health/ready`（200 + status=ready）、`/healthz`、`/`；
  4. 在 api 容器里执行**编排实际部署的 healthcheck 命令**（从 docker inspect 读取），
     并执行「旧契约（== "ok"）」对照，证明旧配置会误判；
  5. 失败检测：停掉 db → api 必须变成 unhealthy（不是 running 就算好）→ 重启 db 后恢复；
  6. 顺带验证容器内非 root uid（api 10001 / web 10002）；
  7. 结束后清理容器、网络与**本项目专属**卷（不使用 `down -v`）。

环境安全：
  - 只使用唯一项目名（默认 pl-d1-verify）与宿主端口 18080/18443；不碰共享
    3100/8100/8000/55432，也不碰任何已存在容器/卷/网络；
  - 不写生产配置、不部署；只读仓库、写 /tmp 临时目录与 Docker 本机资源；
  - 需要 Docker daemon；Docker Desktop 的凭据助手可能要 Keychain 权限。

用法：
  # 1) 构建镜像（仓库根目录；只本地打 tag）
  DOCKER_CONFIG=... docker build -f deploy/prod.Dockerfile.api -t phantom-log-api:d1-verify .
  DOCKER_CONFIG=... docker build -f deploy/prod.Dockerfile.web -t phantom-log-web:d1-verify .
  # 2) 启动隔离 Compose 并验证
  python3 tools/verify-compose-healthcheck.py
  # 3) 清理：脚本已自动清理；保留日志与 JSON
退出码：0 = 全部断言通过；1 = 有断言失败；2 = 环境/前置错误（镜像缺失、端口占用等）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
COMPOSE_FILE = REPO / "deploy/compose.prod.yaml"
READY_PATH = "/api/v1/health/ready"
DEFAULT_PROJECT = "pl-d1-verify"
DEFAULT_WORK = Path("/tmp/pl-d1-verify")
DEFAULT_API_IMAGE = "phantom-log-api:d1-verify"
DEFAULT_WEB_IMAGE = "phantom-log-web:d1-verify"


class Report:
    def __init__(self) -> None:
        self.results: list[dict[str, object]] = []
        self.commands: list[dict[str, object]] = []

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        self.results.append({"label": label, "ok": bool(ok), "detail": detail})
        print(f"  {'✓' if ok else '✗'} {label}" + (f"  — {detail}" if detail else ""))
        return bool(ok)

    def run(self, argv: list[str], *, timeout: int = 120, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        merged = {**os.environ, **(env or {})}
        started = time.time()
        result = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, timeout=timeout, env=merged)
        self.commands.append(
            {
                "argv": argv,
                "returncode": result.returncode,
                "seconds": round(time.time() - started, 2),
                "stdout": result.stdout[-4000:],
                "stderr": result.stderr[-4000:],
            }
        )
        return result

    def summary(self) -> int:
        failed = [item for item in self.results if not item["ok"]]
        print(f"\n== 汇总：{len(self.results) - len(failed)}/{len(self.results)} 通过 ==")
        for item in failed:
            print(f"  ✗ {item['label']}  {item['detail']}")
        return 0 if not failed else 1


# macOS Python 3.13 的 urllib 会走系统代理且不遵守 ExceptionsList（本机踩过：本地 curl 200、
# urllib 502）。验证只访问 127.0.0.1，必须显式禁用代理，否则网关检查会假失败。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_get(url: str, timeout: float = 10.0) -> tuple[int, str, dict[str, object] | None]:
    try:
        with _OPENER.open(url, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            parsed: dict[str, object] | None = None
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
            return response.status, raw, parsed
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace"), None
    except Exception as error:  # noqa: BLE001 - 连接失败就是检查失败
        return 0, f"{type(error).__name__}: {error}", None


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) != 0


def write_env_and_secrets(work: Path, api_image: str, web_image: str, http_port: int, https_port: int) -> Path:
    secrets_dir = work / "secrets"
    secrets_dir.mkdir(parents=True, exist_ok=True)
    passwords = {
        "postgres_admin_password": secrets.token_hex(24),
        "postgres_migrator_password": secrets.token_hex(24),
        "postgres_app_password": secrets.token_hex(24),
    }
    for name, value in passwords.items():
        path = secrets_dir / name
        path.write_text(value, encoding="utf-8")
        path.chmod(0o600)
    env = work / "compose.env"
    lines = [
        "# D1 隔离 Compose 验证用临时环境（不提交、不含真实生产值）",
        f"API_IMAGE={api_image}",
        f"WEB_IMAGE={web_image}",
        "POSTGRES_IMAGE=postgres:18-alpine",
        "CADDY_IMAGE=caddy:2.10.2-alpine",
        "APP_VERSION=d1-verify",
        # 容器内 gateway 监听 80；宿主端口映射到 http_port，避免与共享 8000 冲突。
        "SITE_ADDRESS=http://127.0.0.1",
        f"GATEWAY_HTTP_HOST_PORT={http_port}",
        f"GATEWAY_HTTPS_HOST_PORT={https_port}",
        "POSTGRES_DB=pl",
        "POSTGRES_ADMIN_USER=pl_admin",
        "POSTGRES_MIGRATOR_USER=pl_migrator",
        "POSTGRES_APP_USER=pl_app",
        f"POSTGRES_ADMIN_PASSWORD_FILE={secrets_dir / 'postgres_admin_password'}",
        f"POSTGRES_MIGRATOR_PASSWORD_FILE={secrets_dir / 'postgres_migrator_password'}",
        f"POSTGRES_APP_PASSWORD_FILE={secrets_dir / 'postgres_app_password'}",
        f"POSTGRES_MIGRATOR_PASSWORD={passwords['postgres_migrator_password']}",
        f"POSTGRES_APP_PASSWORD={passwords['postgres_app_password']}",
        f"SECRET_KEY={secrets.token_hex(32)}",
        "MEDIA_MAX_CONCURRENCY=2",
        "",
    ]
    env.write_text("\n".join(lines), encoding="utf-8")
    env.chmod(0o600)
    return env


def compose_base(project: str, env_file: Path) -> list[str]:
    return [
        "docker",
        "compose",
        "-f",
        str(COMPOSE_FILE),
        "-p",
        project,
        "--env-file",
        str(env_file),
    ]


def clean_project(report: Report, base: list[str], project: str) -> None:
    """清理**本项目**遗留的容器 / 网络 / 卷（只按 compose project label，不碰其他项目）。

    每次验证都从空库开始：否则上一轮失败留下的卷可能保存着旧口令/旧 schema，
    下一轮用新随机口令迁移就会 password authentication failed（实测踩过）。
    """
    report.run([*base, "down", "--remove-orphans", "--timeout", "20"], timeout=180)
    volumes = report.run(
        ["docker", "volume", "ls", "--filter", f"label=com.docker.compose.project={project}", "-q"],
        timeout=60,
    )
    for volume in volumes.stdout.split():
        report.run(["docker", "volume", "rm", volume], timeout=60)
    networks = report.run(
        ["docker", "network", "ls", "--filter", f"label=com.docker.compose.project={project}", "-q"],
        timeout=60,
    )
    for network in networks.stdout.split():
        report.run(["docker", "network", "rm", network], timeout=60)


def compose_json(report: Report, base: list[str]) -> list[dict[str, object]]:
    result = report.run([*base, "ps", "--all", "--format", "json"], timeout=60)
    if result.returncode != 0:
        return []
    text = result.stdout.strip()
    if not text:
        return []
    # Compose v2 旧版本逐行 JSON，v5 起是一次性 JSON 数组；两种都支持。
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    items: list[dict[str, object]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            items.append(item)
    return items


def service_container(report: Report, base: list[str], service: str) -> str:
    # `--all` 必须加：migrate/grants 是一次性服务，跑完就是 exited，默认 ps 不列。
    result = report.run([*base, "ps", "--all", "-q", service], timeout=60)
    return result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""


def docker_inspect(report: Report, container: str, fmt: str) -> str:
    if not container:
        return ""
    result = report.run(["docker", "inspect", "--format", fmt, container], timeout=60)
    return result.stdout.strip() if result.returncode == 0 else ""


def wait_until(predicate, *, timeout: float, interval: float = 2.0, describe: str = "") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    print(f"  … 等待超时：{describe or 'condition'}（{int(timeout)}s）")
    return False


def health_status(report: Report, container: str) -> str:
    return docker_inspect(report, container, "{{.State.Health.Status}}")


def container_status(report: Report, container: str) -> str:
    return docker_inspect(report, container, "{{.State.Status}}")


def main() -> int:
    parser = argparse.ArgumentParser(description="D1：隔离 Compose 健康检查与依赖启动验证")
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--work-dir", default=str(DEFAULT_WORK))
    parser.add_argument("--api-image", default=DEFAULT_API_IMAGE)
    parser.add_argument("--web-image", default=DEFAULT_WEB_IMAGE)
    parser.add_argument("--http-port", type=int, default=18080)
    parser.add_argument("--https-port", type=int, default=18443)
    parser.add_argument("--json", default="")
    parser.add_argument("--keep", action="store_true", help="失败时保留容器便于排查（默认仍会清理）")
    args = parser.parse_args()

    project = args.project
    if "verify" not in project:
        print("✗ 项目名必须包含 'verify'（避免误碰生产/共享资源）")
        return 2
    if not project.startswith("pl-"):
        print("✗ 项目名必须以 'pl-' 开头")
        return 2

    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    report = Report()
    env_file = write_env_and_secrets(work, args.api_image, args.web_image, args.http_port, args.https_port)
    base = compose_base(project, env_file)
    gateway_url = f"http://127.0.0.1:{args.http_port}"
    evidence: dict[str, object] = {
        "tool": "tools/verify-compose-healthcheck.py",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "project": project,
        "compose_file": str(COMPOSE_FILE),
        "api_image": args.api_image,
        "web_image": args.web_image,
        "gateway_url": gateway_url,
        "repo_head": subprocess.run(
            ["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True
        ).stdout.strip(),
        "checks": report.results,
        "commands": report.commands,
    }

    print("== 0. 清理本项目遗留资源（只按 pl-d1-verify 项目标签） ==")
    clean_project(report, base, project)
    print("  已清理（先清再查端口：上一轮失败后可能还留着容器占着 18080）")

    for port in (args.http_port, args.https_port):
        if not port_free("127.0.0.1", port):
            print(f"✗ 宿主端口 {port} 已被占用；换 --http-port/--https-port 或先释放（不要动共享服务）")
            return 2
    for image in (args.api_image, args.web_image):
        result = report.run(["docker", "image", "inspect", image], timeout=60)
        if result.returncode != 0:
            print(f"✗ 镜像不存在：{image}；先按 docstring 用 deploy/prod.Dockerfile.* 构建")
            return 2

    code = 2
    try:
        print("== 1. 渲染编排 ==")
        rendered = report.run([*base, "config", "--format", "yaml"], timeout=120)
        report.check("docker compose config 渲染成功", rendered.returncode == 0, rendered.stderr[-200:])
        (work / "rendered-compose.yaml").write_text(rendered.stdout, encoding="utf-8")
        if rendered.returncode != 0:
            code = 1
            return code

        print("== 2. 启动隔离 Compose（gateway/web/api/db/migrate） ==")
        up = report.run([*base, "up", "-d", "--remove-orphans"], timeout=900)
        report.check("docker compose up 成功", up.returncode == 0, up.stderr[-300:])
        if up.returncode != 0:
            logs = report.run([*base, "logs", "--no-color", "--tail", "120"], timeout=120)
            (work / "compose-logs-on-failure.txt").write_text(logs.stdout, encoding="utf-8")
            print("  （已保存容器日志到 compose-logs-on-failure.txt）")
            code = 1
            return code
        (work / "compose-ps-after-up.json").write_text(
            json.dumps(compose_json(report, base), ensure_ascii=False, indent=2), encoding="utf-8"
        )

        db = service_container(report, base, "db")
        migrate = service_container(report, base, "migrate")
        grants = service_container(report, base, "grants")
        api = service_container(report, base, "api")
        web = service_container(report, base, "web")
        gateway = service_container(report, base, "gateway")
        report.check("六个服务容器都已创建（db/migrate/grants/api/web/gateway）",
                     all((db, migrate, grants, api, web, gateway)),
                     f"db={bool(db)} migrate={bool(migrate)} grants={bool(grants)} api={bool(api)} web={bool(web)} gateway={bool(gateway)}")

        print("== 3. 依赖启动链 ==")
        db_healthy = wait_until(lambda: health_status(report, db) == "healthy", timeout=180, describe="db healthy")
        report.check("db 达到 healthy", db_healthy, f"health={health_status(report, db)}")

        def migrate_done() -> bool:
            status = container_status(report, migrate)
            exit_code = docker_inspect(report, migrate, "{{.State.ExitCode}}")
            return status == "exited" and exit_code == "0"

        migrate_ok = wait_until(migrate_done, timeout=300, describe="migrate 退出码 0")
        report.check("migrate 一次性任务退出码 0（迁移成功才启动 api）", migrate_ok,
                     f"status={container_status(report, migrate)} exit={docker_inspect(report, migrate, '{{.State.ExitCode}}')}")

        def grants_done() -> bool:
            status = container_status(report, grants)
            exit_code = docker_inspect(report, grants, "{{.State.ExitCode}}")
            return status == "exited" and exit_code == "0"

        grants_ok = wait_until(grants_done, timeout=180, describe="grants 退出码 0")
        report.check("grants 一次性任务退出码 0（运行账号授权成功才启动 api）", grants_ok,
                     f"status={container_status(report, grants)} exit={docker_inspect(report, grants, '{{.State.ExitCode}}')}")

        api_healthy = wait_until(lambda: health_status(report, api) == "healthy", timeout=300, describe="api healthy")
        report.check("api 达到 healthy（说明 healthcheck 契约与 readiness 一致）", api_healthy,
                     f"health={health_status(report, api)}")

        web_healthy = wait_until(lambda: health_status(report, web) == "healthy", timeout=240, describe="web healthy")
        report.check("web 达到 healthy（依赖 api healthy 后启动）", web_healthy,
                     f"health={health_status(report, web)}")

        gateway_healthy = wait_until(lambda: health_status(report, gateway) == "healthy", timeout=180, describe="gateway healthy")
        report.check("gateway 达到 healthy（依赖 web + api healthy 后启动）", gateway_healthy,
                     f"health={health_status(report, gateway)}")

        print("== 4. 通过网关的真实 HTTP 检查 ==")
        status, body, parsed = http_get(f"{gateway_url}/gateway-healthz")
        report.check("GET /gateway-healthz → 200", status == 200 and body.strip() == "ok",
                     f"HTTP {status} body={body[:80]!r}")
        status, body, parsed = http_get(f"{gateway_url}{READY_PATH}")
        checks = (parsed or {}).get("checks") if isinstance(parsed, dict) else None
        report.check(
            "GET /api/v1/health/ready → 200 且 status=ready、三项检查全 ok",
            status == 200 and isinstance(parsed, dict) and parsed.get("status") == "ready"
            and isinstance(checks, dict) and all(value == "ok" for value in checks.values()),
            f"HTTP {status} body={body[:200]!r}",
        )
        status, body, _ = http_get(f"{gateway_url}/healthz")
        report.check("GET /healthz（web）→ 200", status == 200, f"HTTP {status} body={body[:80]!r}")
        status, body, _ = http_get(f"{gateway_url}/")
        report.check("GET /（web 首页）→ 200", status == 200, f"HTTP {status} body={body[:60]!r}")

        print("== 5. 在 api 容器里执行“编排实际部署的 healthcheck” ==")
        test_json = docker_inspect(report, api, "{{json .Config.Healthcheck.Test}}")
        deployed = json.loads(test_json) if test_json else []
        report.check("能从容器 inspect 读到已部署的 healthcheck 命令", len(deployed) >= 4 and deployed[0] == "CMD",
                     str(deployed)[:200])
        script = deployed[-1] if len(deployed) >= 4 else ""
        report.check("已部署 healthcheck 调用 /api/v1/health/ready", READY_PATH in script)
        exec_ok = report.run(["docker", "exec", api, "python", "-c", script], timeout=60)
        report.check("执行已部署 healthcheck 命令 → 退出码 0", exec_ok.returncode == 0,
                     f"exit={exec_ok.returncode} stderr={exec_ok.stderr[-160:]!r}")

        legacy_script = script.replace('== "ready"', '== "ok"')
        report.check("对照脚本成功替换成旧契约（== \"ok\"）", legacy_script != script)
        legacy = report.run(["docker", "exec", api, "python", "-c", legacy_script], timeout=60)
        report.check("旧契约（== \"ok\"）在同一健康 API 上退出码非 0（证明 D1 错配会误判）",
                     legacy.returncode != 0, f"exit={legacy.returncode}")

        print("== 6. 非 root 运行 ==")
        api_uid = report.run(["docker", "exec", api, "id", "-u"], timeout=30)
        web_uid = report.run(["docker", "exec", web, "id", "-u"], timeout=30)
        report.check("api 容器内 uid=10001（非 root）", api_uid.stdout.strip() == "10001",
                     api_uid.stdout.strip())
        report.check("web 容器内 uid=10002（非 root）", web_uid.stdout.strip() == "10002",
                     web_uid.stdout.strip())

        print("== 7. 失败检测：停 db → api 必须 unhealthy → 重启恢复 ==")
        stop_db = report.run([*base, "stop", "db"], timeout=120)
        report.check("停止 db 服务", stop_db.returncode == 0, stop_db.stderr[-160:])
        api_unhealthy = wait_until(lambda: health_status(report, api) == "unhealthy", timeout=260,
                                   interval=3, describe="api unhealthy")
        report.check("db 停止后 api 变为 unhealthy（不是 running 就算好）", api_unhealthy,
                     f"health={health_status(report, api)}")
        report.check("db 故障期间 api 容器仍在运行（未崩溃）", container_status(report, api) == "running",
                     container_status(report, api))
        report.check("db 故障期间 web 容器未受影响（仍在运行）", container_status(report, web) == "running",
                     container_status(report, web))

        start_db = report.run([*base, "start", "db"], timeout=120)
        report.check("重启 db 服务", start_db.returncode == 0, start_db.stderr[-160:])
        recovered = wait_until(lambda: health_status(report, api) == "healthy", timeout=240,
                               interval=3, describe="api recovered")
        report.check("db 恢复后 api 重新变为 healthy", recovered, f"health={health_status(report, api)}")
        status, body, parsed = http_get(f"{gateway_url}{READY_PATH}")
        report.check("恢复后网关读 readiness 仍为 200 ready",
                     status == 200 and isinstance(parsed, dict) and parsed.get("status") == "ready",
                     f"HTTP {status} body={body[:160]!r}")

        print("== 8. 记录最终状态 ==")
        final_ps = compose_json(report, base)
        (work / "compose-ps-final.json").write_text(json.dumps(final_ps, ensure_ascii=False, indent=2), encoding="utf-8")
        for row in final_ps:
            name = row.get("Service") or row.get("Name")
            print(f"  - {name}: state={row.get('State')} health={row.get('Health')}")
        statuses = {str(row.get("Service")): str(row.get("Health") or "") for row in final_ps}
        report.check("最终 db/api/web/gateway 全部 healthy（migrate/grants 为 Exited(0)）",
                     all(statuses.get(name) == "healthy" for name in ("db", "api", "web", "gateway")),
                     json.dumps(statuses, ensure_ascii=False))
        code = report.summary()
    finally:
        evidence["checks"] = report.results
        evidence["commands"] = report.commands
        evidence["summary"] = {
            "total": len(report.results),
            "passed": sum(1 for item in report.results if item["ok"]),
            "failed": sum(1 for item in report.results if not item["ok"]),
        }
        if args.json:
            Path(args.json).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print("== 9. 清理隔离资源（只清本项目） ==")
        clean_project(report, base, project)
        remaining = report.run(
            ["docker", "ps", "-a", "--filter", f"label=com.docker.compose.project={project}", "-q"], timeout=60
        )
        print(f"  剩余本项目容器：{len(remaining.stdout.split())} 个（应为 0）")
        evidence["cleanup"] = {
            "project": project,
            "remaining_containers": len(remaining.stdout.split()),
        }
        if args.json:
            Path(args.json).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")

    return code


if __name__ == "__main__":
    sys.exit(main())
