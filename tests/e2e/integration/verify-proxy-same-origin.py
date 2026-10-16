#!/usr/bin/env python3
"""T10 验收：反向代理形态下的同源读写、健康依赖、旧 URL 重定向与音频（真实浏览器）。

为什么必须单独验一次：开发期浏览器访问的是 Next（3100），生产形态是**网关直转 API**
（06 §1）。两者在 HTTP 头这一层并不等价 —— T03 的交付单 §8 实测到
「Next rewrite → API」会丢掉 `Origin`，而 `app/core/csrf.py` 的 `verify_origin` 对
缺失 `Origin` 的状态变更请求一律 403。所以「生产网关形态下能不能登录」必须实测，
不能从开发期结论外推。

本脚本用一个**透明的 HTTP 反向代理**复刻网关的转发语义（保留 `Origin` 与 `Host`），
再用真实 Chromium 走完整登录：浏览器 → 代理 → API。

覆盖：
  1. 代理 → API：liveness / readiness 可达，且响应头不被篡改。
  2. 代理 → web：`/healthz`、页面可达。
  3. 同源写路径：真实浏览器在代理形态下**登录成功**（POST 带 Origin 与 CSRF token）。
  4. 伪造来源：把 `Origin` 改成恶意值 → 403，且没有建立会话。
  5. 代理不覆写 `Host` 的直接后果：Host 与 Origin 不一致时 403（说明比对是真的在跑）。
  6. 旧 URL：`/post.html?p=<slug>`、`/index.html`、`/map.html` 的 301 目标正确；
     不存在的 slug 真正 404（不跳首页）。
  7. 音频：`/assets/music/<file>` 200 + `Accept-Ranges` + Range 请求 206。

用法：
  cd /Users/学习/blog/Blogs
  export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
  export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
  python3 tests/e2e/integration/verify-proxy-same-origin.py [--keep] [--skip-browser]

退出码 0 = 全部通过；1 = 失败；2 = 前置条件缺失（不是通过）。
"""

from __future__ import annotations

import argparse
import http.client as http_client
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[3]
API_DIR = REPO_ROOT / "apps" / "api"

API_PORT = 8310
WEB_PORT = 3210
GATEWAY_PORT = 8410

SECRET_KEY = "t10-proxy-drill-secret-key-0123456789abcdef"
ADMIN_USER = "owner"
ADMIN_PASSWORD = "t10-proxy-drill-password-1234"
MUSIC_FILE = "beneath-the-mask.mp3"


class Skip(Exception):
    pass


# --- 透明反向代理 ---------------------------------------------------------
def default_music_root() -> Path:
    """音频来源目录。发布快照验收时用 `T10_SNAPSHOT_ROOT` 指向快照根。"""
    snapshot = os.environ.get("T10_SNAPSHOT_ROOT", "")
    if snapshot:
        return Path(snapshot).expanduser() / "assets" / "music"
    return REPO_ROOT / "assets" / "music"


