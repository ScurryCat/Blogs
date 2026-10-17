#!/usr/bin/env python3
"""给**本地分享的 dev 库**灌一份可整体替换的演示内容（2026-10-17 · 用户反馈 R3）。

为什么需要：交接包验收要求 9 个视觉还原界面（殿堂/图库/天鹅绒/导航/COOP/放课后/手记/
印象空间/IM）都有真实可看的内容，而本地分享库默认几乎是空的。这里把「造演示内容」
做成一条可重放、可清理、可备份的命令，方便后续一次性替换。

边界（与既有种子脚本的分工）：
  - 放课后 / COOP / 作品 / 相册：复用 `tools/e2e-seed-previews.py`（已扩量）；
  - 手记：复用 `tools/e2e-seed-journal.py --demo`（主题化演示手记）；
  - 导航专题：复用 `tools/e2e-seed-palaces.py`（需要先导入真实文章）；
  - 技能全书 / 印象空间：复用 `apps/api/app/modules/skills/seed.py`（代码内真实内容）；
  - 文章：`app.commands.import_legacy`（真实旧站文章，专题发布的门槛）；
  - IM 内容：代码内剧本（`app/modules/messaging/stories/`），无需写库。

安全边界：
  - **不动 owner 密码**：新建独立管理员 `demo-seeder`（可用 --admin/--password 改），
    种子脚本通过 `SEED_ADMIN_USERNAME` 使用它；
  - 只写本地 db（默认 pl_test）与 API 的 MEDIA_ROOT，不碰生产；
  - 演示条目全部有固定标识（标题 / slug / 名称），`--clean` 可逐条删除；
  - `--backup` 先 pg_dump，`--restore` 可整体回滚。

用法：
    # 1) 首次：建演示管理员 + 灌内容（密码从环境变量读，别写进命令历史）
    SEED_ADMIN_PASSWORD='<至少 12 位>' python3 tools/seed-demo-content.py --create-admin

    # 2) 只刷新内容
    SEED_ADMIN_PASSWORD='...' python3 tools/seed-demo-content.py

    # 3) 备份 / 整体替换前回滚
    python3 tools/seed-demo-content.py --backup
    python3 tools/seed-demo-content.py --restore /tmp/pl-demo-backup-....sql

    # 4) 删除本脚本创建的全部演示条目
    SEED_ADMIN_PASSWORD='...' python3 tools/seed-demo-content.py --clean

退出码：0 = 全部步骤成功；1 = 有失败（逐条打印）。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# 本机若有系统代理，Python urllib 会把 127.0.0.1 也送进代理（实测 502）。
os.environ.setdefault("no_proxy", "127.0.0.1,localhost,::1")
os.environ.setdefault("NO_PROXY", os.environ["no_proxy"])

REPO = Path(__file__).resolve().parents[1]
API_DIR = REPO / "apps/api"
PG_BIN = Path("/opt/homebrew/opt/postgresql@18/bin")

DEFAULT_BASE = "http://127.0.0.1:8100"
DEFAULT_DB_URL = "postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
DEFAULT_ADMIN = "demo-seeder"
SECRET_KEY = "demo-seed-placeholder-0123456789abcdef"
UV_CACHE = REPO / ".dsh/uv-cache"

# 演示条目标识：--clean 按这些标识逐条删除；计数也按这些清单核对。
DEMO_SKILL_SLUGS = ("accessibility-audit", "browser-verification-harness")
DEMO_RECORD_SLUGS = (
    "proxy-hijacked-local-acceptance",
    "phone-host-stylesheets-missing",
    "dangling-aria-controls",
    "stale-isolated-cluster-process",
)
LEISURE_TITLES = (
    "赛博酒馆的第二夜",
    "午夜电台与猫",
    "葬送的芙莉莲",
    "空洞骑士：丝之歌",
    "Hi-Fi Rush",
    "Persona 5 Royal",
)
COOP_NAMES = ("猫与咖啡", "深夜编译中", "像素流浪者", "Next.js 文档", "MDN Web Docs")
JOURNAL_TITLES = (
    "视觉还原第一屏：把手机里的九个应用摆回设计稿",
    "可访问性不是最后一轮才做的事",
    "系统代理骗了我一次",
    "隔离集群的残留进程",
    "手机宿主里三张样式表没加载",
    "悬空 aria-controls 与结构巡检",
    "首页刷新：从看不清到能选版",
    "今天的四轩茶屋",
)
PALACE_SLUGS = ("phantom-base", "noise-and-signal", "velvet-door", "fourth-wall")
PROJECT_SLUGS = (
    "phantom-log-next",
    "velvet-compendium",
    "ins-messaging",
    "a11y-audit-toolkit",
    "tokyo-roam-weather",
)
ALBUM_SLUGS = ("tokyo-nights", "screens", "daily-fragments")


class SeedError(RuntimeError):
    pass


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.origin = self.base
        self.cookies: dict[str, str] = {}
        self.csrf: str | None = None

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        data = None
        if body is not None:
            data = json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if self.cookies:
            request.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in self.cookies.items()))
        request.add_header("Origin", self.origin)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                for header in response.headers.get_all("Set-Cookie") or []:
                    pair = header.split(";")[0]
                    if "=" in pair:
                        name, value = pair.split("=", 1)
                        self.cookies[name.strip()] = value.strip()
                raw = response.read()
                try:
                    return response.status, json.loads(raw or b"{}")
                except json.JSONDecodeError:
                    return response.status, raw
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return error.code, raw

    def login(self, username: str, password: str) -> None:
        status, payload = self.request("GET", "/api/v1/auth/session")
        csrf = payload.get("csrf_token") if isinstance(payload, dict) else None
        if status != 200 or not csrf:
            raise SeedError(f"取 CSRF 失败：{status}")
        status, payload = self.request(
            "POST",
            "/api/v1/auth/login",
            {"username": username, "password": password, "csrf_token": csrf},
        )
        if status != 200:
            raise SeedError(f"登录失败：{status} {str(payload)[:160]}")
        self.csrf = (payload.get("csrf_token") if isinstance(payload, dict) else None) or csrf
        self.cookies = dict(self.cookies)

    def write_headers(self) -> dict[str, str]:
        return {"X-CSRF-Token": self.csrf or ""}

    def items(self, path: str) -> list[dict[str, Any]]:
        status, payload = self.request("GET", path)
        if status != 200 or not isinstance(payload, dict):
            raise SeedError(f"读取 {path} 失败：{status} {str(payload)[:120]}")
        return list(payload.get("items") or [])


def run(command: list[str], *, env: dict[str, str] | None = None, cwd: Path | None = None) -> None:
    """跑子命令；失败就抛（保留 stdout/stderr 便于排查）。"""
    merged = dict(os.environ)
    if env:
        merged.update(env)
    print(f"$ {' '.join(command)}")
    result = subprocess.run(command, cwd=cwd or REPO, env=merged, text=True, capture_output=True)
    if result.returncode != 0:
        tail = (result.stdout + result.stderr).strip().splitlines()[-8:]
        raise SeedError("命令失败：\n  " + "\n  ".join(tail))
    if result.stdout.strip():
        print("  " + result.stdout.strip().splitlines()[-1])


def ensure_admin(*, admin: str, password: str, database_url: str, reset: bool) -> None:
    command = [
        "uv", "run", "python", "-m", "app.commands.bootstrap_admin",
        "--username", admin, "--password-stdin",
    ]
    if reset:
        command.append("--reset-password")
    print(f"$ {' '.join(command)}（密码从 stdin 读入，不回显）")
    merged = dict(os.environ)
    merged.update({"DATABASE_URL": database_url, "SECRET_KEY": SECRET_KEY, "UV_CACHE_DIR": str(UV_CACHE)})
    result = subprocess.run(command, cwd=API_DIR, env=merged, input=password + "\n", text=True, capture_output=True)
    if result.returncode != 0:
        raise SeedError(f"创建/重置管理员失败：{result.stdout[-400:]}{result.stderr[-400:]}")
    print("  " + (result.stdout.strip() or "ok"))


def seed(base: str, admin: str, password: str, database_url: str) -> None:
    env = {
        "DATABASE_URL": database_url,
        "SECRET_KEY": SECRET_KEY,
        "UV_CACHE_DIR": str(UV_CACHE),
        "SEED_ADMIN_USERNAME": admin,
        "no_proxy": "127.0.0.1,localhost,::1",
        "NO_PROXY": "127.0.0.1,localhost,::1",
    }
    # 1) 真实文章（专题发布门槛）
    run(
        [
            "uv", "run", "python", "-m", "app.commands.import_legacy",
            "--apply", "--no-covers", "--repo-root", str(REPO),
        ],
        env=env,
        cwd=API_DIR,
    )
    # 2) 放课后 / COOP / 作品 / 相册
    run([sys.executable, "tools/e2e-seed-previews.py", base, password], env=env)
    # 3) 手记（主题化演示）
    run([sys.executable, "tools/e2e-seed-journal.py", base, password, "--demo"], env=env)
    # 4) 导航专题
    run([sys.executable, "tools/e2e-seed-palaces.py", base, password], env=env)
    # 5) 技能全书 + 印象空间（CLI，幂等）
    run(
        [
            "uv", "run", "python", "-m", "app.modules.skills.seed",
            "--apply", "--publish", "--project-slug", "p5-blog",
        ],
        env=env,
        cwd=API_DIR,
    )


def print_counts(client: Client) -> None:
    checks = [
        ("殿堂作品", "/api/v1/projects?limit=30", 5),
        ("图库相册", "/api/v1/gallery/albums?limit=30", 3),
        ("放课后", "/api/v1/leisure/entries?limit=30", 6),
        ("COOP 友链", "/api/v1/coop/links?limit=30", 5),
        ("手记", "/api/v1/journal/entries?limit=30", 8),
        ("导航专题", "/api/v1/nav/palaces?limit=30", 4),
        ("天鹅绒技能", "/api/v1/skills?limit=30", 9),
        ("印象空间记录", "/api/v1/exploration/records?limit=30", 11),
    ]
    print("\n== 演示内容计数 ==")
    print("（当前：公开返回条数；阈值 = 交付文档约定的每个界面最少内容量）")
    weak = 0
    for label, path, threshold in checks:
        try:
            count = len(client.items(path))
        except SeedError as error:
            print(f"  ✗ {label}: {error}")
            weak += 1
            continue
        mark = "✓" if count >= threshold else "✗"
        if count < threshold:
            weak += 1
        print(f"  {mark} {label}: {count}（目标 ≥{threshold}）")
    if weak:
        raise SeedError(f"{weak} 个界面的内容量未达阈值")


def print_deep_links() -> None:
    print(
        """
