"""给**隔离环境**造「视觉复核」用的数据：放课后记录 + COOP 友链 + 殿堂作品（不碰共享库/生产）。

为什么需要：交接包里的 `e2e-seed-journal.py` / `e2e-seed-palaces.py` 只覆盖手记与殿堂；
做视觉还原时需要放课后、COOP 有真实条目，否则只能对着空态改样式。

API 细节（实测）：
  - 登录走 `POST /api/v1/auth/login`（先 `GET /api/v1/auth/session` 取 csrf）；
  - 放课后：`POST /api/v1/admin/leisure/entries` 新建（**总是草稿**），
    `POST .../{id}/publish` 发布，需 `If-Match: "<version>"`；
  - COOP：`POST /api/v1/admin/friends` 新建，`POST .../{id}/publish` 发布，同样 If-Match；
  - 殿堂作品：先 `POST /api/v1/admin/media`（multipart `file`）上传**仓库里已有**的封面图，
    再 `POST /api/v1/admin/projects` 新建草稿（发布门槛：至少 1 张 ready 图片 + 一句话用途），
    最后 `POST .../{id}/publish`；
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


# 殿堂作品：只复用仓库里已有的封面图（不新增素材、不用游戏素材冒充摄影作品）。
# 发布门槛来自后端：至少 1 张 ready 图片 + 一句话用途（role/summary 里要能看出用途）。
PROJECTS = [
    {
        "slug": "phantom-log-next",
        "title": "怪盗手记 · 站点重构",
        "summary": "把旧静态页面重构成 Next.js App Router + FastAPI 的全栈站点，内容改为单一来源维护。",
        "role": "独立完成：前端、后端、数据迁移与验收。",
        "problem": "旧站是纯静态页面，内容与样式耦合，新增内容类型时协作成本高。",
        "tradeoffs": "用服务端组件承担首屏，交互下放到客户端；接受更复杂的构建与缓存边界。",
        "outcomes": "公开页与手机视口都有真实浏览器验收；内容只通过 API 维护一份。",
        "tech_stack": ["Next.js", "React", "TypeScript", "FastAPI", "PostgreSQL"],
        "maintenance": "maintained",
        "images": [
            ("assets/legacy/img/cover/launch.jpg", "cover", "站点重构后的首页视觉"),
            ("assets/legacy/img/cover/desk.jpg", "detail", "桌面端布局细节"),
        ],
    },
    {
        "slug": "velvet-compendium",
        "title": "天鹅绒技能全书",
        "summary": "把技能与真实作品证据整理成可筛选的技能全书，并支持技能合体查询。",
        "role": "设计并实现：技能/作品关系模型、蓝黑视觉语言与真实浏览器验收。",
        "problem": "技能与作品是两份数据时，读者看不出「技能在哪件作品里被用过」。",
        "tradeoffs": "技能只关联作品、不复制作品正文；接受更严格的发布门槛（至少一条关联）。",
        "outcomes": "同一份关系数据同时服务技能页与作品页；没有等级/熟练度等虚构数值。",
        "tech_stack": ["Next.js", "SQLAlchemy", "Alembic", "CSS"],
        "maintenance": "maintained",
        "images": [
            ("assets/legacy/img/cover/css-menu.jpg", "cover", "技能全书的蓝黑界面"),
        ],
    },
    {
        "slug": "ins-messaging",
        "title": "INS 消息与相册",
        "summary": "给手机内置 IM 加酒馆会话与相册链接，并复用同一份公开数据。",
        "role": "负责数据模型、后端会话与前端 IM 视觉还原。",
        "problem": "ISN 动态之外还需要角色消息与相册入口，且不能与真实社交平台混为一谈。",
        "tradeoffs": "消息只存预设剧情与纯文本 AI 会话；图片消息留给产品决策，不先造数据模型。",
        "outcomes": "IM 有独立视觉语言与草稿恢复；相册链接与生活图库共用一份数据。",
        "tech_stack": ["Next.js", "React", "FastAPI"],
        "maintenance": "active",
        "images": [
            ("assets/legacy/img/cover/tokyo.jpg", "cover", "消息界面的红黑视觉"),
        ],
    },
]

REPO_COVER_ROOT = "/Users/学习/blog/Blogs/apps/web/public"


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


def upload_media(write: dict[str, str], relative_path: str) -> str | None:
    """上传仓库内已有图片，返回 media_id。multipart 手写，避免额外依赖。"""
    import pathlib
    import uuid

    file_path = pathlib.Path(REPO_COVER_ROOT) / relative_path
    if not file_path.is_file():
        print(f"✗ 找不到封面文件：{file_path}")
        return None
    boundary = "----e2e-" + uuid.uuid4().hex
    content = file_path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        "Content-Type: image/jpeg\r\n\r\n".encode()
        + content
        + f"\r\n--{boundary}--\r\n".encode()
    )
    headers = {**write, "Content-Type": f"multipart/form-data; boundary={boundary}"}
    # 上传端点返回 201 与纯 JSON；`req` 里已经带了 Cookie 与 Origin。
    status, payload = req("POST", "/api/v1/admin/media", body, headers)
    if status not in (200, 201) or not isinstance(payload, dict):
        print(f"✗ 上传 {relative_path} 失败：{status} {str(payload)[:140]}")
        return None
    return str(payload.get("id") or "")


def seed_projects(write: dict[str, str]) -> int:
    status, payload = req("GET", "/api/v1/admin/projects?limit=30")
    existing = payload.get("items") if isinstance(payload, dict) else None
    by_slug = {item.get("slug"): item for item in (existing or [])}
    ok = 0
    for project in PROJECTS:
        item = by_slug.get(project["slug"])
        if item is not None:
            if item.get("status") == "published":
                ok += 1
                continue
            media_ids = [str(image_id) for image_id in (item.get("media_ids") or [])]
        else:
            images = []
            media_ids = []
            failed = False
            for order, (relative, kind, alt) in enumerate(project["images"]):
                media_id = upload_media(write, relative)
                if not media_id:
                    failed = True
                    break
                media_ids.append(media_id)
                images.append({"media_id": media_id, "position": order, "kind": kind, "alt": alt})
            if failed:
                continue
            body = {
                "slug": project["slug"],
                "title": project["title"],
                "summary": project["summary"],
                "role": project["role"],
                "problem": project["problem"],
                "tradeoffs": project["tradeoffs"],
                "outcomes": project["outcomes"],
                "tech_stack": project["tech_stack"],
                "maintenance": project["maintenance"],
                "images": images,
            }
            status, payload = req("POST", "/api/v1/admin/projects", json.dumps(body).encode(), write)
            if status not in (200, 201) or not isinstance(payload, dict):
                print(f"✗ 新建作品「{project['title']}」失败：{status} {str(payload)[:140]}")
                continue
            item = payload
        status, payload = req(
            "POST",
            f"/api/v1/admin/projects/{item['id']}/publish",
            b"{}",
            {**write, "If-Match": f'"{item["version"]}"'},
        )
        if status != 200:
            print(f"✗ 发布作品「{project['title']}」失败：{status} {str(payload)[:180]}")
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
    projects_ok = seed_projects(write)
    print(f"✓ 殿堂：{projects_ok}/{len(PROJECTS)} 件作品已发布")
    return (
        0
        if leisure_ok == len(LEISURE) and friends_ok == len(FRIENDS) and projects_ok == len(PROJECTS)
        else 1
    )


if __name__ == "__main__":
    sys.exit(main())
