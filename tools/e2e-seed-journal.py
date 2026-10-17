"""给**隔离环境**造手记内容，用于端到端验证（不碰共享库、不碰生产）。

为什么需要：手机里的滚动恢复、草稿保持这类功能要**真实内容**才测得出，
而本地/隔离库默认是空的（`import_legacy` 只导文章，不造手记）。

配套的隔离栈（跑这个脚本之前先起好）：
  1) 独立集群：PGDATA=/tmp/pl-e2e-pg/data PL_PG_PORT=55434 tools/pg-local.sh init && start
  2) 建库 + 迁移 + 站主：
       psql -p 55434 -c "CREATE DATABASE pl_e2e;"
       DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55434/pl_e2e uv run alembic upgrade head
       python -m app.commands.bootstrap_admin --username owner --password-stdin
  3) 隔离 API：DATABASE_URL=…/pl_e2e API_INTERNAL_URL 端口自定（如 8130）
  4) 隔离前端**必须用同一个 API 地址构建**：`DEV_API_URL=http://127.0.0.1:8130 npx next build`
     —— 这一条很容易漏：`DEV_API_URL` 是**构建期**变量，构建时指错，浏览器就会去请求另一个 API。

API 的几个细节（都是实测踩出来的，脚本里已按正确方式调用）：
  - 新建接口**总是** draft + private，没有 status/visibility 字段；
  - 发布是 `POST …/{id}/publish`（要标题和正文，否则 409），再
    `POST …/{id}/visibility?visibility=public` —— **visibility 是 query 参数**，不是 JSON body；
  - 改/发布/切可见性都要 `If-Match: "<version>"`；每次写操作后 version 会变，要重新读；
  - 列表 `limit` **上限 30**（大于 30 会 422）。

用法：
  python3 tools/e2e-seed-journal.py http://127.0.0.1:8130 <owner-password> [条数]
退出码：0 = 全部创建并公开成功。
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8130"
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "e2e-password-123"
COUNT = int(sys.argv[3]) if len(sys.argv) > 3 else 15
ORIGIN = BASE
COOKIE: dict[str, str] = {}


def req(method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
    request = urllib.request.Request(BASE + path, data=body, method=method)
    if COOKIE:
        request.add_header("Cookie", "; ".join(f"{key}={value}" for key, value in COOKIE.items()))
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            for header in response.headers.get_all("Set-Cookie") or []:
                pair = header.split(";")[0]
                if "=" in pair:
                    name, value = pair.split("=", 1)
                    COOKIE[name.strip()] = value.strip()
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


def main() -> int:
    status, payload = req("GET", "/api/v1/auth/session")
    csrf = payload.get("csrf_token") if isinstance(payload, dict) else None
    if status != 200 or not csrf:
        print(f"✗ 取 csrf 失败：{status}")
        return 1

    status, payload = req(
        "POST",
        "/api/v1/auth/login",
        json.dumps({"username": "owner", "password": PASSWORD, "csrf_token": csrf}).encode(),
        {"Content-Type": "application/json", "Origin": ORIGIN},
    )
    if status != 200:
        print(f"✗ 登录失败：{status} {str(payload)[:120]}")
        return 1
    csrf = (payload.get("csrf_token") if isinstance(payload, dict) else None) or csrf
    write = {"Origin": ORIGIN, "X-CSRF-Token": csrf, "Content-Type": "application/json"}
    print(f"✓ 登录（{BASE}）")

    created = 0
    for index in range(COUNT):
        day = 1 + (index % 28)
        status, payload = req(
            "POST",
            "/api/v1/admin/journal/entries",
            json.dumps(
                {
                    "entry_date": f"2026-09-{day:02d}",
                    "title": f"隔离验证手记 {index + 1}",
                    "content_md": f"这是第 {index + 1} 条用于端到端验证的手记正文。",
                    "mood": "平静",
                    "location": "四轩茶屋",
                    "images": [],
                }
            ).encode(),
            write,
        )
        if status != 201 or not isinstance(payload, dict):
            print(f"✗ 新建第 {index + 1} 条失败：{status} {str(payload)[:120]}")
            continue
        entry_id = payload["id"]

        # 发布（要标题 + 正文，否则 409）
        status, payload = req(
            "POST",
            f"/api/v1/admin/journal/entries/{entry_id}/publish",
            b"{}",
            {**write, "If-Match": f'"{payload["version"]}"'},
        )
        if status != 200 or not isinstance(payload, dict):
            print(f"✗ 发布第 {index + 1} 条失败：{status}")
            continue
        version = payload["version"]

        # 切公开（visibility 走 query 参数）
        status, _ = req(
            "POST",
            f"/api/v1/admin/journal/entries/{entry_id}/visibility?visibility=public",
            None,
            {**write, "If-Match": f'"{version}"'},
        )
        if status != 200:
            print(f"✗ 切公开第 {index + 1} 条失败：{status}")
            continue
        created += 1

    status, payload = req("GET", "/api/v1/journal/entries?limit=30")
    items = payload.get("items") if isinstance(payload, dict) else None
    public = len(items) if items is not None else -1
    print(f"✓ 创建并公开 {created} / {COUNT} 条；公开列表返回 {public} 条")
    return 0 if created == COUNT else 1


if __name__ == "__main__":
    raise SystemExit(main())