== 手机 deep link 清单（在任意页面都能用） ==
  手机桌面     /?phone=home
  IM          /?phone=ins              （app 内屏：screen=feed|detail|saved）
  手记        /?phone=journal          （screen=list|calendar）
  放课后      /?phone=leisure          （screen=anime|game）
  COOP        /?phone=coop             （screen=links）
  异世界导航  /?phone=metanav          （screen=palaces|resolve|search|mugen）
  我的殿堂    /?phone=showcase         （screen=projects|project|photos|album）
  天鹅绒      /?phone=velvet           （screen=book|skill）
  印象空间    /?phone=mementos         （screen=records|record）
  旧站链接    /?phone=palace|tokyo|cast|profile（情报 / 地图 / 天气 / 档案）
  详情类再带 item：?phone=showcase&screen=project&item=<slug>
  无效 phone 会安全回退到手机桌面（不白屏）。
""".rstrip()
    )


def clean(client: Client) -> None:
    plans: list[tuple[str, str, str, set[str], str]] = [
        ("放课后", "/api/v1/admin/leisure/entries?limit=30", "title", set(LEISURE_TITLES), "/api/v1/admin/leisure/entries"),
        ("COOP 友链", "/api/v1/admin/friends?limit=30", "name", set(COOP_NAMES), "/api/v1/admin/friends"),
        ("手记", "/api/v1/admin/journal/entries?limit=30", "title", set(JOURNAL_TITLES), "/api/v1/admin/journal/entries"),
        ("导航专题", "/api/v1/admin/nav/palaces?limit=30", "slug", set(PALACE_SLUGS), "/api/v1/admin/nav/palaces"),
        ("殿堂作品", "/api/v1/admin/projects?limit=30", "slug", set(PROJECT_SLUGS), "/api/v1/admin/projects"),
        ("图库相册", "/api/v1/admin/albums?limit=30", "slug", set(ALBUM_SLUGS), "/api/v1/admin/albums"),
        ("天鹅绒技能", "/api/v1/admin/skills?limit=30", "slug", set(DEMO_SKILL_SLUGS), "/api/v1/admin/skills"),
        ("印象空间记录", "/api/v1/admin/exploration/records?limit=30", "slug", set(DEMO_RECORD_SLUGS), "/api/v1/admin/exploration/records"),
    ]
    removed = 0
    for label, list_path, key, wanted, delete_base in plans:
        try:
            items = client.items(list_path)
        except SeedError as error:
            print(f"  ✗ {label} 读取失败：{error}")
            continue
        for item in items:
            value = str(item.get(key) or "")
            if value not in wanted:
                continue
            status, _ = client.request("DELETE", f"{delete_base}/{item['id']}", headers=client.write_headers())
            if status in (200, 204):
                removed += 1
            else:
                print(f"  ✗ 删除 {label} {value} 失败：{status}")
    print(f"\n== 清理完成：删除 {removed} 条演示内容 ==")


def backup(database_url: str) -> Path:
    name = time.strftime("/tmp/pl-demo-backup-%Y%m%d-%H%M%S.sql")
    run([str(PG_BIN / "pg_dump"), "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "pl_test", "-f", name])
    print(f"✓ 备份到 {name}")
    return Path(name)


def restore(path: Path) -> None:
    psql = PG_BIN / "psql"
    run([str(psql), "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", "postgres", "-c",
         "DROP DATABASE IF EXISTS pl_test WITH (FORCE)"])
    run([str(psql), "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", "postgres", "-c",
         "CREATE DATABASE pl_test"])
    run([str(psql), "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", "pl_test", "-f", str(path)])
    print(f"✓ 已从 {path} 恢复 pl_test")


def main() -> int:
    parser = argparse.ArgumentParser(description="给本地分享 dev 库灌/清演示内容")
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--admin", default=DEFAULT_ADMIN)
    parser.add_argument("--password", default=os.environ.get("SEED_ADMIN_PASSWORD", ""))
    parser.add_argument("--database-url", default=DEFAULT_DB_URL)
    parser.add_argument("--create-admin", action="store_true", help="创建/重置演示管理员（需 --password 或 SEED_ADMIN_PASSWORD）")
    parser.add_argument("--clean", action="store_true", help="删除本脚本创建的演示条目")
    parser.add_argument("--backup", action="store_true", help="先 pg_dump 备份 pl_test")
    parser.add_argument("--restore", metavar="DUMP", help="从 pg_dump 备份恢复 pl_test")
    args = parser.parse_args()

    try:
        if args.restore:
            restore(Path(args.restore))
            return 0
        if args.backup:
            backup(args.database_url)
            return 0

        client = Client(args.base)
        if args.create_admin:
            if len(args.password) < 12:
                raise SeedError("请用 --password 或 SEED_ADMIN_PASSWORD 提供 ≥12 位密码")
            ensure_admin(admin=args.admin, password=args.password, database_url=args.database_url, reset=True)

        if args.clean:
            if not args.password:
                raise SeedError("--clean 需要管理员密码（--password 或 SEED_ADMIN_PASSWORD）")
            client.login(args.admin, args.password)
            clean(client)
            return 0

        if len(args.password) < 12:
            raise SeedError("请用 --password 或 SEED_ADMIN_PASSWORD 提供 ≥12 位管理员密码")
        # 内容类操作要求后台已可登录：先探一次，避免种子脚本跑到一半才发现凭据不对。
        try:
            client.login(args.admin, args.password)
        except SeedError as error:
            raise SeedError(
                f"演示管理员登录失败（{error}）；若是首次运行，请先组织："
                "SEED_ADMIN_PASSWORD='<≥12位>' python3 tools/seed-demo-content.py --create-admin"
            ) from error
        seed(args.base, args.admin, args.password, args.database_url)
        client.login(args.admin, args.password)
        print_counts(client)
        print_deep_links()
        print("\n✓ 演示内容已就绪。后续整体替换：先 `--backup`，再改内容；要回滚就 `--restore <dump>`。")
        return 0
    except SeedError as error:
        print(f"\n✗ {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
