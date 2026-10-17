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
import os
import sys
import urllib.error
import urllib.request

_ARGS = [item for item in sys.argv[1:] if not item.startswith("--")]
DEMO = "--demo" in sys.argv
BASE = _ARGS[0] if len(_ARGS) > 0 else "http://127.0.0.1:8130"
PASSWORD = _ARGS[1] if len(_ARGS) > 1 else "e2e-password-123"
COUNT = int(_ARGS[2]) if len(_ARGS) > 2 else 15
# 演示数据用独立管理员（demo-seeder），e2e 默认仍是 owner。
USERNAME = os.environ.get("SEED_ADMIN_USERNAME", "owner")
ORIGIN = BASE
COOKIE: dict[str, str] = {}

# `--demo` 用的主题化演示手记（自然内容，不加「演示」标记；清单见交付文档，
# 后续整体替换时删掉这些 entry_date/title 即可）。
DEMO_ENTRIES = [
    ("2026-10-01", "视觉还原第一屏：把手机里的九个应用摆回设计稿",
     "先量参考帧的间距与字重，再一屏一屏改；改完用截图对比，不用「感觉差不多」过关。"),
    ("2026-10-02", "可访问性不是最后一轮才做的事",
     "对比度、触控目标、焦点可见性、键盘走查 —— 这些越早做越省事；最后一轮做，就会变成返工。"),
    ("2026-10-03", "系统代理骗了我一次",
     "curl 是 200，验收脚本却 502。查到最后是系统代理把 127.0.0.1 也劫持了；给脚本统一加了 no_proxy。"),
    ("2026-10-04", "隔离集群的残留进程",
     "端到端起不来，报 pg_filenode.map 打不开；真正的占用者是一个指向已删目录的旧 postgres 进程。"),
    ("2026-10-05", "手机宿主里三张样式表没加载",
     "deep link 打开手机时 INS 页签是浏览器默认灰；根因是样式表只被独立路由 import，首页没有。"),
    ("2026-10-06", "悬空 aria-controls 与结构巡检",
     "收起状态的按钮还在 aria-controls 指向不存在的面板；改成只在展开时声明，并写进巡检脚本。"),
    ("2026-10-07", "首页刷新：从看不清到能选版",
     "左侧栏目被挤出首屏、当前项文字压在纸色拼贴上；先修可读性，再做三套排版给站主选。"),
    ("2026-10-08", "今天的四轩茶屋",
     "下雨，咖啡凉得比平时快。把昨天的验收日志又翻了一遍，没有新问题，算是个好日子。"),
]


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
        json.dumps({"username": USERNAME, "password": PASSWORD, "csrf_token": csrf}).encode(),
        {"Content-Type": "application/json", "Origin": ORIGIN},
    )
    if status != 200:
        print(f"✗ 登录失败：{status} {str(payload)[:120]}")
        return 1
    csrf = (payload.get("csrf_token") if isinstance(payload, dict) else None) or csrf
    write = {"Origin": ORIGIN, "X-CSRF-Token": csrf, "Content-Type": "application/json"}
    print(f"✓ 登录（{BASE}）")

    if DEMO:
        entries = [
            {
                "entry_date": entry_date,
                "title": title,
                "content_md": content,
                "mood": "平静",
                "location": "四轩茶屋",
                "images": [],
            }
            for entry_date, title, content in DEMO_ENTRIES
        ]
    else:
        entries = [
            {
                "entry_date": f"2026-09-{1 + (index % 28):02d}",
                "title": f"隔离验证手记 {index + 1}",
                "content_md": f"这是第 {index + 1} 条用于端到端验证的手记正文。",
                "mood": "平静",
                "location": "四轩茶屋",
                "images": [],
            }
            for index in range(COUNT)
        ]

    created = 0
    for index, entry in enumerate(entries):
        status, payload = req(
            "POST",
            "/api/v1/admin/journal/entries",
            json.dumps(entry).encode(),
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
    print(f"✓ 创建并公开 {created} / {len(entries)} 条（{'demo' if DEMO else 'e2e'} 模式）；公开列表返回 {public} 条")
    return 0 if created == len(entries) else 1


if __name__ == "__main__":
    raise SystemExit(main())