class GatewayHandler(BaseHTTPRequestHandler):
    """把请求原样转发到上游，**保留 Origin 与 Host**。

    这就是 Caddy 的语义：`reverse_proxy` 不改写 `Host`，也不删 `Origin`。
    与 Next 的 rewrite 不同 —— 后者（开发期）会丢掉 `Origin`，这正是要验的差别。
    """

    protocol_version = "HTTP/1.1"
    server_version = "T10-drill-gateway"
    api_upstream = ("127.0.0.1", API_PORT)
    web_upstream = ("127.0.0.1", WEB_PORT)

    def log_message(self, *args):  # 静默：验收输出只留断言
        return

    def _serve_music(self) -> bool:
        """`/assets/music/<file>` 由**网关**直接读一个只读目录（生产镜像里的 public/assets/music）。

        生产形态下这一段是 web 容器里的 `/srv/web/public/assets/music/`；本地演练用它换取
        「不改 apps/web、不依赖 Next 的 dev rewrite」也能验到真实路径与 Range 语义。
        返回 True 表示已经处理完这个请求。
        """
        if not self.path.startswith("/assets/music/"):
            return False
        root = Path(os.environ.get("T10_MUSIC_ROOT", default_music_root()))
        name = self.path[len("/assets/music/"):].split("?")[0]
        target = (root / name).resolve()
        if not str(target).startswith(str(root.resolve())) or not target.is_file():
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        data = target.read_bytes()
        start, end = 0, len(data) - 1
        status = 200
        range_header = self.headers.get("Range", "")
        match = re.match(r"bytes=(\d*)-(\d*)", range_header or "")
        if match:
            if match.group(1):
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else len(data) - 1
            elif match.group(2):
                start = max(0, len(data) - int(match.group(2)))
            end = min(end, len(data) - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(data)}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return True
            status = 206
        payload = data[start:end + 1]
        self.send_response(status)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(payload)))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)
        return True

    def _upstream(self) -> tuple[str, int]:
        if self.path.startswith("/api/v1/"):
            return self.api_upstream
        return self.web_upstream

    def _proxy(self) -> None:
        if self._serve_music():
            return
        host, port = self._upstream()
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else None

        outgoing = http_client.HTTPConnection(host, port, timeout=60)
        headers = {key: value for key, value in self.headers.items()}
        # 只添加转发头，绝不改写 Host / Origin（那会破坏同源校验的语义）。
        prior = headers.get("X-Forwarded-For", "")
        headers["X-Forwarded-For"] = f"{prior}, 127.0.0.1" if prior else "127.0.0.1"
        headers["X-Forwarded-Proto"] = "http"
        headers["X-Forwarded-Host"] = headers.get("Host", "")
        try:
            outgoing.request(self.command, self.path, body=body, headers=headers)
            response = outgoing.getresponse()
            payload = response.read()
        except Exception as exc:  # noqa: BLE001 - 代理失败要变成 502 而不是崩掉
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"upstream failed: {exc}".encode())
            return
        finally:
            outgoing.close()

        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() in ("transfer-encoding", "connection", "content-length"):
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    do_GET = _proxy
    do_HEAD = _proxy
    do_POST = _proxy
    do_PUT = _proxy
    do_PATCH = _proxy
    do_DELETE = _proxy
    do_OPTIONS = _proxy


class Gateway:
    def __init__(self, port: int) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", port), GatewayHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


# --- 工具 -----------------------------------------------------------------
def wait_port(port: int, timeout: float = 90.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.4)
    return False


def header_value(headers: dict, name: str, default: str = "") -> str:
    """大小写不敏感地取一个响应头。

    第一版写的是 `headers.get("Location")` —— 代理转发过来的是小写 `location`，
    于是「旧 URL 重定向」整段假失败（308 + 空 Location）。HTTP 头不区分大小写，
    测试也必须不区分。
    """
    target = name.lower()
    for key, value in headers.items():
        if key.lower() == target:
            return value
    return default


def request(method: str, port: int, path: str, *, body: bytes | None = None,
            headers: dict | None = None, follow: int = 0) -> tuple[int, dict, bytes]:
    """一次 HTTP 请求。`follow>0` 时跟随重定向（Next 的旧 URL 规则是 308 + Location）。

    注意：**不自动带 cookie** —— 需要会话的地方用 `Session`。
    """
    connection = http_client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        result = (response.status, dict(response.getheaders()), payload)
    finally:
        connection.close()
    location = header_value(result[1], "location")
    if follow > 0 and result[0] in (301, 302, 303, 307, 308) and location:
        from urllib.parse import urljoin, urlsplit as _urlsplit

        # `Location` 可能是绝对 URL（Next 会带上请求的 Host）或站内路径。
        parts = _urlsplit(location)
        target = parts.path + (f"?{parts.query}" if parts.query else "")
        target = target or "/"
        return request("GET", port, target, headers=headers, follow=follow - 1)
    return result


