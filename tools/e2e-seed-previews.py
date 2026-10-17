"""给**隔离环境**造「视觉复核」用的数据：放课后记录 + COOP 友链（不碰共享库/生产）。

为什么需要：交接包里的 `e2e-seed-journal.py` / `e2e-seed-palaces.py` 只覆盖手记与殿堂；
做视觉还原时需要放课后、COOP 有真实条目，否则只能对着空态改样式。

API 细节（实测）：
  - 登录走 `POST /api/v1/auth/login`（先 `GET /api/v1/auth/session` 取 csrf）；
  - 放课后：`POST /api/v1/admin/leisure/entries` 新建（**总是草稿**），
    `POST .../{id}/publish` 发布，需 `If-Match: "<version>"`；
  - COOP：`POST /api/v1/admin/friends` 新建，`POST .../{id}/publish` 发布，同样 If-Match；
  - 写请求都要 `Origin` + `X-CSRF-Token`（或 body 里 csrf_token）。

用法：python3 tools/e2e-seed-previews.py [BASE] [OWNER_PASSWORD]
退出码：0 = 全部条目已存在或发布成功。
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

# 放课后：追番两条、游戏两条（覆盖「总数未知 / 未评分 / 通关≠全成就」等状态）
LEISURE = [
    {
        "kind": "anime",
        "title": "赛博酒馆的第二夜",
        "season": "2026 秋",
        "episodes_watched": 6,
        "total_episodes": 12,
        "last_watched_on": "2026-10-14",
        "airing": True,
        "rating": 8,
        "notes": "分镜稳，配乐比第一季更克制。第 5 集的分岔值得单独记一笔。",
    },
    {
        "kind": "anime",
        "title": "午夜电台与猫",
        "season": "2026 夏",
        "episodes_watched": 3,
        "total_episodes": None,  # 总数未知 → 进度标签不带百分比（规则由后端算）
        "airing": False,
        "rating": None,  # 未评分 ≠ 0 分
        "notes": "只在深夜看，节奏慢得刚好。",
    },
    {
        "kind": "game",
        "title": "空洞骑士：丝之歌",
        "platform": "Steam / PC",
        "started_on": "2026-09-20",
        "completed_on": None,
        "playtime_minutes": 1260,
        "all_achievements": False,
        "rating": 9,
        "notes": "地图记忆比数值成长更吃功夫，弹反手感是核心。",
    },
    {
        "kind": "game",
        "title": "Persona 5 Royal",
        "platform": "PS5",
        "started_on": "2025-11-02",
        "completed_on": "2026-03-18",
        "playtime_minutes": 6420,
        "all_achievements": False,  # 通关 ≠ 全成就
        "rating": 10,
        "notes": "第三学期的节奏与一二学期不同，但 UI 语言是整部作品的主角。",
    },
]

# COOP：友链（真实站点形态的示例数据；arcana 用原作的阿卡那名）
FRIENDS = [
    {
        "name": "猫与咖啡",
        "url": "https://example.com/cat-coffee",
        "summary": "手冲、旧书和一个不肯下线的 RSS。",
        "story": "从 2019 年写到现在的个人博客，主要记咖啡与读书笔记。",
        "arcana": "STAR",
        "tags": ["博客", "读书"],
        "position": 10,
    },
    {
        "name": "深夜编译中",
        "url": "https://example.com/midnight-build",
        "summary": "一个后端工程师的踩坑记录。",
        "story": "分布式与数据库方向，文章偏长，偶尔更新。",
        "arcana": "HIEROPHANT",
        "tags": ["后端", "数据库"],
        "position": 20,
    },
    {
        "name": "像素流浪者",
        "url": "https://example.com/pixel-wanderer",
        "summary": "独立游戏与像素画的收集箱。",
        "story": "做小游戏，也记录玩过的老游戏。",
        "arcana": "FOOL",
        "tags": ["游戏", "像素画"],
        "position": 30,
    },
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


def login() -> dict[str, str] | None:
    status, payload = req("GET", "/api/v1/auth/session")
    csrf = payload.get("csrf_token") if isinstance(payload, dict) else None
    if status != 200 or not csrf:
        print(f"✗ 取 csrf 失败：{status}")
        return None
    status, payload = req(
        "POST",
        "/api/v1/auth/login",
        json.dumps({"username": "owner", "password": PASSWORD, "csrf_token": csrf}).encode(),
        {"Content-Type": "application/json", "Origin": ORIGIN},
    )
    if status != 200:
        print(f"✗ 登录失败：{status} {str(payload)[:140]}")
        return None
    csrf = (payload.get("csrf_token") if isinstance(payload, dict) else None) or csrf
    return {"Origin": ORIGIN, "X-CSRF-Token": csrf, "Content-Type": "application/json"}


def seed_leisure(write: dict[str, str]) -> int:
    status, payload = req("GET", "/api/v1/admin/leisure/entries?limit=30")
    existing = payload.get("items") if isinstance(payload, dict) else None
    by_title = {item.get("title"): item for item in (existing or [])}
    ok = 0
    for entry in LEISURE:
        item = by_title.get(entry["title"])
        if item is None:
            status, payload = req(
                "POST", "/api/v1/admin/leisure/entries", json.dumps(entry).encode(), write
            )
            if status not in (200, 201) or not isinstance(payload, dict):
                print(f"✗ 新建放课后「{entry['title']}」失败：{status} {str(payload)[:140]}")
                continue
            item = payload
        if item.get("status") == "published":
            ok += 1
            continue
        status, payload = req(
            "POST",
            f"/api/v1/admin/leisure/entries/{item['id']}/publish",
            b"{}",
            {**write, "If-Match": f'"{item["version"]}"'},
        )
        if status != 200:
            print(f"✗ 发布放课后「{entry['title']}」失败：{status} {str(payload)[:140]}")
            continue
        ok += 1
    return ok


def seed_friends(write: dict[str, str]) -> int:
    status, payload = req("GET", "/api/v1/admin/friends?limit=30")
    existing = payload.get("items") if isinstance(payload, dict) else None
    by_name = {item.get("name"): item for item in (existing or [])}
    ok = 0
    for friend in FRIENDS:
        item = by_name.get(friend["name"])
        if item is None:
            status, payload = req(
                "POST", "/api/v1/admin/friends", json.dumps(friend).encode(), write
            )
            if status not in (200, 201) or not isinstance(payload, dict):
                print(f"✗ 新建友链「{friend['name']}」失败：{status} {str(payload)[:140]}")
                continue
            item = payload
        if item.get("status") == "published":
            ok += 1
            continue
        status, payload = req(
            "POST",
            f"/api/v1/admin/friends/{item['id']}/publish",
            b"{}",
            {**write, "If-Match": f'"{item["version"]}"'},
        )
        if status != 200:
            print(f"✗ 发布友链「{friend['name']}」失败：{status} {str(payload)[:140]}")
            continue
        ok += 1
    return ok


def main() -> int:
    write = login()
    if write is None:
        return 1
    print(f"✓ 登录（{BASE}）")
    leisure_ok = seed_leisure(write)
    print(f"✓ 放课后：{leisure_ok}/{len(LEISURE)} 条已发布")
    friends_ok = seed_friends(write)
    print(f"✓ COOP：{friends_ok}/{len(FRIENDS)} 条友链已发布")
    return 0 if leisure_ok == len(LEISURE) and friends_ok == len(FRIENDS) else 1


if __name__ == "__main__":
    sys.exit(main())
