#!/usr/bin/env python3
"""M1A：受限试用最小配置层的**真实隔离**验证（真实 Docker Compose + 真实请求）。

背景（2026-10-19，P5-M0M1-20261019-r1 M1A / C03–C07）：
  受限试用要求在网关增加独立访问认证，覆盖页面 / API / 媒体 / 静态资源；复用生产编排
  （deploy/compose.prod.yaml）并叠加最小覆盖层（deploy/compose.trial.yaml），不复制全量
  Compose、不放宽健康检查、不绕过站主登录 / CSRF / 媒体权限。

本脚本做的是真实容器与真实 HTTP 验证，不是静态审查：
  1. 用唯一项目名 / 唯一宿主端口 / 临时 secrets 渲染并启动 base + trial 编排；
  2. 冷启动依赖链：db healthy → migrate/grants Exited(0) → api/web/gateway healthy；
  3. 匿名保护：页面 / API / 媒体 / 静态 / 音频全部 401（Basic Auth challenge），
     只有 /gateway-healthz 免认证；错误口令 401，正确口令通过；
  4. 站主登录：真实 bootstrap 站主 → GET /auth/session 取预登录 CSRF → 登录成功；
     CSRF 缺失 / Origin 不匹配均 403（原有 CSRF 语义未被 Basic Auth 替代或绕过）；
  5. 上传 → 发布 → 撤回：站主上传 PNG、建草稿动态、发布后匿名可读公开变体，
     撤回后匿名 404、站主原图仍可读（媒体权限按原逻辑生效）；
  6. 健康联动：停 db → api unhealthy（容器仍 running）→ 恢复 db → api healthy；
  7. 迁移 / 授权失败：独立负向项目验证 migrate 失败与 grants 失败都会阻止 api 启动；
  8. 结束只清理本项目容器 / 网络 / 卷；临时 secrets 与未脱敏渲染结果删除，不写入证据。

安全边界（硬约束）：
  - 只使用 `pl-trial-verify*` 项目名、18090/18490 宿主端口、本脚本工作目录；不碰共享服务
    （8000/8100/3100/3120/55432 等）与任何已存在容器 / 卷 / 网络；
  - 不执行 `down -v`；清理只用 `down --remove-orphans` + 显式删除**本项目 label** 的卷 / 网络；
  - 不使用真实数据、真实域名、真实秘密；生产镜像只本地构建 / 引用，不 push；
  - 证据中不写口令、Cookie、Authorization、连接串；渲染结果先脱敏再落盘；
  - 本脚本不修改应用源码、不部署、不 push。

用法：
  # 1) 构建试用镜像（仓库根目录；只本地 tag）
  docker build -f deploy/prod.Dockerfile.api -t phantom-log-api:trial .
  docker build -f deploy/prod.Dockerfile.web --build-context music=assets/music -t phantom-log-web:trial .
  # 2) 隔离验证（自动生成临时 secrets / env，结束后清理）
  python3 tools/verify-trial-compose.py --json /tmp/pl-trial-verify/result.json
  # 3) 排查时保留容器：--keep（失败时默认也保留容器，便于 docker compose logs）
退出码：0 = 全部断言通过；1 = 有断言失败；2 = 环境/前置错误。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASE_COMPOSE = REPO / "deploy/compose.prod.yaml"
TRIAL_COMPOSE = REPO / "deploy/compose.trial.yaml"
GATEWAY_CADDYFILE = REPO / "deploy/gateway/Caddyfile"
TRIAL_SNIPPET = REPO / "deploy/gateway/access/trial/trial-auth.caddy"
DEFAULT_PROJECT = "pl-trial-verify"
DEFAULT_WORK = Path("/tmp/pl-trial-verify")
DEFAULT_API_IMAGE = "phantom-log-api:trial"
DEFAULT_WEB_IMAGE = "phantom-log-web:trial"
CADDY_IMAGE = "caddy:2.10.2-alpine"
READY_PATH = "/api/v1/health/ready"
MUSIC_PATH = "/assets/music/beneath-the-mask.mp3"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "trial-verify-owner-password-123"

# macOS Python 3.13 的 urllib 会走系统代理且不遵守本机 ExceptionsList：
# 验证只访问 127.0.0.1，必须显式禁用代理，否则会假失败。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

HTTP_METHODS = {"GET": False, "HEAD": False, "POST": True, "PATCH": True, "PUT": True, "DELETE": True}


class Aborted(RuntimeError):
    """前置步骤失败，跳过后续真实验证。"""


class Report:
    def __init__(self) -> None:
        self.results: list[dict[str, object]] = []
        self.commands: list[dict[str, object]] = []

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        self.results.append({"label": label, "ok": bool(ok), "detail": detail})
        print(f"  {'✓' if ok else '✗'} {label}" + (f"  — {detail}" if detail else ""))
        return bool(ok)

    def run(self, argv: list[str], *, timeout: int = 120, env: dict[str, str] | None = None,
            input_text: str | None = None, record: bool = True) -> subprocess.CompletedProcess[str]:
        merged = {**os.environ, **(env or {})}
        started = time.time()
        result = subprocess.run(argv, cwd=REPO, capture_output=True, text=True,
                                timeout=timeout, env=merged, input=input_text)
        if record:
            self.commands.append({
                "argv": argv,
                "returncode": result.returncode,
                "seconds": round(time.time() - started, 2),
                "stdout": result.stdout[-3000:],
                "stderr": result.stderr[-3000:],
            })
        return result

    def summary(self) -> int:
        failed = [item for item in self.results if not item["ok"]]
        print(f"\n== 汇总：{len(self.results) - len(failed)}/{len(self.results)} 通过 ==")
        for item in failed:
            print(f"  ✗ {item['label']}  {item['detail']}")
        return 0 if not failed else 1


# ---------------------------------------------------------------- 环境与编排

def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) != 0


def write_env_and_secrets(work: Path, api_image: str, web_image: str, http_port: int,
                          https_port: int) -> dict[str, object]:
    """生成一次性 secrets / env。返回值中的明文口令只留在本进程内存，不写日志。"""
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
    access_user = "trial-verify-owner"
    access_password = secrets.token_urlsafe(18)
    (secrets_dir / "trial_access_password").write_text(access_password, encoding="utf-8")
    (secrets_dir / "trial_access_password").chmod(0o600)

    hash_result = subprocess.run(
        ["docker", "run", "-i", "--rm", CADDY_IMAGE, "caddy", "hash-password"],
        input=access_password + "\n", capture_output=True, text=True, timeout=180,
    )
    lines = [line.strip() for line in hash_result.stdout.splitlines() if line.strip()]
    if hash_result.returncode != 0 or not lines or not lines[-1].startswith("$2"):
        raise RuntimeError(f"caddy hash-password 失败（rc={hash_result.returncode}）：{hash_result.stderr[-300:]}")

    env = work / "compose.env"
    lines_out = [
        "# 受限试用隔离验证用临时环境（不提交、不包含真实生产值）",
        f"API_IMAGE={api_image}",
        f"WEB_IMAGE={web_image}",
        "POSTGRES_IMAGE=postgres:18-alpine",
        f"CADDY_IMAGE={CADDY_IMAGE}",
        "APP_VERSION=trial-verify",
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
        f"TRIAL_AUTH_USER={access_user}",
        # Compose --env-file 会对值做 `$VAR` 插值；bcrypt 哈希的 `$` 需写成 `$$`，
        # 否则 `$<salt>` 被当变量吃掉（2026-10-19 实测：随机盐以字母开头时鉴权必失败）。
        f"TRIAL_AUTH_HASH={lines[-1].replace('$', '$$')}",
        "",
    ]
    env.write_text("\n".join(lines_out), encoding="utf-8")
    env.chmod(0o600)
    return {"env_file": env, "access_user": access_user, "access_password": access_password}


def compose_base(project: str, env_file: Path, extra_files: list[Path] | None = None) -> list[str]:
    argv = ["docker", "compose", "-f", str(BASE_COMPOSE), "-f", str(TRIAL_COMPOSE)]
    for path in extra_files or []:
        argv += ["-f", str(path)]
    return [*argv, "-p", project, "--env-file", str(env_file)]


def clean_project(report: Report, base: list[str], project: str) -> None:
    """只清理本项目（按 compose project label）的容器 / 网络 / 卷；不碰其他项目。"""
    report.run([*base, "down", "--remove-orphans", "--timeout", "20"], timeout=240)
    volumes = report.run(
        ["docker", "volume", "ls", "--filter", f"label=com.docker.compose.project={project}", "-q"], timeout=60
    )
    for volume in volumes.stdout.split():
        report.run(["docker", "volume", "rm", volume], timeout=60)
    networks = report.run(
        ["docker", "network", "ls", "--filter", f"label=com.docker.compose.project={project}", "-q"], timeout=60
    )
    for network in networks.stdout.split():
        report.run(["docker", "network", "rm", network], timeout=60)


def compose_ps(report: Report, base: list[str]) -> list[dict[str, object]]:
    result = report.run([*base, "ps", "--all", "--format", "json"], timeout=60)
    text = result.stdout.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    items: list[dict[str, object]] = []
    for line in text.splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            items.append(item)
    return items


def service_container(report: Report, base: list[str], service: str) -> str:
    result = report.run([*base, "ps", "--all", "-q", service], timeout=60)
    return result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""


def docker_inspect(report: Report, container: str, fmt: str) -> str:
    if not container:
        return ""
    result = report.run(["docker", "inspect", "--format", fmt, container], timeout=60)
    return result.stdout.strip() if result.returncode == 0 else ""


def health_status(report: Report, container: str) -> str:
    return docker_inspect(report, container, "{{.State.Health.Status}}")


def container_status(report: Report, container: str) -> str:
    return docker_inspect(report, container, "{{.State.Status}}")


def container_exit_code(report: Report, container: str) -> str:
    return docker_inspect(report, container, "{{.State.ExitCode}}")


def wait_until(predicate, *, timeout: float, interval: float = 2.0, describe: str = "") -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if predicate():
                return True
        except Exception:  # noqa: BLE001 - 等待期间的瞬时错误按未满足处理
            pass
        time.sleep(interval)
    print(f"  … 等待超时：{describe or 'condition'}（{int(timeout)}s）")
    return False


def redact_config(value):
    """递归脱敏：只保留结构，抹掉密钥 / 口令 / 连接串 / 认证哈希。"""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            upper = str(key).upper()
            if any(token in upper for token in ("PASSWORD", "SECRET", "DATABASE_URL", "TRIAL_AUTH_HASH",
                                                "PRIVATE", "TOKEN", "CREDENTIAL")):
                out[key] = "<redacted>"
            else:
                out[key] = redact_config(item)
        return out
    if isinstance(value, list):
        return [redact_config(item) for item in value]
    return value


# ------------------------------------------------------------------ HTTP 客户端

class HttpResult:
    def __init__(self, status: int, headers: dict[str, str], body: bytes) -> None:
        self.status = status
        self.headers = headers
        self.body = body

    def json(self) -> dict:
        try:
            parsed = json.loads(self.body.decode("utf-8", "replace"))
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}


class TrialClient:
    """带 Basic Auth + 手工 Cookie 的 HTTP 客户端。

    为什么手工 Cookie：试用镜像走 APP_ENV=prod，会话 Cookie 是 `__Host-` + Secure；
    本机隔离用 HTTP，浏览器 / cookie jar 不会回传 Secure Cookie，但服务端语义仍可验证——
    这里显式保存并回放 Cookie 头，避免把「本机 HTTP 冒烟」误当成「HTTPS 已完成」。
    """

    def __init__(self, port: int, user: str, password: str) -> None:
        self.base = f"http://127.0.0.1:{port}"
        self.user = user
        self.password = password
        self.cookies: dict[str, str] = {}
        self.csrf: str = ""
        self.results: list[tuple[str, int]] = []

    def auth_header(self) -> dict[str, str]:
        token = base64.b64encode(f"{self.user}:{self.password}".encode()).decode()
        return {"Authorization": f"Basic {token}"}

    def _capture_cookies(self, raw_headers) -> None:
        for key, value in raw_headers:
            if key.lower() != "set-cookie":
                continue
            first = value.split(";")[0].strip()
            if "=" in first:
                name, _, cookie_value = first.partition("=")
                self.cookies[name.strip()] = cookie_value.strip()

    def request(self, method: str, path: str, *, headers: dict[str, str] | None = None,
                body: bytes | None = None, auth: bool = True, timeout: float = 30.0) -> HttpResult:
        merged: dict[str, str] = {}
        if auth:
            merged.update(self.auth_header())
        if self.cookies:
            merged["Cookie"] = "; ".join(f"{name}={value}" for name, value in self.cookies.items())
        merged.update(headers or {})
        request = urllib.request.Request(self.base + path, data=body, headers=merged, method=method)
        try:
            with _OPENER.open(request, timeout=timeout) as response:
                status, raw_headers, payload = response.status, response.headers.items(), response.read()
        except urllib.error.HTTPError as error:
            status, raw_headers, payload = error.code, error.headers.items(), error.read()
        self._capture_cookies(raw_headers)
        self.results.append((f"{method} {path}", status))
        return HttpResult(status, {key.lower(): value for key, value in raw_headers}, payload)

    def json_request(self, method: str, path: str, payload: dict | None = None,
                     *, extra_headers: dict[str, str] | None = None, timeout: float = 30.0) -> HttpResult:
        headers = {"Accept": "application/json"}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        headers.update(extra_headers or {})
        return self.request(method, path, headers=headers, body=body, timeout=timeout)


# ------------------------------------------------------------------ 媒体工具

def make_png(width: int = 900, height: int = 600) -> bytes:
    """纯标准库生成一张 PNG（不依赖 PIL），用于真实上传 / 派生变体 / 公开引用验证。"""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # 每行 filter type = None
        for x in range(width):
            raw += bytes(((x * 255) // max(width - 1, 1), (y * 255) // max(height - 1, 1), 128))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


# ------------------------------------------------------------------ 主流程

def main() -> int:
    parser = argparse.ArgumentParser(description="M1A：受限试用最小配置层隔离验证")
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--work-dir", default=str(DEFAULT_WORK))
    parser.add_argument("--api-image", default=DEFAULT_API_IMAGE)
    parser.add_argument("--web-image", default=DEFAULT_WEB_IMAGE)
    parser.add_argument("--http-port", type=int, default=18090)
    parser.add_argument("--https-port", type=int, default=18490)
    parser.add_argument("--json", default="")
    parser.add_argument("--keep", action="store_true", help="失败时保留容器便于排查（默认仍会清理）")
    parser.add_argument("--keep-secrets", action="store_true", help="保留临时 env/secrets（排查用，勿打包）")
    parser.add_argument("--skip-negative", action="store_true", help="跳过迁移/授权失败负向项目")
    args = parser.parse_args()

    project = args.project
    if not (project.startswith("pl-") and "verify" in project):
        print("✗ 项目名必须以 pl- 开头且包含 verify，避免误碰生产 / 共享资源")
        return 2
    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    report = Report()

    for image in (args.api_image, args.web_image):
        if report.run(["docker", "image", "inspect", image], timeout=60).returncode != 0:
            print(f"✗ 镜像不存在：{image}；先按 docstring 用 deploy/prod.Dockerfile.* 构建")
            return 2

    print("== 0. 生成一次性 secrets / env，清理本项目遗留资源 ==")
    secrets_info = write_env_and_secrets(work, args.api_image, args.web_image, args.http_port, args.https_port)
    env_file = Path(secrets_info["env_file"])
    base = compose_base(project, env_file)
    gateway_url = f"http://127.0.0.1:{args.http_port}"
    access_user = str(secrets_info["access_user"])
    access_password = str(secrets_info["access_password"])
    # 两个客户端：visitor 只带网关 Basic Auth（无会话 Cookie，等价匿名访客）；
    # owner 还带站主登录后的会话 Cookie + CSRF（等价站主浏览器）。
    visitor = TrialClient(args.http_port, access_user, access_password)
    owner = TrialClient(args.http_port, access_user, access_password)

    evidence: dict[str, object] = {
        "tool": "tools/verify-trial-compose.py",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "project": project,
        "base_compose": str(BASE_COMPOSE),
        "trial_compose": str(TRIAL_COMPOSE),
        "api_image": args.api_image,
        "web_image": args.web_image,
        "gateway_url": gateway_url,
        "repo_head": subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"],
                                    capture_output=True, text=True).stdout.strip(),
        "docker_version": subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"],
                                         capture_output=True, text=True).stdout.strip(),
        "checks": [],
        "commands": [],
        "client_requests": [],
    }

    clean_project(report, base, project)
    for port in (args.http_port, args.https_port):
        if not port_free("127.0.0.1", port):
            print(f"✗ 宿主端口 {port} 被占用；换 --http-port/--https-port 或先释放（不要动共享服务）")
            return 2

    try:
        print("== 1. 渲染试用编排（base + overlay）==")
        rendered = report.run([*base, "config", "--format", "json"], timeout=180)
        report.check("docker compose config 渲染成功", rendered.returncode == 0, rendered.stderr[-200:])
        if rendered.returncode != 0:
            raise Aborted("渲染失败，无法启动试用编排")
        try:
            rendered_cfg = json.loads(rendered.stdout)
        except json.JSONDecodeError as error:
            raise Aborted(f"渲染结果不是合法 JSON：{error}") from error
        (work / "rendered-compose.redacted.json").write_text(
            json.dumps(redact_config(rendered_cfg), ensure_ascii=False, indent=2), encoding="utf-8")
        services = rendered_cfg.get("services") or {}
        report.check("服务集合完整（db/migrate/grants/api/web/gateway）",
                     {"db", "migrate", "grants", "api", "web", "gateway"} <= set(services),
                     ",".join(sorted(services)))
        publishers = [name for name, svc in services.items() if svc.get("ports")]
        report.check("只有 gateway 发布宿主端口", publishers == ["gateway"], str(publishers))
        gateway_volumes = [item if isinstance(item, dict) else {}
                           for item in (services.get("gateway") or {}).get("volumes", [])]
        access = [item for item in gateway_volumes if str(item.get("target", "")) == "/etc/caddy/access"]
        report.check("gateway 使用 access/trial 覆盖挂载（不是生产 noop 片段）",
                     len(access) == 1 and "access/trial" in str(access[0].get("source", "")), str(access))
        gateway_env = (services.get("gateway") or {}).get("environment") or {}
        report.check("gateway 注入 TRIAL_AUTH_USER / TRIAL_AUTH_HASH",
                     bool(gateway_env.get("TRIAL_AUTH_USER")) and bool(gateway_env.get("TRIAL_AUTH_HASH")))
        report.check("编排里没有明文访问口令变量",
                     not any("PASSWORD" in str(key).upper() for key in gateway_env))

        print("== 2. 冷启动隔离编排（db → migrate/grants → api → web → gateway）==")
        up = report.run([*base, "up", "-d", "--remove-orphans"], timeout=900)
        report.check("docker compose up 成功", up.returncode == 0, up.stderr[-300:])
        if up.returncode != 0:
            logs = report.run([*base, "logs", "--no-color", "--tail", "150"], timeout=120)
            (work / "compose-logs-on-failure.txt").write_text(logs.stdout[-20000:], encoding="utf-8")
            raise Aborted("冷启动失败")
        (work / "compose-ps-after-up.json").write_text(
            json.dumps(compose_ps(report, base), ensure_ascii=False, indent=2), encoding="utf-8")

        db = service_container(report, base, "db")
        migrate = service_container(report, base, "migrate")
        grants = service_container(report, base, "grants")
        api = service_container(report, base, "api")
        web = service_container(report, base, "web")
        gateway = service_container(report, base, "gateway")

        report.check("db healthy", wait_until(lambda: health_status(report, db) == "healthy", timeout=180,
                                              describe="db healthy"), health_status(report, db))
        report.check("migrate 以 Exited(0) 完成", wait_until(
            lambda: container_status(report, migrate) == "exited", timeout=300, describe="migrate exited"),
            f"Status={container_status(report, migrate)} ExitCode={container_exit_code(report, migrate)}")
        report.check("migrate 退出码 0", container_exit_code(report, migrate) == "0",
                     container_exit_code(report, migrate))
        report.check("grants 以 Exited(0) 完成", wait_until(
            lambda: container_status(report, grants) == "exited", timeout=180, describe="grants exited"),
            f"Status={container_status(report, grants)} ExitCode={container_exit_code(report, grants)}")
        report.check("grants 退出码 0（运行账号授权成功）", container_exit_code(report, grants) == "0",
                     container_exit_code(report, grants))
        report.check("api healthy", wait_until(lambda: health_status(report, api) == "healthy", timeout=300,
                                              describe="api healthy"), health_status(report, api))
        report.check("web healthy", wait_until(lambda: health_status(report, web) == "healthy", timeout=180,
                                              describe="web healthy"), health_status(report, web))
        report.check("gateway healthy", wait_until(lambda: health_status(report, gateway) == "healthy",
                                                  timeout=180, describe="gateway healthy"),
                     health_status(report, gateway))
        uid_api = report.run([*base, "exec", "-T", "api", "id", "-u"], timeout=60).stdout.strip()
        uid_web = report.run([*base, "exec", "-T", "web", "id", "-u"], timeout=60).stdout.strip()
        report.check("api / web 容器内非 root（uid 10001 / 10002）",
                     uid_api == "10001" and uid_web == "10002", f"api={uid_api} web={uid_web}")

        print("== 3. 匿名保护：页面 / API / 媒体 / 静态 / 音频 ==")
        health = visitor.request("GET", "/gateway-healthz", auth=False)
        report.check("免认证探针 /gateway-healthz 200", health.status == 200, str(health.status))
        for path, label in (("/", "页面"), ("/api/v1/posts", "API"), (MUSIC_PATH, "音频静态资源"),
                            (READY_PATH, "readiness 健康端点")):
            anonymous = visitor.request("GET", path, auth=False)
            report.check(f"匿名访问{label} {path} 被网关 401 拦截", anonymous.status == 401,
                         str(anonymous.status))
            report.check(f"匿名访问{label}返回 Basic Auth challenge",
                         "basic" in anonymous.headers.get("www-authenticate", "").lower(),
                         anonymous.headers.get("www-authenticate", ""))
        wrong = TrialClient(args.http_port, access_user, "wrong-password")
        report.check("错误访问口令 401", wrong.request("GET", "/").status == 401)

        print("== 4. 通过网关保护后的站主登录 / CSRF ==")
        ready = visitor.request("GET", READY_PATH)
        report.check("正确访问口令后 readiness 200 + status=ready",
                     ready.status == 200 and ready.json().get("status") == "ready",
                     f"{ready.status} {ready.json().get('status')}")
        home = visitor.request("GET", "/")
        report.check("正确访问口令后首页 200", home.status == 200, str(home.status))
        static_match = re.search(rb'/_next/static/[^"\'\\ ]+\.(?:js|css)', home.body)
        report.check("首页包含可验证的静态资源路径", static_match is not None)
        if static_match:
            static_path = static_match.group(0).decode()
            report.check("静态资源匿名 401", visitor.request("GET", static_path, auth=False).status == 401)
            report.check("静态资源经访问保护后 200", visitor.request("GET", static_path).status == 200)
        music = visitor.request("GET", MUSIC_PATH)
        report.check("音频资源经访问保护后 200 且支持 Range 拖动",
                     music.status == 200 and "bytes" in music.headers.get("accept-ranges", "").lower(),
                     f"{music.status} accept-ranges={music.headers.get('accept-ranges', '')}")

        bootstrap = report.run([*base, "exec", "-T", "api", "python", "-m", "app.commands.bootstrap_admin",
                                "--username", OWNER_USERNAME, "--password-stdin"],
                               timeout=120, input_text=OWNER_PASSWORD + "\n")
        report.check("隔离库创建站主成功", bootstrap.returncode == 0, bootstrap.stderr[-200:])

        session = owner.json_request("GET", "/api/v1/auth/session")
        session_json = session.json()
        report.check("GET /auth/session 200 且建立预登录会话",
                     session.status == 200 and session_json.get("prelogin") is True
                     and bool(session_json.get("csrf_token")), str(session.status))
        origin = f"http://127.0.0.1:{args.http_port}"
        no_csrf = owner.json_request("POST", "/api/v1/auth/login",
                                     {"username": OWNER_USERNAME, "password": OWNER_PASSWORD},
                                     extra_headers={"Origin": origin})
        report.check("登录缺少 CSRF token 被 403 拒绝（原有 CSRF 语义仍生效）", no_csrf.status == 403,
                     str(no_csrf.status))
        session = owner.json_request("GET", "/api/v1/auth/session")
        owner.csrf = session.json().get("csrf_token", "")
        bad_origin = owner.json_request("POST", "/api/v1/auth/login",
                                        {"username": OWNER_USERNAME, "password": OWNER_PASSWORD},
                                        extra_headers={"Origin": "http://evil.example",
                                                       "X-CSRF-Token": owner.csrf})
        report.check("登录 Origin 不匹配被 403 拒绝（来源校验仍生效）", bad_origin.status == 403,
                     str(bad_origin.status))
        session = owner.json_request("GET", "/api/v1/auth/session")
        owner.csrf = session.json().get("csrf_token", "")
        login = owner.json_request("POST", "/api/v1/auth/login",
                                   {"username": OWNER_USERNAME, "password": OWNER_PASSWORD},
                                   extra_headers={"Origin": origin, "X-CSRF-Token": owner.csrf})
        report.check("站主登录成功（经 Basic Auth + 原有会话登录）",
                     login.status == 200 and login.json().get("authenticated") is True, str(login.status))
        owner.csrf = login.json().get("csrf_token", "")
        report.check("登录后会话 authenticated=true",
                     owner.json_request("GET", "/api/v1/auth/session").json().get("authenticated") is True)

        print("== 5. 上传 / 发布 / 撤回与媒体权限 ==")
        png = make_png()
        boundary = "----pl-trial-" + secrets.token_hex(8)
        upload_body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"trial-verify.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + png + b"\r\n" + f"--{boundary}--\r\n".encode()
        upload = owner.request("POST", "/api/v1/admin/media",
                               headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                                        "Origin": origin, "X-CSRF-Token": owner.csrf},
                               body=upload_body, timeout=180)
        upload_json = upload.json()
        media_id = upload_json.get("id", "")
        report.check("站主上传图片 201", upload.status == 201 and bool(media_id), str(upload.status))
        variant_names = [item.get("name") for item in upload_json.get("variants", [])]
        report.check("服务端派生固定变体（含 w320/w640）",
                     "w320.webp" in variant_names and "w640.webp" in variant_names, str(variant_names))
        report.check("未发布引用的媒体变体匿名 404",
                     visitor.request("GET", f"/api/v1/media/{media_id}/w640.webp").status == 404)
        report.check("媒体原图匿名 404（原图永不匿名可读）",
                     visitor.request("GET", f"/api/v1/media/{media_id}/original").status == 404)
        owner_original = owner.request("GET", f"/api/v1/media/{media_id}/original")
        report.check("站主可读原图 200 且为 PNG",
                     owner_original.status == 200 and "image/png" in owner_original.headers.get("content-type", ""),
                     f"{owner_original.status} {owner_original.headers.get('content-type', '')}")

        moment = owner.json_request("POST", "/api/v1/admin/moments",
                                    {"text": "M1A 隔离验证：访问保护 + 发布撤回",
                                     "images": [{"media_id": media_id, "position": 0, "alt": "trialtest"}],
                                     "tags": []},
                                    extra_headers={"Origin": origin, "X-CSRF-Token": owner.csrf})
        moment_json = moment.json()
        moment_id = moment_json.get("id", "")
        report.check("站主新建动态草稿 201", moment.status == 201 and moment_json.get("status") == "draft",
                     f"{moment.status} {moment_json.get('status')}")
        public_before = visitor.request("GET", "/api/v1/moments")
        ids_before = {item.get("id") for item in public_before.json().get("items", [])}
        report.check("未发布动态不出现在公开列表", moment_id not in ids_before)

        moment_version = int(moment_json.get("version") or 1)
        published = owner.json_request("POST", f"/api/v1/admin/moments/{moment_id}/publish", None,
                                       extra_headers={"Origin": origin, "X-CSRF-Token": owner.csrf,
                                                      "If-Match": f'"{moment_version}"'},
                                       )
        report.check("发布动态成功 200 且 status=published",
                     published.status == 200 and published.json().get("status") == "published",
                     f"{published.status} {published.json().get('status')}")
        ids_after = {item.get("id") for item in visitor.request("GET", "/api/v1/moments").json().get("items", [])}
        report.check("发布后匿名（仅 Basic Auth）可在公开列表看到", moment_id in ids_after)
        report.check("发布后匿名可读动态详情 200",
                     visitor.request("GET", f"/api/v1/moments/{moment_id}").status == 200)
        variant_public = visitor.request("GET", f"/api/v1/media/{media_id}/w640.webp")
        report.check("发布后公开变体匿名 200 且为 webp",
                     variant_public.status == 200 and "webp" in variant_public.headers.get("content-type", ""),
                     f"{variant_public.status} {variant_public.headers.get('content-type', '')}")
        report.check("发布后原图仍匿名 404", visitor.request(
            "GET", f"/api/v1/media/{media_id}/original").status == 404)

        published_version = int(published.json().get("version") or moment_version + 1)
        unpublished = owner.json_request("POST", f"/api/v1/admin/moments/{moment_id}/unpublish", None,
                                         extra_headers={"Origin": origin, "X-CSRF-Token": owner.csrf,
                                                        "If-Match": f'"{published_version}"'})
        report.check("撤回动态成功 200 且回到 draft",
                     unpublished.status == 200 and unpublished.json().get("status") == "draft",
                     f"{unpublished.status} {unpublished.json().get('status')}")
        report.check("撤回后匿名详情 404",
                     visitor.request("GET", f"/api/v1/moments/{moment_id}").status == 404)
        report.check("撤回后公开变体恢复匿名 404",
                     visitor.request("GET", f"/api/v1/media/{media_id}/w640.webp").status == 404)
        report.check("撤回后站主原图仍可读 200",
                     owner.request("GET", f"/api/v1/media/{media_id}/original").status == 200)

        print("== 6. DB 不可用 / 恢复（健康联动）==")
        report.run([*base, "stop", "db"], timeout=180)
        report.check("停 db 后 api 变 unhealthy（容器仍 running）", wait_until(
            lambda: health_status(report, api) == "unhealthy" and container_status(report, api) == "running",
            timeout=150, describe="api unhealthy"),
            f"health={health_status(report, api)} status={container_status(report, api)}")
        report.check("DB 不可用时 readiness 返回 503（不是假就绪）",
                     visitor.request("GET", READY_PATH).status == 503,
                     str(visitor.results[-1][1] if visitor.results else ""))
        report.run([*base, "start", "db"], timeout=120)
        report.check("恢复 db 后 api 回 healthy", wait_until(
            lambda: health_status(report, api) == "healthy", timeout=180, describe="api healthy"),
            health_status(report, api))
        report.check("恢复后 readiness 回 200 + status=ready", wait_until(
            lambda: visitor.request("GET", READY_PATH).status == 200, timeout=120, describe="readiness 200"))

        if not args.skip_negative:
            print("== 7. 负向：迁移失败 / grants 失败不得启动 api ==")
            # 7a. migrate 失败：env 里给错误的 migrator 口令（secret 文件仍是正确的），
            #     迁移连接认证失败退出非 0；api 依赖 service_completed_successfully 不应启动。
            neg_env = work / "neg-migrate.env"
            text = env_file.read_text(encoding="utf-8")
            text = re.sub(r"^POSTGRES_MIGRATOR_PASSWORD=.*$", "POSTGRES_MIGRATOR_PASSWORD=wrong-migrator-password",
                          text, flags=re.MULTILINE)
            neg_env.write_text(text, encoding="utf-8")
            neg_env.chmod(0o600)
            neg_project = "pl-trial-verify-negmig"
            neg_base = compose_base(neg_project, neg_env)
            clean_project(report, neg_base, neg_project)
            report.run([*neg_base, "up", "-d", "--remove-orphans"], timeout=600)
            neg_migrate = service_container(report, neg_base, "migrate")
            neg_api = service_container(report, neg_base, "api")
            report.check("迁移失败：migrate 容器 Exited(非 0)", wait_until(
                lambda: container_status(report, neg_migrate) == "exited", timeout=240, describe="neg migrate exited")
                and container_exit_code(report, neg_migrate) not in ("", "0"),
                f"ExitCode={container_exit_code(report, neg_migrate)}")
            time.sleep(5)
            report.check("迁移失败：api 没有进入 running/healthy",
                         container_status(report, neg_api) != "running",
                         f"api status={container_status(report, neg_api) or '<created/absent>'}")
            clean_project(report, neg_base, neg_project)

            # 7b. grants 失败：migrate 成功但授权脚本退出 3；api 依赖 grants 成功，不应启动。
            grants_override = work / "neg-grants.override.yaml"
            grants_override.write_text(
                "services:\n  grants:\n    command: [\"sh\", \"-c\", \"exit 3\"]\n", encoding="utf-8")
            neg_project = "pl-trial-verify-neggrants"
            neg_base = compose_base(neg_project, env_file, [grants_override])
            clean_project(report, neg_base, neg_project)
            report.run([*neg_base, "up", "-d", "--remove-orphans"], timeout=600)
            neg_migrate = service_container(report, neg_base, "migrate")
            neg_grants = service_container(report, neg_base, "grants")
            neg_api = service_container(report, neg_base, "api")
            report.check("授权失败：migrate 成功而 grants Exited(3)", wait_until(
                lambda: container_status(report, neg_grants) == "exited", timeout=240, describe="neg grants exited")
                and container_exit_code(report, neg_migrate) == "0"
                and container_exit_code(report, neg_grants) == "3",
                f"migrate={container_exit_code(report, neg_migrate)} grants={container_exit_code(report, neg_grants)}")
            time.sleep(5)
            report.check("授权失败：api 没有进入 running/healthy",
                         container_status(report, neg_api) != "running",
                         f"api status={container_status(report, neg_api) or '<created/absent>'}")
            clean_project(report, neg_base, neg_project)

    except Aborted as error:
        report.check("前置步骤完成（未中止）", False, str(error))
    except Exception as error:  # noqa: BLE001 - 验证脚本要保留现场并如实失败
        report.check("验证过程未抛出异常", False, f"{type(error).__name__}: {str(error)[:300]}")
    finally:
        print("== 8. 清理本项目资源（保留证据与脱敏渲染结果）==")
        clean_project(report, base, project)
        leftovers = report.run(["docker", "ps", "-a", "--filter", f"label=com.docker.compose.project={project}",
                                "--format", "{{.Names}}"], timeout=60).stdout.strip()
        report.check("本项目容器已清理（无残留）", not leftovers, leftovers)
        remaining_volumes = report.run(["docker", "volume", "ls", "--filter",
                                        f"label=com.docker.compose.project={project}", "-q"],
                                       timeout=60).stdout.strip()
        report.check("本项目卷已清理（无残留）", not remaining_volumes, remaining_volumes)
        if not args.keep_secrets:
            shutil.rmtree(work / "secrets", ignore_errors=True)
            for name in ("compose.env", "neg-migrate.env"):
                try:
                    (work / name).unlink()
                except FileNotFoundError:
                    pass

    code = report.summary()
    evidence["checks"] = report.results
    evidence["commands"] = report.commands
    evidence["client_requests"] = visitor.results + owner.results + wrong.results
    evidence["exit_code"] = code
    if args.json:
        target = Path(args.json)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    if code != 0 and args.keep:
        print("  （--keep：保留本项目容器便于排查；排查后按项目名清理）")
    return code


if __name__ == "__main__":
    sys.exit(main())