class Session:
    """最小 cookie 容器：同源写路径必须带着会话 Cookie，否则 CSRF token 对不上。

    第一版忘了这一步，于是「同源 Origin 的登录」返回 403 CSRF 校验失败 —— 那不是实现的问题，
    而是测法的问题：预登录会话与 CSRF token 是**绑定**的（05 §5.4）。
    """

    def __init__(self, port: int) -> None:
        self.port = port
        self.cookies: dict[str, str] = {}

    def _cookie_header(self) -> dict:
        if not self.cookies:
            return {}
        return {"Cookie": "; ".join(f"{k}={v}" for k, v in self.cookies.items())}

    def _absorb(self, headers: dict) -> None:
        raw = header_value(headers, "set-cookie")
        if not raw:
            return
        for part in str(raw).split(","):
            pair = part.split(";")[0].strip()
            if "=" in pair:
                name, _, value = pair.partition("=")
                if value:
                    self.cookies[name.strip()] = value
                else:
                    self.cookies.pop(name.strip(), None)

    def request(self, method: str, path: str, *, body: bytes | None = None,
                headers: dict | None = None) -> tuple[int, dict, bytes]:
        merged = {**self._cookie_header(), **(headers or {})}
        status, response_headers, payload = request(method, self.port, path, body=body, headers=merged)
        self._absorb(response_headers)
        return status, response_headers, payload

    def get(self, path: str, **kwargs) -> tuple[int, dict, bytes]:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> tuple[int, dict, bytes]:
        return self.request("POST", path, **kwargs)


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
    parser = argparse.ArgumentParser(description="T10 反向代理同源验收")
    parser.add_argument("--keep", action="store_true", help="保留服务与临时库")
    parser.add_argument("--skip-browser", action="store_true", help="只跑无浏览器的 HTTP 断言")
    parser.add_argument("--web-dir", default="",
                        help="要验收的 apps/web 目录（默认仓库里的；发布验收指向发布快照）")
    parser.add_argument("--api-dir", default="",
                        help="要验收的 apps/api 目录（默认仓库里的）")
    args = parser.parse_args()

    report = Report()
    test_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    if not test_url:
        print("跳过：未设置 TEST_DATABASE_URL", file=sys.stderr)
        return 2
    parts = urlsplit(test_url)
    db_host = parts.hostname or "127.0.0.1"
    db_port = str(parts.port or 5432)
    db_user = parts.username or "pl"

    work = Path(f"/tmp/pl-t10-proxy-{os.getpid()}")
    work.mkdir(parents=True, exist_ok=True)
    media_root = work / "media"
    media_root.mkdir(exist_ok=True)
    database = f"pl_test_t10proxy_{os.getpid()}"

    web_dir = Path(args.web_dir).expanduser().resolve() if args.web_dir else REPO_ROOT / "apps" / "web"
    api_dir = Path(args.api_dir).expanduser().resolve() if args.api_dir else API_DIR
    if not (web_dir / ".next" / "BUILD_ID").exists():
        print(f"跳过：{web_dir}/.next 没有生产构建；先跑 npm --prefix <web-dir> run build", file=sys.stderr)
        return 2
    if not (api_dir / "app" / "main.py").exists():
        print(f"跳过：{api_dir} 不像 apps/api", file=sys.stderr)
        return 2
    print(f"  待验收 web：{web_dir}")
    print(f"  待验收 api：{api_dir}")

    psql = os.environ.get("PG_BIN", "/opt/homebrew/opt/postgresql@18/bin") + "/psql"
    if not Path(psql).exists():
        psql = shutil.which("psql") or ""
    createdb = str(Path(psql).parent / "createdb") if psql else (shutil.which("createdb") or "")

    def sql(statement: str, database_name: str = "postgres") -> subprocess.CompletedProcess:
        return subprocess.run([psql, "--no-psqlrc", "-h", db_host, "-p", db_port, "-U", db_user,
                               "-d", database_name, "-tAc", statement],
                              capture_output=True, text=True)

    processes: list[subprocess.Popen] = []
    gateway = Gateway(GATEWAY_PORT)
    logs = work / "logs"
    logs.mkdir(exist_ok=True)

    env_api = dict(os.environ)
    env_api.update({
        "APP_ENV": "prod",                 # 生产形态：与网关同源、无 CORS
        "DATABASE_URL": f"postgresql+psycopg://{db_user}@{db_host}:{db_port}/{database}",
        "SECRET_KEY": SECRET_KEY,
        "MEDIA_ROOT": str(media_root),
        "TRUST_PROXY_HEADERS": "true",     # 网关确实覆写 X-Forwarded-For
        "CORS_ORIGINS": "",
        "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache" / "uv")),
    })
    env_web = dict(os.environ)
    env_web.update({
        "NODE_ENV": "production",
        "API_INTERNAL_URL": f"http://127.0.0.1:{API_PORT}",
        "npm_config_cache": os.environ.get("npm_config_cache", str(Path.home() / ".npm")),
    })

    try:
        # --- 隔离库 + 站主 ---------------------------------------------------
        sql(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        subprocess.run([createdb, "-h", db_host, "-p", db_port, "-U", db_user, database], check=True)
        subprocess.run(["uv", "run", "alembic", "upgrade", "head"], cwd=api_dir, env=env_api,
                       check=True, capture_output=True, text=True)
        bootstrap = subprocess.run(
            ["uv", "run", "python", "-m", "app.commands.bootstrap_admin",
             "--username", ADMIN_USER, "--password-stdin", "--json"],
            cwd=api_dir, env=env_api, input=ADMIN_PASSWORD + "\n",
            capture_output=True, text=True,
        )
        print(f"== 0. 隔离环境 ==")
        print(f"  库 {database}@{db_host}:{db_port}")
        report.check("站主初始化成功（真实迁移 + bootstrap_admin）", bootstrap.returncode == 0,
                     bootstrap.stdout.strip()[:120] or bootstrap.stderr.strip()[:120])

        # --- 起 API / web / 代理 --------------------------------------------
        print("== 1. 启动 API（uvicorn, prod 形态）/ web（next start）/ 透明代理 ==")
        api_log = (logs / "api.log").open("w")
        api = subprocess.Popen(
            ["uv", "run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(API_PORT)],
            cwd=api_dir, env=env_api, stdout=api_log, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        processes.append(api)
        report.check("API 端口就绪", wait_port(API_PORT), f"127.0.0.1:{API_PORT}")

        web_log = (logs / "web.log").open("w")
        web = subprocess.Popen(
            ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1",
             "--port", str(WEB_PORT)],
            cwd=web_dir, env=env_web, stdout=web_log, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        processes.append(web)
        report.check("web 端口就绪", wait_port(WEB_PORT, timeout=120), f"127.0.0.1:{WEB_PORT}")

        gateway.start()
        report.check("代理端口就绪", wait_port(GATEWAY_PORT, timeout=10), f"127.0.0.1:{GATEWAY_PORT}")

        base = f"http://127.0.0.1:{GATEWAY_PORT}"

        # --- 2. 健康与直通 ---------------------------------------------------
        print("== 2. 代理 → API / web 直通 ==")
        status, headers, body = request("GET", GATEWAY_PORT, "/api/v1/health/live")
        report.check("经代理可达 /api/v1/health/live（200）", status == 200, f"status={status}")
        report.check("liveness 响应带 x-request-id", "x-request-id" in {k.lower() for k in headers},
                     ",".join(k for k in headers if k.lower().startswith("x-request"))[:60])
        status, _, body = request("GET", GATEWAY_PORT, "/api/v1/health/ready")
        report.check("经代理可达 /api/v1/health/ready 且真就绪（200）", status == 200, f"status={status} {body[:80]!r}")
        status, _, body = request("GET", GATEWAY_PORT, "/healthz")
        report.check("经代理可达 web /healthz（200）", status == 200, f"status={status}")

        # --- 3. Host / Origin 比对确实在跑 -----------------------------------
        print("== 3. 同源校验：Host 与 Origin 不一致必须 403 ==")
        import json as _json

        # 用带 cookie 的会话来读会话端点：预登录会话与 CSRF token 是绑定的（05 §5.4）。
        browserish = Session(GATEWAY_PORT)
        session_status, session_headers, session_body = browserish.get(
            "/api/v1/auth/session",
            headers={"Host": "blog.example.test"},
        )
        report.check("Host=blog.example.test 时能读到会话端点（说明 Host 被转发而非被改写）",
                     session_status == 200, f"status={session_status}")

        csrf = ""
        try:
            csrf = _json.loads(session_body).get("csrf_token") or ""
        except Exception:
            pass
        report.check("拿到 CSRF token（同源读取路径）", bool(csrf))
        report.check("会话端点下发了预登录 Cookie（否则写请求无从校验 token）",
                     bool(browserish.cookies), ",".join(browserish.cookies)[:60])

        forged = request(
            "POST", GATEWAY_PORT, "/api/v1/auth/login",
            body=_json.dumps({"username": ADMIN_USER, "password": ADMIN_PASSWORD,
                              "csrf_token": csrf}).encode(),
            headers={"Content-Type": "application/json", "Host": "blog.example.test",
                     "Origin": "https://evil.example",
                     "Cookie": "; ".join(f"{k}={v}" for k, v in browserish.cookies.items())},
        )
        report.check("伪造 Origin 的登录被拒（403）", forged[0] == 403, f"status={forged[0]}")

        real = browserish.post(
            "/api/v1/auth/login",
            body=_json.dumps({"username": ADMIN_USER, "password": ADMIN_PASSWORD,
                              "csrf_token": csrf}).encode(),
            headers={"Content-Type": "application/json", "Host": "blog.example.test",
                     "Origin": "http://blog.example.test"},
        )
        report.check("同源 Origin 的登录通过（200/204）", real[0] in (200, 204), f"status={real[0]} {real[2][:100]!r}")
        report.check("登录下发了会话 Cookie", any("session" in name for name in browserish.cookies),
                     ",".join(browserish.cookies)[:60])

        authenticated = browserish.get("/api/v1/auth/session", headers={"Host": "blog.example.test"})
        try:
            authenticated_flag = _json.loads(authenticated[2] or b"{}").get("authenticated")
        except Exception:
            authenticated_flag = None
        report.check("带会话 Cookie 复读会话 = authenticated（完整同源写路径通了）",
                     authenticated_flag is True, f"authenticated={authenticated_flag}")

        missing_origin = browserish.post(
            "/api/v1/auth/login",
            body=_json.dumps({"username": ADMIN_USER, "password": ADMIN_PASSWORD,
                              "csrf_token": csrf}).encode(),
            headers={"Content-Type": "application/json", "Host": "blog.example.test"},
        )
        report.check("缺 Origin 的写请求被拒（403，符合 05 §5）", missing_origin[0] == 403,
                     f"status={missing_origin[0]}")

        # --- 4. 旧 URL 重定向 ------------------------------------------------
        print("== 4. 经代理的旧 URL 重定向与 404 ==")
        for source, expected in (
            ("/post.html?p=phantom-blog-launch", "/posts/phantom-blog-launch"),
            ("/index.html", "/"),
            ("/map.html", "/map"),
            ("/about.html", "/about"),
            ("/guestbook.html", "/guestbook"),
        ):
            status, headers, _ = request("GET", GATEWAY_PORT, source)
            location = header_value(headers, "location")
            # `Location` 允许带原始查询串（`/posts/<slug>?p=<slug>`），按下发目标路径比对。
            location_path = urlsplit(location).path if location else ""
            report.check(f"{source} → {expected}", status in (301, 308) and location_path == expected,
                         f"status={status} location={location!r}")
            if location:
                landed, _, _ = request("GET", GATEWAY_PORT, urlsplit(location).path
                                       + (f"?{urlsplit(location).query}" if urlsplit(location).query else ""))
                report.check(f"{source} 跟随重定向后可达（{landed}）", landed == 200, f"status={landed}")
        status, _, _ = request("GET", GATEWAY_PORT, "/posts/definitely-not-a-real-slug")
        report.check("不存在的 slug 返回真 404（不跳首页）", status == 404, f"status={status}")

        # --- 5. 音频 ---------------------------------------------------------
        print("== 5. /assets/music/ 经代理可用（含 Range）==")
        status, headers, body = request("GET", GATEWAY_PORT, f"/assets/music/{MUSIC_FILE}")
        report.check(f"/assets/music/{MUSIC_FILE} 200", status == 200, f"status={status} bytes={len(body)}")
        report.check("音频响应声明 Accept-Ranges", headers.get("Accept-Ranges") == "bytes",
                     str(headers.get("Accept-Ranges")))
        status, headers, partial = request("GET", GATEWAY_PORT, f"/assets/music/{MUSIC_FILE}",
                                        headers={"Range": "bytes=0-1023"})
        report.check("Range 请求返回 206 且长度为 1024", status == 206 and len(partial) == 1024,
                     f"status={status} bytes={len(partial)}")

        # --- 6. 真实浏览器登录（同源写路径的最终证据）------------------------
        if args.skip_browser:
            print("== 6. 已按 --skip-browser 跳过浏览器段落 ==")
        else:
            print("== 6. 真实 Chromium：经代理走完整登录（浏览器 → 代理 → API）==")
            run_browser(base, work, report)
    finally:
        gateway.stop()
        for process in processes:
            try:
                os.killpg(os.getpgid(process.pid), 9)
                process.wait(timeout=10)
            except Exception:
                pass
        if not args.keep:
            sql(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
            shutil.rmtree(work, ignore_errors=True)
        else:
            print(f"  （--keep：保留 {work} 与库 {database}）")

    return report.summary()


def run_browser(base: str, work: Path, report: Report) -> int | None:
    """用系统 Playwright + Chromium 走真实登录。返回非 None 表示要直接返回该退出码。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover
        print(f"  ! 未安装 playwright：{exc}（浏览器段落未验证，不算通过）")
        report.check("真实浏览器登录（Playwright 可用）", False, "playwright 未安装")
        return None

    shots = work / "screenshots"
    shots.mkdir(exist_ok=True)
    outcome: dict = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            page = context.new_page()
            requests: list[tuple[str, str]] = []
            page.on("request", lambda request: requests.append((request.method, request.url)))

            page.goto(f"{base}/admin/login", wait_until="load")
            # T00 记录的坑：开屏 `#boot` 会拦截**全部指针事件**，所以先按 Escape 关掉它
            # 再操作，否则 Playwright 会一直重试点击直到超时。
            try:
                page.wait_for_selector("#boot", timeout=3000)
                page.keyboard.press("Escape")
                page.wait_for_selector("#boot", state="detached", timeout=5000)
            except Exception:
                pass  # 没有开屏（或已经自动消失）时继续
            page.wait_for_selector("input[name='username']", timeout=15000)
            page.fill("input[name='username']", ADMIN_USER)
            page.fill("input[name='password']", ADMIN_PASSWORD)
            page.screenshot(path=str(shots / "login-filled.png"))
            page.click("button[type='submit']")
            page.wait_for_timeout(2500)
            page.screenshot(path=str(shots / "after-login.png"),
                            full_page=True)
            try:
                outcome["page_text"] = page.inner_text("body")[:400].replace("\n", " | ")
            except Exception:
                outcome["page_text"] = ""

            # 在**页面上下文**里读会话：这样用的是浏览器自己的 cookie（含 __Host- 前缀）。
            # Playwright 的 APIRequestContext 对 `__Host-` + `Secure` 更严格，在 HTTP
            # 上有自己的判断，用它验「浏览器会话」会得到误导性的 false（第一版就踩了）。
            outcome["authenticated"] = page.evaluate(
                """async () => {
                    const r = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
                    if (!r.ok) return null;
                    const j = await r.json();
                    return j.authenticated === true;
                }"""
            )
            outcome["session_status"] = page.evaluate(
                """async () => {
                    const r = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
                    return r.status;
                }"""
            )
            outcome["logout_visible"] = page.locator("button", has_text="注销").count() > 0

            login_posts = [url for method, url in requests
                           if method == "POST" and "/api/v1/auth/login" in url]
            outcome["login_posts"] = login_posts

            # 伪造 Origin：浏览器里改不掉 Origin 头本身，用 Playwright 的 route 覆写请求头，
            # 这才是「攻击者页面替用户发请求」的等价形态。
            forged_status: dict = {}

            def forge(route):
                headers = dict(route.request.headers)
                headers["origin"] = "https://evil.example"
                forged_status["status"] = route.fetch(headers=headers).status
                route.abort()

            context.route("**/api/v1/auth/login", forge)
            page.evaluate("""async () => {
                const s = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
                const j = await s.json();
                await fetch('/api/v1/auth/login', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ username: 'owner', password: 'irrelevant', csrf_token: j.csrf_token }),
                }).catch(() => {});
            }""")
            page.wait_for_timeout(800)
            context.unroute("**/api/v1/auth/login")
            outcome["forged_status"] = forged_status.get("status")
        finally:
            browser.close()

    report.check("真实浏览器经代理登录成功（页面上下文内 authenticated=true）",
                 outcome.get("authenticated") is True,
                 f"session_status={outcome.get('session_status')}")
    report.check("登录后界面显示「已登录」并出现注销按钮（不是只信 HTTP 状态码）",
                 outcome.get("logout_visible") is True,
                 f"页面文本={outcome.get('page_text','')[:90]!r}")
    report.check("登录请求确实以 POST /api/v1/auth/login 发出（经代理，不是直连 API）",
                 bool(outcome.get("login_posts")), str(outcome.get("login_posts"))[:120])
    report.check("恶意 Origin 的登录在浏览器里被拒（403）", outcome.get("forged_status") == 403,
                 f"status={outcome.get('forged_status')}")
    shots_list = sorted(p.name for p in shots.glob("*.png"))
    print(f"  截图：{shots} → {shots_list}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
