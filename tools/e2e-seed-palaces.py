"""给**隔离环境**造殿堂（专题）数据，供端到端验证使用（不碰共享库、不碰生产）。

为什么需要：本地/隔离库默认没有殿堂，手机里「导航 → 进入殿堂」这条路径无法在浏览器里验证。

API 细节（实测）：
  - 新建走 `POST /api/v1/admin/nav/palaces`（body 里要 csrf_token 或 X-CSRF-Token）；
  - 发布是独立端点 `POST /admin/nav/palaces/{id}/publish`，需要 `If-Match: "<version>"`；
  - 列表 `limit` 有上限（沿用其它模块的惯例，别超过 30）。

用法：python3 tools/e2e-seed-palaces.py <BASE> <owner-password>
退出码：0 = 全部创建并发布成功。
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8130"
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "e2e-password-123"
ORIGIN = BASE
COOKIE: dict[str, str] = {}

PALACES = [
    ("phantom-base", "怪盗据点工程", "把静态博客改造成怪盗基地。", "怪盗", "个人博客", "据点"),
    ("noise-and-signal", "噪音与信号", "在噪声里找信号。", "信号", "秋叶原", "噪声"),
    ("velvet-door", "天鹅绒之门", "蓝色房间的那扇门。", "天鹅绒", "天鹅绒房间", "门"),
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
        json.dumps({"username": "owner", "password": PASSWORD, "csrf_token": csrf}).encode(),
        {"Content-Type": "application/json", "Origin": ORIGIN},
    )
    if status != 200:
        print(f"✗ 登录失败：{status} {str(payload)[:120]}")
        return 1
    csrf = (payload.get("csrf_token") if isinstance(payload, dict) else None) or csrf
    write = {"Origin": ORIGIN, "X-CSRF-Token": csrf, "Content-Type": "application/json"}
    print(f"✓ 登录（{BASE}）")

    # 发布专题要求「至少一篇公开文章」，所以先拿文章 id（没有就提示先导文章）
    status, payload = req("GET", "/api/v1/posts?limit=10")
    posts = payload.get("items") if isinstance(payload, dict) else None
    post_ids = [item["id"] for item in (posts or []) if item.get("id")]
    if not post_ids:
        print("✗ 库里没有公开文章 —— 发布专题会 409。先跑：")
        print("   uv run python -m app.commands.import_legacy --apply \\")
        print("     --source <repo>/assets/js/posts.js --repo-root <repo>")
        return 1
    print(f"  可用公开文章 {len(post_ids)} 篇")

    # 幂等：先看管理列表里已有的（上一次跑到一半留下的草稿）
    status, payload = req("GET", "/api/v1/admin/nav/palaces?limit=30")
    existing_items = payload.get("items") if isinstance(payload, dict) else None
    existing = {item.get("slug"): item for item in (existing_items or []) if item.get("slug")}
    print(f"  已有专题 {len(existing)} 座")

    created = 0
    for slug, title, summary, name, location, cognition in PALACES:
        if slug in existing:
            # 已存在：补上 post_ids 再发布（上次可能因为没文章停在草稿）
            item = existing[slug]
            status, payload = req(
                "PATCH",
                f"/api/v1/admin/nav/palaces/{item['id']}",
                json.dumps({"post_ids": [post_ids[0]]}).encode(),
                {**write, "If-Match": f'"{item["version"]}"'},
            )
            if status != 200 or not isinstance(payload, dict):
                print(f"✗ 更新 {slug} 失败：{status} {str(payload)[:120]}")
                continue
            palace_id, version = payload["id"], payload["version"]
        else:
            status, payload = req(
                "POST",
                "/api/v1/admin/nav/palaces",
            json.dumps(
                {
                    "slug": slug,
                    "title": title,
                    "summary": summary,
                    "keywords": {"name": name, "location": location, "cognition": cognition},
                    "aliases": [],
                    "post_ids": [post_ids[0]],
                }
            ).encode(),
            write,
        )
            if status not in (200, 201) or not isinstance(payload, dict):
                print(f"✗ 新建 {slug} 失败：{status} {str(payload)[:120]}")
                continue
            palace_id, version = payload.get("id"), payload.get("version")
        status, payload = req(
            "POST",
            f"/api/v1/admin/nav/palaces/{palace_id}/publish",
            b"{}",
            {**write, "If-Match": f'"{version}"'},
        )
        if status != 200:
            print(f"✗ 发布 {slug} 失败：{status} {str(payload)[:160]}")
            continue
        created += 1

    status, payload = req("GET", "/api/v1/nav/palaces?limit=30")
    items = payload.get("items") if isinstance(payload, dict) else None
    print(f"✓ 创建并发布 {created} / {len(PALACES)} 座；公开列表返回 {len(items) if items is not None else '?'} 座")
    return 0 if created == len(PALACES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
