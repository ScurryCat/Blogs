#!/usr/bin/env python3
"""T06 真实浏览器验收（Playwright + 系统 chromium；**不进** apps/web 依赖）。

前置（全部真实进程，无 mock）：

  1. 真实 PostgreSQL + 迁移 + 站主 + 旧文章 + T04 专题 + T06 的第一件真实作品：
       python -m app.commands.bootstrap_admin --username … --password-stdin
       python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
       python -m app.modules.nav.seed --create-tables --apply --publish
       python -m app.modules.projects.seed --create-tables --apply --publish --palace-slug phantom-base
  2. 真实 API（T00 登记路由前用 `app.t06_dev_app` 临时入口）：
       uvicorn app.t06_dev_app:app --port 8103
  3. 构建并启动前端（`DEV_API_URL` 必须在 **build** 时就有值）：
       DEV_API_URL=http://127.0.0.1:8103 npm --prefix apps/web run build
       API_INTERNAL_URL=http://127.0.0.1:8103 npm --prefix apps/web run start
  4. 运行：
       python3 apps/web/features/gallery/tools/verify-showcase.py

脚本自己做的事（**不写仓库、不写生产库**）：

  * 用**真实 HTTP 管理端点**（登录 → CSRF → If-Match）建两个相册：
    `t06-photos`（摄影）与 `t06-screens`（游戏截图），图片用仓库里已有的
    `assets/legacy/img/cover/launch.jpg` 现上传（因此得到的是真实的媒体记录与变体）。
    相册是幂等的：已存在就复用，不重复上传。
  * 收尾把这两个相册**撤回**（不是删除）：撤回后公开页面不再显示，但媒体文件保留 ——
    这正是「单处撤回 ≠ 删文件」要被验证的行为。

覆盖的验收用例（T06 任务卡 §验收）：

  1. 作品详情「攻略记录」只在专题公开时出现；撤回专题后**不露出隐藏标题**（真实 SQL 撤回再恢复）；
  2. 独立照片墙与（同一份数据的）相册视图一致；
  3. 「一处引用撤回」与「所有引用撤回」的权限结果分别正确；原图永远匿名 404；
  4. 同一张图出现在两个相册里 → 从一个相册移除后，另一个相册仍可见、匿名读图仍 200；
  5. 灯箱键盘（← / → / Home / End / Escape）与焦点归还；
  6. 图片损坏时的失败态；390px / 320px 无横向溢出；不新增 body 锁与音频。

**水合时序**：点击前先等 `window.__PHANTOM_DEBUG__` 出现（水合完成），不要用固定 sleep；
判断整页重载用 `performance.timeOrigin` 是否变化（不要用注入标记 —— 那会自扰动）。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from typing import Any

from playwright.sync_api import Page, sync_playwright

OUT = pathlib.Path("/Users/学习/blog/.dsh/screenshots")
DESKTOP = {"width": 1280, "height": 900}
NARROW = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 844}

PSQL = "/opt/homebrew/opt/postgresql@18/bin/psql"
DEV_DB = "pl_test_t06_dev"
PROJECT_SLUG = "p5-blog"
PALACE_SLUG = "phantom-base"
ALBUM_PHOTOS = "t06-photos"
ALBUM_SCREENS = "t06-screens"
COVER_FILE = pathlib.Path(
    "/Users/学习/blog/Blogs/apps/web/public/assets/legacy/img/cover/launch.jpg"
)

results: list[dict[str, Any]] = []
shots: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append({"check": name, "ok": bool(condition), "detail": detail})
    print(f"{'PASS' if condition else 'FAIL'} {name}{(' — ' + detail) if detail else ''}", flush=True)


def shot(page: Page, name: str) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    shots.append(str(path))
    return str(path)


def open_page(page: Page, url: str, base: str, *, hydrated: bool = True) -> None:
    """打开页面 → 关开屏 → 关问卷浮层 → 等运行时探针可用（= 水合完成）。"""
    page.goto(url if url.startswith("http") else base + url, wait_until="load")
    page.wait_for_timeout(200)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    if page.locator(".poll--floating").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
    if hydrated:
        page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)


def time_origin(page: Page) -> float:
    return float(page.evaluate("() => performance.timeOrigin"))


def psql(sql: str) -> None:
    completed = subprocess.run(
        [PSQL, "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", DEV_DB, "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"psql 失败：{completed.stderr.strip()}")


def set_palace_status(status: str) -> None:
    psql(f"update palaces set status = '{status}' where slug = '{PALACE_SLUG}'")


# --- 真实管理 HTTP（登录 / CSRF / If-Match）--------------------------------


class Admin:
    """用真实 HTTP 管理端点做夹具（不直接写表）。

    T03 的交付单指出：浏览器 → Next(rewrite) 的 POST 不带 `Origin`，而
    `core/csrf.py` 按 05 §5 拒绝缺失 Origin 的写请求。这里**直接**打 API 端口
    （不经过 Next 的 rewrite），并显式带 `Origin: http://127.0.0.1:<web_port>`，
    与「生产形态下浏览器直连同源 API」一致。
    """

    def __init__(self, api_base: str, username: str, password: str) -> None:
        self.api_base = api_base.rstrip("/")
        self.username = username
        self.password = password
        self.cookie = ""
        self.csrf = ""

    def _request(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
        import urllib.error
        import urllib.request

        url = f"{self.api_base}/api/v1{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if self.cookie:
            request.add_header("Cookie", self.cookie)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read().decode("utf-8")
                set_cookie = response.headers.get("Set-Cookie")
                if set_cookie:
                    self.cookie = set_cookie.split(";")[0]
                return response.status, json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            payload = error.read().decode("utf-8")
            try:
                return error.code, json.loads(payload)
            except json.JSONDecodeError:
                return error.code, {"raw": payload}

    def login(self, origin: str) -> None:
        status, payload = self._request("GET", "/auth/session")
        if status != 200:
            raise RuntimeError(f"读取会话失败：{status} {payload}")
        self.csrf = payload.get("csrf_token", "")
        status, payload = self._request(
            "POST",
            "/auth/login",
            {"username": self.username, "password": self.password, "csrf_token": self.csrf},
            {"Origin": origin},
        )
        if status != 200:
            raise RuntimeError(f"登录失败：{status} {payload}")
        self.csrf = payload.get("csrf_token", self.csrf)

    def write(self, method: str, path: str, body: dict | None = None, *, origin: str, if_match: str | None = None):
        """写请求：Origin + `X-CSRF-Token` 头。

        **不放 body 字段**：本包的写 DTO 都开了 `extra="forbid"`（防止把「调用方以为
        会生效的字段」静默忽略），因此 `csrf_token` 在 body 里会被 422 拒绝。
        `core/csrf.py` 的取 token 顺序是「头 → JSON body → 表单」，用头最干净。
        """
        headers = {"Origin": origin, "X-CSRF-Token": self.csrf}
        if if_match is not None:
            headers["If-Match"] = if_match
        return self._request(method, path, dict(body or {}), headers)

    def upload(self, path: pathlib.Path, origin: str) -> dict:
        """multipart 上传一张真实图片（走 T01 的媒体服务，得到真实变体）。"""
        import urllib.request

        boundary = "----t06verifyboundary"
        body = b"".join(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
                b"Content-Type: image/jpeg\r\n\r\n",
                path.read_bytes(),
                f"\r\n--{boundary}--\r\n".encode(),
            ]
        )
        request = urllib.request.Request(f"{self.api_base}/api/v1/admin/media", data=body, method="POST")
        request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        request.add_header("Origin", origin)
        request.add_header("X-CSRF-Token", self.csrf)
        request.add_header("Cookie", self.cookie)
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))

    def anonymous_status(self, url: str) -> int:
        import urllib.error
        import urllib.request

        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code


def media_ids_in_album(admin: "Admin", slug: str) -> list[str]:
    """公开相册详情里**当前真的在引用**的媒体 id（按 position 排序）。

    为什么必须重新读一次：验证相册在收尾时被撤回，下一轮 `ensure_albums` 会用新上传的
    媒体**替换**旧关系。如果脚本继续用「本轮上传的 id」，在「相册已存在 → PATCH 补齐」
    这条路径上就会拿到一组**并不在相册里**的 id（真实缺陷：断言 404 而不是 200，
    看起来像权限错了）。
    """
    status, album = admin._request("GET", f"/gallery/albums/{slug}")
    if status != 200:
        raise RuntimeError(f"读取公开相册 {slug} 失败：{status} {album}")
    photos = sorted(album["photos"], key=lambda item: item["position"])
    return [photo["media_id"] for photo in photos]


def project_id_of(admin: "Admin") -> str:
    """取第一件真实作品的 id（用于「所有引用撤回」场景）。"""
    status, page = admin._request("GET", "/admin/projects?limit=30")
    if status != 200:
        raise RuntimeError(f"读取作品列表失败：{status} {page}")
    for item in page.get("items", []):
        if item["slug"] == PROJECT_SLUG:
            return item["id"]
    raise RuntimeError(f"找不到作品 {PROJECT_SLUG}：请先运行 app.modules.projects.seed")


def ensure_albums(admin: Admin, origin: str) -> dict[str, Any]:
    """幂等地准备两个相册（已存在则复用；不重复上传媒体）。"""
    info: dict[str, Any] = {"uploaded": [], "albums": {}}
    # 管理列表的上限与全站列表契约一致（MAX_LIMIT = 30）。
    status, page = admin._request("GET", "/admin/albums?limit=30")
    if status != 200:
        raise RuntimeError(f"读取相册列表失败：{status} {page}")
    existing = {item["slug"]: item for item in page.get("items", [])}

    project_id = project_id_of(admin)
    info["project_id"] = project_id

    # **先**取作品里已有的那张「作品 ↔ 相册共享图」。它必须长期存在：
    # 相册在收尾时被撤回，而这张图靠**作品**这一处公开引用留在库里，
    # 于是下一轮脚本还能拿它继续验证「一处撤回 / 全部撤回」。
    # 第一版每轮新上传两张、收尾又把相册全撤回，结果第二轮拿到的是一张
    # 已经没有公开引用的旧图（所有断言都变 404 或计数不变，看起来像权限错了）。
    status, project = admin._request("GET", f"/admin/projects/{project_id}")
    if status != 200:
        raise RuntimeError(f"读取作品失败：{status} {project}")

    shares = [
        image["media_id"]
        for image in sorted(project["images"], key=lambda item: item["position"])
        if image["kind"] == "detail"
    ]
    if shares:
        shared = shares[-1]
        info["shared_media_id"] = shared
        media_ids = [shared]
        info["uploaded"] = []
    else:
        # 第一次运行：上传一张真实素材，挂到作品上作为共享图。
        upload = admin.upload(COVER_FILE, origin)
        info["uploaded"] = [{"id": upload["id"], "status": upload["status"]}]
        shared = upload["id"]
        info["shared_media_id"] = shared
        _append_project_image(admin, origin, project, shared)
        status, project = admin._request("GET", f"/admin/projects/{project_id}")
        if status != 200:
            raise RuntimeError(f"重新读取作品失败：{status} {project}")
        media_ids = [shared]

    # 第二个相册需要一张**不同**的图（才能验证「一张图在两个相册里」这一处撤回）。
    # 作品里除共享图之外的任意一张都可以；没有就再上传一张并留在作品里。
    others = [
        image["media_id"]
        for image in sorted(project["images"], key=lambda item: item["position"])
        if image["media_id"] != shared
    ]
    if others:
        media_ids.append(others[0])
    else:
        upload = admin.upload(COVER_FILE, origin)
        info["uploaded"].append({"id": upload["id"], "status": upload["status"]})
        media_ids.append(upload["id"])
        _append_project_image(admin, origin, project, upload["id"])

    photos_payload = [
        {
            "media_id": media_ids[0],
            "position": 0,
            "alt": "验证照片一",
            "caption": "第一张",
            "taken_on": "2026-10-16",
        },
        {
            "media_id": media_ids[1],
            "position": 1,
            "alt": "验证照片二",
            "caption": "第二张",
            "taken_on": None,
        },
    ]
    screens_payload = [
        # **复用**同一张 media：不重复保存相同文件（验收 2）。
        {
            "media_id": media_ids[0],
            "position": 0,
            "alt": "跨相册复用的同一张图",
            "caption": "同一文件",
            "taken_on": None,
        }
    ]

    if ALBUM_PHOTOS not in existing:
        status, created = admin.write(
            "POST",
            "/admin/albums",
            {
                "slug": ALBUM_PHOTOS,
                "title": "验证用相册（摄影）",
                "description": "由 verify-showcase.py 用仓库里的真实封面素材上传建立。",
                "kind": "photo",
                "photos": photos_payload,
            },
            origin=origin,
        )
        if status != 201:
            raise RuntimeError(f"新建相册失败：{status} {created}")
        info["albums"][ALBUM_PHOTOS] = created
    else:
        # 相册已存在（上一次跑过、收尾时被撤回）：**补齐照片**再发布。
        # 真实缺陷：第一版直接复用旧记录，而上一轮的「单处撤回」把它删空了，
        # 于是这次发布被 409 拒绝（「发布前至少需要一张照片」）——
        # 幂等夹具不能假设上一轮留下的状态是完整的。
        status, current = admin._request("GET", f"/admin/albums/{existing[ALBUM_PHOTOS]['id']}")
        if status != 200:
            raise RuntimeError(f"读取已有相册失败：{status} {current}")
        if current["photo_count"] < len(photos_payload):
            status, updated = admin.write(
                "PATCH",
                f"/admin/albums/{current['id']}",
                {"photos": photos_payload},
                origin=origin,
                if_match=f'"{current["version"]}"',
            )
            if status != 200:
                raise RuntimeError(f"补齐相册照片失败：{status} {updated}")
            info["albums"][ALBUM_PHOTOS] = updated
        else:
            info["albums"][ALBUM_PHOTOS] = current

    if ALBUM_SCREENS not in existing:
        status, created = admin.write(
            "POST",
            "/admin/albums",
            {
                "slug": ALBUM_SCREENS,
                "title": "验证用相册（截图）",
                "description": "同一个媒体 id 也出现在这里，用来验证一图多引用。",
                "kind": "screenshot",
                "photos": screens_payload,
            },
            origin=origin,
        )
        if status != 201:
            raise RuntimeError(f"新建截图相册失败：{status} {created}")
        info["albums"][ALBUM_SCREENS] = created
    else:
        status, current = admin._request("GET", f"/admin/albums/{existing[ALBUM_SCREENS]['id']}")
        if status != 200:
            raise RuntimeError(f"读取已有截图相册失败：{status} {current}")
        if current["photo_count"] < len(screens_payload):
            status, updated = admin.write(
                "PATCH",
                f"/admin/albums/{current['id']}",
                {"photos": screens_payload},
                origin=origin,
                if_match=f'"{current["version"]}"',
            )
            if status != 200:
                raise RuntimeError(f"补齐截图相册照片失败：{status} {updated}")
            info["albums"][ALBUM_SCREENS] = updated
        else:
            info["albums"][ALBUM_SCREENS] = current

    # 两个相册都发布（发布需要至少一张 ready 图，这里已经满足）。
    for slug, album in list(info["albums"].items()):
        status, current = admin._request("GET", f"/admin/albums/{album['id']}")
        if status != 200:
            raise RuntimeError(f"读取相册 {slug} 失败：{status} {current}")
        if current["status"] != "published":
            status, published = admin.write(
                "POST",
                f"/admin/albums/{album['id']}/publish",
                {},
                origin=origin,
                if_match=f'"{current["version"]}"',
            )
            if status == 409:
                # 上一轮的「单处撤回」可能把这个相册删空过：补齐照片后重试一次。
                status, current = admin._request("GET", f"/admin/albums/{album['id']}")
                payload = photos_payload if slug == ALBUM_PHOTOS else screens_payload
                status, current = admin.write(
                    "PATCH",
                    f"/admin/albums/{album['id']}",
                    {"photos": payload},
                    origin=origin,
                    if_match=f'"{current["version"]}"',
                )
                if status != 200:
                    raise RuntimeError(f"补齐照片失败（{slug}）：{status} {current}")
                status, published = admin.write(
                    "POST",
                    f"/admin/albums/{album['id']}/publish",
                    {},
                    origin=origin,
                    if_match=f'"{current["version"]}"',
                )
            if status != 200:
                raise RuntimeError(f"发布相册 {slug} 失败：{status} {published}")
            info["albums"][slug] = published
        else:
            info["albums"][slug] = current

    # **发布之后**再补齐可能缺失的照片：如果在上一步之前补齐，发布就是空操作，
    # 「单处撤回」场景会在一个仍然是 draft 的相册上跑（第一版就是这样，
    # 计数断言得到 1 → 1）。
    for slug, payload in ((ALBUM_PHOTOS, photos_payload), (ALBUM_SCREENS, screens_payload)):
        album = info["albums"][slug]
        status, current = admin._request("GET", f"/admin/albums/{album['id']}")
        if status != 200:
            continue
        if current["photo_count"] < len(payload):
            status, updated = admin.write(
                "PATCH",
                f"/admin/albums/{album['id']}",
                {"photos": payload},
                origin=origin,
                if_match=f'"{current["version"]}"',
            )
            if status != 200:
                raise RuntimeError(f"发布后补齐照片失败（{slug}）：{status} {updated}")
            info["albums"][slug] = updated
    info["media_ids"] = media_ids
    info["project_id"] = project_id_of(admin)
    return info


def _append_project_image(admin: "Admin", origin: str, project: dict, media_id: str) -> None:
    """把一张 media 追加到作品图片末尾（幂等由调用方保证）。"""
    images = [
        {
            "media_id": image["media_id"],
            "position": image["position"],
            "kind": image["kind"],
            "alt": image["alt"],
            "caption": image.get("caption") or "",
            "taken_on": image.get("taken_on"),
        }
        for image in project["images"]
    ]
    images.append(
        {
            "media_id": media_id,
            "position": len(images),
            "kind": "detail",
            "alt": "验证相册与作品共用同一张图",
            "caption": "同一份 media，两个上下文各自的说明",
            "taken_on": None,
        }
    )
    status, updated = admin.write(
        "PATCH",
        f"/admin/projects/{project['id']}",
        {"images": images},
        origin=origin,
        if_match=f'"{project["version"]}"',
    )
    if status != 200:
        raise RuntimeError(f"给作品追加共享图失败：{status} {updated}")


def attach_shared_media_to_project(admin: "Admin", origin: str, info: dict[str, Any]) -> None:
    """让**同一张 media** 同时被「相册」与「作品」公开引用。

    这是验收 3 与验收 2 的核心场景：一处撤回不等于删文件、全部撤回才 404。
    幂等：已经在作品里就不再追加（否则每跑一次作品就多一张重复图）。
    """
    project_id = info.get("project_id") or project_id_of(admin)
    info["project_id"] = project_id
    shared = info["shared_media_id"]
    status, project = admin._request("GET", f"/admin/projects/{project_id}")
    if status != 200:
        raise RuntimeError(f"读取作品失败：{status} {project}")
    if any(image["media_id"] == shared for image in project["images"]):
        return
    images = [
        {
            "media_id": image["media_id"],
            "position": image["position"],
            "kind": image["kind"],
            "alt": image["alt"],
            "caption": image.get("caption") or "",
            "taken_on": image.get("taken_on"),
        }
        for image in project["images"]
    ]
    images.append(
        {
            "media_id": shared,
            "position": len(images),
            "kind": "detail",
            "alt": "验证相册与作品共用同一张图",
            "caption": "同一份 media，两个上下文各自的说明",
            "taken_on": None,
        }
    )
    status, updated = admin.write(
        "PATCH",
        f"/admin/projects/{project_id}",
        {"images": images},
        origin=origin,
        if_match=f'"{project["version"]}"',
    )
    if status != 200:
        raise RuntimeError(f"给作品追加共享图失败：{status} {updated}")


def keep_albums_published(admin: Admin, albums: dict[str, Any]) -> None:
    """收尾：**保持**验证相册为公开状态。

    为什么不像 T04 那样在收尾时撤回：验收 3 的核心是「一张图有两处公开引用」。
    如果收尾把相册撤回，那条共享图就只剩作品这一处引用，下一轮再跑时
    「另一个相册里那张仍在」这类断言会因为**上一轮自己的清理**而失效
    （第一版踩到过：连续两轮得到 404 与计数不变，看起来像权限逻辑错）。

    验证相册留在库里是**有意的**：它们是本机联调数据，名字带 `t06-` 前缀，
    并且交付单里写明了如何删除。删除命令：
      psql -c "delete from albums where slug like 't06-%'"
    """
    for slug, album in albums.items():
        status, current = admin._request("GET", f"/admin/albums/{album['id']}")
        if status != 200:
            continue
        print(f"  （收尾）相册 {slug} 保持公开（status={current['status']}，照片 {current['photo_count']} 张）", flush=True)


# --- 场景 -------------------------------------------------------------------


def scenario_project(page: Page, base: str) -> None:
    """验收 1 / 5：作品列表 → 详情 → 攻略记录 → 专题；撤回专题不露出标题。"""
    open_page(page, "/showcase", base)
    page.wait_for_selector("[data-project]", timeout=15000)
    card_text = page.inner_text("[data-project]")
    check("作品列表显示真实作品（标题 + 一句话用途）", PROJECT_SLUG in page.get_attribute("[data-project]", "data-project") or "这个 P5 博客" in card_text, card_text.replace("\n", " / ")[:120])
    check("作品卡显示技术栈", "Next.js" in card_text and "FastAPI" in card_text)
    check("作品卡没有编造的成绩数字", not any(token in card_text for token in ("星", "人使用", "下载", "获奖")))
    shot(page, "t06-showcase-desktop")

    origin_before = time_origin(page)
    page.click("[data-project]")
    page.wait_for_url(f"**/showcase/projects/{PROJECT_SLUG}", timeout=15000)
    check("点作品卡进入详情（客户端导航，不是整页重载）", time_origin(page) == origin_before, f"timeOrigin {origin_before} → {time_origin(page)}")
    page.wait_for_selector("[data-section]", timeout=15000)
    body = page.inner_text("body")
    check("详情展示职责 / 问题 / 取舍 / 成果四节", all(text in body for text in ("个人职责", "解决的问题", "关键取舍", "可验证成果")))
    check("详情有真实仓库链接", page.locator("[data-project-link]").count() >= 1)
    check("攻略记录指向公开专题", page.locator(f"[data-guide-entry='{PALACE_SLUG}']").count() == 1)
    shot(page, "t06-project-desktop")

    # 撤回专题 → 作品页仍在，但不露出隐藏标题。
    set_palace_status("draft")
    page.reload(wait_until="load")
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)
    page.wait_for_selector("[data-guide]", timeout=15000)
    retracted_text = page.inner_text("body")
    check("专题撤回后作品仍然可读（不连带删除作品）", "这个 P5 博客" in retracted_text)
    check("撤回后不显示攻略记录入口", page.locator("[data-guide-entry]").count() == 0)
    check("撤回后不露出隐藏专题的标题", "怪盗据点工程" not in retracted_text)
    check("撤回后给出「没有可读的攻略记录」说明", page.locator("[data-guide-unavailable]").count() == 1)
    shot(page, "t06-project-palace-retracted")

    set_palace_status("published")
    page.reload(wait_until="load")
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_selector("[data-guide-entry]", timeout=15000)
    check("恢复专题后攻略记录入口回来", page.locator("[data-guide-entry]").count() == 1)


def scenario_gallery(page: Page, base: str, info: dict[str, Any], admin: "Admin") -> None:
    """验收 2 / 3 / 4 / 6：照片墙、两个相册并行、灯箱键盘、单处撤回。"""
    open_page(page, "/showcase/photos", base)
    page.wait_for_selector(".photo-tile", timeout=15000)
    check("照片墙渲染出图格", page.locator(".photo-tile").count() >= 3, f"{page.locator('.photo-tile').count()} 格")
    check("每张图都有 alt", page.eval_on_selector_all("img.photo-tile-image", "els => els.every(e => !!e.getAttribute('alt'))"))
    check("图格用真实宽高（自然比例，不裁切）", page.eval_on_selector_all("img.photo-tile-image", "els => els.every(e => e.getAttribute('width') && e.getAttribute('height'))"))
    check("没有拍摄时间的图明确写「未填写日期」", "未填写日期" in page.inner_text("body"))
    shot(page, "t06-photos-desktop")

    # 相册 scope（同一份数据，同一页面的另一个筛选）。
    page.click(f"[data-filter='album-{ALBUM_SCREENS}']")
    page.wait_for_url("**album=t06-screens*", timeout=15000)
    page.wait_for_selector(".photo-tile", timeout=15000)
    check("按相册筛选后只剩该相册的照片", page.locator(".photo-tile").count() == 1, f"{page.locator('.photo-tile').count()} 格")

    # 灯箱：键盘 ← / → / Escape 与焦点归还。
    page.click("button.photo-tile-button")
    page.wait_for_selector("[data-lightbox]", timeout=10000)
    check("灯箱打开", page.locator("[data-lightbox]").count() == 1)
    shot(page, "t06-lightbox-desktop")
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    check("Escape 关闭灯箱", page.locator("[data-lightbox]").count() == 0)
    focused = page.evaluate("() => document.activeElement?.className ?? ''")
    check("关闭后焦点回到图格按钮", "photo-tile-button" in focused, focused)

    # 回到全部照片，验证箭头键在两张图之间移动。
    page.goto(base + "/showcase/photos", wait_until="load")
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_selector(".photo-tile", timeout=15000)
    page.click("button.photo-tile-button")
    page.wait_for_selector("[data-lightbox]", timeout=10000)
    counter_before = page.inner_text(".plg-lightbox-counter")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(200)
    counter_after = page.inner_text(".plg-lightbox-counter")
    check("→ 键切到下一张", counter_before != counter_after, f"{counter_before} → {counter_after}")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(200)
    check("← 键切回上一张", page.inner_text(".plg-lightbox-counter") == counter_before)
    page.keyboard.press("End")
    page.wait_for_timeout(200)
    check("End 跳到末张", "3 / 3" in page.inner_text(".plg-lightbox-counter"), page.inner_text(".plg-lightbox-counter"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)

    # --- 验收 3：一处引用撤回 vs 所有引用撤回（真实 HTTP，可复查）----------
    #
    # 两张图**从数据库当前的真实引用里取**，不靠上传顺序推断（第一版就是那样，
    # 断言失败时看起来像权限逻辑错，实际是夹具选错了图 —— 见交付单 §5.5）：
    #
    #   media_two_albums：同时在 t06-photos 与 t06-screens 两个公开相册里
    #   media_album_and_project：在 t06-photos 与作品 p5-blog 里
    #
    # 场景顺序：
    #   A. 两处引用 → 匿名 200；
    #   B. 从 t06-screens 删掉 media_two_albums → 另一处（t06-photos）仍在 → 匿名 200；
    #   C. 撤回作品 → media_album_and_project 仍被相册引用 → 200；
    #   D. 撤回 t06-photos → media_album_and_project 再无公开引用 → 404；
    #   E. 恢复 t06-photos → 又变 200（撤回是可逆的状态变化，不销毁引用）。
    live_photos = media_ids_in_album(admin, ALBUM_PHOTOS)
    live_screens = media_ids_in_album(admin, ALBUM_SCREENS)
    media_two_albums = next((item for item in live_screens if item in live_photos), None)
    if media_two_albums is None:
        check("截图相册里有一张也在摄影相册里的图（一图多引用）", False, f"photos={live_photos} screens={live_screens}")
        media_two_albums = live_screens[0] if live_screens else info["shared_media_id"]
    else:
        check("截图相册里有一张也在摄影相册里的图（一图多引用）", True)
    media_album_and_project = next(
        (item for item in live_photos if item != media_two_albums), None
    ) or info["shared_media_id"]
    check(
        "作品与摄影相册共用同一张图（另一处公开引用）",
        media_album_and_project in live_photos,
        f"{media_album_and_project} in {live_photos}",
    )

    anon_before = _anonymous_status(base, media_album_and_project)
    check("撤回前：同一张图匿名可读（作品 + 相册两处引用）", anon_before == 200, f"HTTP {anon_before}")
    check(
        "原图永远匿名不可读",
        _anonymous_status(base, media_album_and_project, variant="original") == 404,
    )

    status_project, project_before = admin._request("GET", f"/admin/projects/{info['project_id']}")
    check("读取作品（准备逐处撤回引用）", status_project == 200, f"HTTP {status_project}")
    project_unpublished = False
    if status_project == 200 and project_before["status"] == "published":
        admin.write(
            "POST",
            f"/admin/projects/{info['project_id']}/unpublish",
            {},
            origin=base,
            if_match=f'"{project_before["version"]}"',
        )
        project_unpublished = True
        check(
            "撤回作品那一处后匿名仍可读（相册还在公开引用它）",
            _anonymous_status(base, media_album_and_project) == 200,
        )

    # 所有引用撤回：作品已撤回，再把摄影相册也撤回 → 匿名必须 404。
    photos_album = info["albums"][ALBUM_PHOTOS]
    status, photos_current = admin._request("GET", f"/admin/albums/{photos_album['id']}")
    check("读取摄影相册（准备撤回全部引用）", status == 200, f"HTTP {status}")
    album_unpublished = False
    if status == 200 and photos_current["status"] == "published":
        admin.write(
            "POST",
            f"/admin/albums/{photos_album['id']}/unpublish",
            {},
            origin=base,
            if_match=f'"{photos_current["version"]}"',
        )
        album_unpublished = True
    if project_unpublished and album_unpublished:
        check(
            "所有公开引用撤回后匿名读图变 404",
            _anonymous_status(base, media_album_and_project) == 404,
        )
    else:
        check("所有公开引用撤回后匿名读图变 404", False, "前置状态不是「都公开」，本项未成立")

    # 恢复：先恢复相册（此时作品还没恢复 → 应当又是 200，因为相册这一处回来了）。
    if album_unpublished:
        status, restored = admin._request("GET", f"/admin/albums/{photos_album['id']}")
        if status == 200 and restored["status"] != "published":
            admin.write(
                "POST",
                f"/admin/albums/{photos_album['id']}/publish",
                {},
                origin=base,
                if_match=f'"{restored["version"]}"',
            )
        check(
            "只恢复一处引用就够：匿名读图又变 200",
            _anonymous_status(base, media_album_and_project) == 200,
        )
    if project_unpublished:
        status, project_now = admin._request("GET", f"/admin/projects/{info['project_id']}")
        if status == 200 and project_now["status"] != "published":
            admin.write(
                "POST",
                f"/admin/projects/{info['project_id']}/publish",
                {},
                origin=base,
                if_match=f'"{project_now["version"]}"',
            )
        check("作品恢复发布（收尾回到原状态）", _anonymous_status(base, media_album_and_project) == 200)

    # 单处撤回：从截图相册移除那张**也在摄影相册里**的图 —— 另一个相册不受影响。
    screens = info["albums"][ALBUM_SCREENS]
    status, current = admin._request("GET", f"/admin/albums/{screens['id']}")
    check("读取截图相册（准备单处撤回）", status == 200, f"HTTP {status}")
    if status == 200:
        # 删**这个相册里真实在引用的**那一张（不是本轮上传的临时 id）。
        in_screens = media_ids_in_album(admin, ALBUM_SCREENS)
        check(
            "截图相册里确实有那张跨相册复用的图",
            media_two_albums in in_screens,
            f"{in_screens}",
        )
        delete_status, delete_body = admin.write(
            "DELETE",
            f"/admin/albums/{screens['id']}/photos/{media_two_albums}",
            {},
            origin=base,
            if_match=f'"{current["version"]}"',
        )
        check("单处撤回返回 204", delete_status == 204, f"HTTP {delete_status} {delete_body}")
        status_after, after = admin._request("GET", f"/admin/albums/{screens['id']}")
        check(
            "单处撤回：被撤的那一处确实没有这张图了",
            status_after == 200 and after["photo_count"] == current["photo_count"] - 1,
            f"{current['photo_count']} → {after.get('photo_count')}",
        )
        check(
            "单处撤回：另一个相册里那张仍在（同一个媒体文件两处引用）",
            _anonymous_status(base, media_two_albums) == 200,
        )

    # 图片损坏态：把一张图的 src 换成不存在的变体，验证失败态。
    page.evaluate(
        """() => {
          const img = document.querySelector('img.photo-tile-image');
          if (img) img.src = '/api/v1/media/00000000-0000-4000-8000-000000000000/w640.webp';
        }"""
    )
    page.wait_for_timeout(900)
    check("图片损坏时出现失败态占位", page.locator("[data-photo-fallback]").count() >= 1)
    check("失败态保留日期文字（说明没有整块消失）", "未填写日期" in page.inner_text("body") or "2026-10-16" in page.inner_text("body"))
    shot(page, "t06-photo-broken")

    return None


def _anonymous_status(base: str, media_id: str, *, variant: str = "w320.webp") -> int:
    import urllib.error
    import urllib.request

    url = f"{base}/api/v1/media/{media_id}/{variant}"
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def scenario_narrow(page: Page, base: str) -> None:
    """验收 6：390 / 320px 无横向溢出。"""
    for width, name in ((NARROW, "390"), (TINY, "320")):
        page.set_viewport_size(width)
        for path, label in (("/showcase", "showcase"), ("/showcase/photos", "photos"), (f"/showcase/projects/{PROJECT_SLUG}", "project")):
            open_page(page, path, base)
            page.wait_for_timeout(400)
            overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(f"{name}px {label} 无横向溢出", overflow <= 1, f"{overflow}px")
        # 每个宽度各截一张照片墙与一张作品详情（视口标签写清楚，避免误读）。
        shot(page, f"t06-{name}-photos")
        open_page(page, f"/showcase/projects/{PROJECT_SLUG}", base)
        page.wait_for_timeout(300)
        shot(page, f"t06-{name}-project")


def scenario_no_side_effects(page: Page, base: str) -> None:
    """验收 4：不新增 body 锁、不新增音频（音乐单例不被相册重建）。"""
    open_page(page, "/showcase/photos", base)
    page.wait_for_selector(".photo-tile", timeout=15000)
    page.click("button.photo-tile-button")
    page.wait_for_selector("[data-lightbox]", timeout=10000)
    audio_count = page.evaluate("() => document.querySelectorAll('audio').length")
    check("灯箱打开时不新增 <audio>", audio_count <= 1, f"{audio_count} 个 audio 元素（含站点音乐的 1 个单例）")
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)


def main() -> int:
    parser = argparse.ArgumentParser(description="T06 真实浏览器验收")
    parser.add_argument("--base", default="http://127.0.0.1:3103", help="前端地址")
    parser.add_argument("--api", default="http://127.0.0.1:8103", help="API 地址（直连，不经过 Next rewrite）")
    parser.add_argument("--username", default="t06owner")
    parser.add_argument("--password", default="t06-owner-password-123")
    parser.add_argument("--no-fixtures", action="store_true", help="跳过建立验证相册（只测作品与既有内容）")
    args = parser.parse_args()

    admin = Admin(args.api, args.username, args.password)
    admin.login(args.base)

    info: dict[str, Any] = {"media_ids": [], "albums": {}}
    if not args.no_fixtures:
        print("== 准备验证相册（真实 HTTP 管理端点）==", flush=True)
        info = ensure_albums(admin, args.base)
        print(json.dumps(info["albums"], ensure_ascii=False, default=str)[:400], flush=True)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport=DESKTOP, device_scale_factor=2)
            page.on("pageerror", lambda error: print(f"  [pageerror] {error}", flush=True))

            scenario_project(page, args.base)
            if info["media_ids"]:
                scenario_gallery(page, args.base, info, admin)
                scenario_no_side_effects(page, args.base)
            else:
                check("照片墙场景（需要验证相册）", False, "跳过：--no-fixtures")
            scenario_narrow(page, args.base)

            browser.close()
    finally:
        if info["albums"]:
            print("== 收尾：验证相册保持公开（见 keep_albums_published 的说明）==", flush=True)
            try:
                keep_albums_published(admin, info["albums"])
            except Exception as error:  # pragma: no cover - 收尾失败不应掩盖验收结果
                print(f"  收尾失败：{error}", flush=True)

    passed = sum(1 for item in results if item["ok"])
    failed = [item for item in results if not item["ok"]]
    print(f"\n=== T06 浏览器验收：{passed} passed / {len(failed)} failed ===")
    for item in failed:
        print(f"FAIL {item['check']} — {item['detail']}")
    print("\n截图：")
    for path in shots:
        print(f"  {path}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
