#!/usr/bin/env python3
"""T09 真实浏览器验收（Playwright + 系统 chromium；**不进** apps/web 依赖）。

前置（全部真实进程，无 mock）：

  1. 真实 PostgreSQL + 迁移 + 站主 + 旧文章 + T04 专题 + T06 的第一件真实作品：
       python -m app.commands.bootstrap_admin --username owner --password-stdin
       python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
       python -m app.modules.nav.seed --create-tables --apply --publish
       python -m app.modules.projects.seed --create-tables --apply --publish --palace-slug phantom-base
  2. T09 的技能与问题记录（T09 **不写迁移**，集成前用 `--create-tables` 临时补表）：
       python -m app.modules.skills.seed --create-tables --apply --publish
  3. 真实 API。T09 的路由由集成负责人登记到 `app/router.py`；登记之前用
     `--app-dir` 指向一个临时入口（本脚本的调用方负责提供，见交付单 §5）：
       uvicorn --app-dir <dir> t09-dev-app:app --port 8109
  4. 构建并启动前端（`DEV_API_URL` 必须在 **build** 时就有值）：
       DEV_API_URL=http://127.0.0.1:8109 npm --prefix apps/web run build
       API_INTERNAL_URL=http://127.0.0.1:8109 npm --prefix apps/web run start -- --port 3110
  5. 运行：
       python3 apps/web/features/velvet/tools/verify-t09.py \
           --api http://127.0.0.1:8109 --web http://127.0.0.1:3110

脚本自己做的事（**不写仓库、不写生产库**）：

  * 用**真实 HTTP 管理端点**（登录 → CSRF → If-Match）造一个「没有交集」的技能对：
    新建并发布 `t09-browser-only`（浏览器验收专用的能力条目），它与任何既有技能都不构成
    交集 —— 用来验证空交集是**明确空态**而不是编造作品。
  * 收尾把它**撤回**（不是删除）：撤回后公开页不再显示，技能本身保留给下一轮复用。
  * 另外用真实 SQL 撤回第一件作品 / 一篇文章，验证「撤回关联内容后不泄漏隐藏标题」，
    然后恢复原状态。

覆盖的验收用例（T09 任务卡 §验收）：

  1. `/velvet` 技能全书真的渲染出公开技能与关联作品数，且**没有任何等级 / 熟练度数字**；
  2. 「合体」：选两个有交集的技能 → 只列出交集作品；选两个没有交集的技能 → 明确空态
     且页面上没有「生成 / 推荐」入口；同一个技能选两次 → 明确报错且不发请求；
  3. 技能详情显示范围说明与掌握证据，关联作品链到 T06 的作品详情；
  4. 未发布技能的直接地址是真正的 404（不是空页面）；
  5. `/apps/metanav/mementos` 与单条记录：工作状态徽标、已解决记录的解决日期与结果说明、
     关联内容撤回后引用消失且**隐藏标题不出现在 HTML 里**；
  6. 320 / 390px 无横向溢出；键盘可达；`prefers-reduced-motion` 下页面仍可用；
     全过程 `audio[data-pl-music]` 数量不增加（音乐单例不被触碰）。

**水合时序**：点击前先等 `window.__PHANTOM_DEBUG__` 出现（水合完成），不要用固定 sleep；
判断整页重载用 `performance.timeOrigin` 是否变化（不要用注入标记 —— 那会自扰动）。
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
from typing import Any

from playwright.sync_api import Page, sync_playwright

# 截图目录：默认落在工作区的 .dsh 下（与 T02 / T06 的验收脚本一致），
# 可以用 `T09_SCREENSHOT_DIR` 覆盖 —— 绝对路径写在脚本里只是本机约定，
# 不该成为别人跑不动这个脚本的原因。
OUT = pathlib.Path(os.environ.get("T09_SCREENSHOT_DIR", str(pathlib.Path.home() / ".dsh/screenshots")))
DESKTOP = {"width": 1280, "height": 900}
NARROW = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 844}

PSQL = "/opt/homebrew/opt/postgresql@18/bin/psql"
DEV_DB = "pl_test_t09_dev"
PROJECT_SLUG = "p5-blog"
BROWSER_ONLY_SKILL = "t09-browser-only"
# 「与谁都没有交集」的条目：它**不关联任何作品**。用它来验证空交集，而不是指望两个
# 都关联了 p5-blog 的技能「碰巧」没有交集 —— 第一次跑就是这么错的（它们当然有交集）。
SEEDLESS_SKILL = "t09-seedless-skill"
# 「还没有结论」的条目：工作状态是**调查中**、`outcome` 为空。
# service 只在「已解决」时强制要求结果说明，因此这条状态是合法的公开形态。
OPEN_RECORD = "t09-open-question"
USERNAME = "owner"
PASSWORD = "t09-owner-password-123"

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


def open_page(page: Page, url: str, *, hydrated: bool = True) -> None:
    """打开页面 → 关开屏 → 关问卷浮层 → 等运行时探针可用（= 水合完成）。"""
    page.goto(url, wait_until="load")
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


def music_count(page: Page) -> int:
    return int(page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length"))


def psql(sql: str) -> None:
    completed = subprocess.run(
        [PSQL, "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", DEV_DB, "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"psql 失败：{completed.stderr.strip()}")


def overflow(page: Page) -> int:
    return int(
        page.evaluate(
            "() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)"
        )
    )


class Admin:
    """用真实 HTTP 管理端点做夹具（不直接写表）。

    直接打 API 端口（不经过 Next 的 rewrite），并显式带 `Origin`：浏览器 → Next 的
    POST 不带 Origin，而 `core/csrf.py` 按 05 §5 拒绝缺失 Origin 的写请求
    （T03 交付单 §8 第 1 条记录了这个集成层差异）。
    """

    def __init__(self, api_base: str) -> None:
        self.api_base = api_base.rstrip("/")
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
            {"username": USERNAME, "password": PASSWORD, "csrf_token": self.csrf},
            {"Origin": origin},
        )
        if status != 200:
            raise RuntimeError(f"登录失败：{status} {payload}")
        self.csrf = payload.get("csrf_token", self.csrf)

    def write(self, method: str, path: str, body: dict | None = None, *, origin: str, if_match: str | None = None):
        headers = {"Origin": origin, "X-CSRF-Token": self.csrf}
        if if_match is not None:
            headers["If-Match"] = if_match
        return self._request(method, path, dict(body or {}), headers)


def _admin_items(admin: Admin, path: str) -> dict[str, dict[str, Any]]:
    status, page = admin._request("GET", path)
    if status != 200:
        raise RuntimeError(f"读取 {path} 失败：{status} {page}")
    return {item["slug"]: item for item in page.get("items", [])}


def _ensure_published(
    admin: Admin, origin: str, existing: dict[str, Any] | None, path: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """取或建并发布一条资源（幂等）。`path` 是管理列表 / 创建端点。"""
    if existing is not None:
        if existing["status"] != "published":
            status, published = admin.write(
                "POST",
                f"{path}/{existing['id']}/publish",
                {},
                origin=origin,
                if_match=f'"{existing["version"]}"',
            )
            if status != 200:
                raise RuntimeError(f"发布 {payload['slug']} 失败：{status} {published}")
            return published
        return existing

    status, created = admin.write("POST", path, payload, origin=origin)
    if status != 201:
        raise RuntimeError(f"创建 {payload['slug']} 失败：{status} {created}")
    status, published = admin.write(
        "POST",
        f"{path}/{created['id']}/publish",
        {},
        origin=origin,
        if_match=f'"{created["version"]}"',
    )
    if status != 200:
        raise RuntimeError(f"发布 {payload['slug']} 失败：{status} {published}")
    return published


def ensure_fixtures(admin: Admin, origin: str) -> dict[str, Any]:
    """幂等地准备验收需要的三条**脚本自有**资源。

    为什么需要它们：验收要证明的几件事在「真实内容」里本来不该存在 ——
    「完全没有交集」、「一条还没有结论的记录」。用站主自己的内容去凑这些状态会污染
    真实内容；因此脚本建三个以 `t09-` 开头的条目，并且**收尾时撤回**（不是删除），
    下一轮可以复用。
    """
    skills = _admin_items(admin, "/admin/skills?limit=30")
    browser_only = _ensure_published(
        admin,
        origin,
        skills.get(BROWSER_ONLY_SKILL),
        "/admin/skills",
        {
            "slug": BROWSER_ONLY_SKILL,
            "name": "浏览器验收专用条目",
            "domain": "other",
            "scope": "脚本为了验证交互路径而创建的条目，不关联任何作品。",
            "evidence": "这个条目由 verify-t09.py 创建；它存在的意义是把验收路径走完。",
            "position": 999,
            "links": [],
            "projects": [],
        },
    )
    seedless = _ensure_published(
        admin,
        origin,
        skills.get(SEEDLESS_SKILL),
        "/admin/skills",
        {
            "slug": SEEDLESS_SKILL,
            "name": "尚未关联作品的条目",
            "domain": "other",
            "scope": "这条能力条目还没有关联任何作品，用来验证「没有交集」的空态。",
            "evidence": "它存在的意义就是把「没有证据链」这条路径显示出来，而不是被隐藏。",
            "position": 998,
            "links": [],
            "projects": [],
        },
    )

    records = _admin_items(admin, "/admin/exploration/records?limit=30")
    open_record = _ensure_published(
        admin,
        origin,
        records.get(OPEN_RECORD),
        "/admin/exploration/records",
        {
            "slug": OPEN_RECORD,
            "title": "一个还没有结论的问题",
            "background": "脚本为了验证「调查中且还没有结果说明」这条展示路径而创建的记录。",
            "attempts": "记录本身没有尝试过程：它要验证的正是「缺项时界面怎么写」。",
            "outcome": "",
            "work_status": "investigating",
            "evidence_links": [],
            "posts": [],
            "projects": [],
        },
    )
    return {"browser_only": browser_only, "seedless": seedless, "open_record": open_record}


def withdraw_fixtures(admin: Admin, origin: str) -> None:
    """收尾：把脚本自己造的三条资源撤回（不是删除），下一轮可以复用。"""
    for path in ("/admin/skills?limit=30", "/admin/exploration/records?limit=30"):
        status, page = admin._request("GET", path)
        if status != 200:
            continue
        for item in page.get("items", []):
            if item["slug"] in {BROWSER_ONLY_SKILL, SEEDLESS_SKILL, OPEN_RECORD} and item["status"] == "published":
                admin.write(
                    "POST",
                    f"{path.split('?')[0]}/{item['id']}/unpublish",
                    {},
                    origin=origin,
                    if_match=f'"{item["version"]}"',
                )


# --- 覆盖项 -----------------------------------------------------------------


def verify_velvet_book(page: Page, web: str) -> None:
    open_page(page, f"{web}/velvet")
    shot(page, "t09-velvet-desktop")

    cards = page.locator("[data-skill]")
    total_cards = cards.count()
    check("技能全书渲染出公开技能卡", total_cards >= 3, f"{total_cards} 张")
    body = page.inner_text("body")
    check("技能卡显示关联作品数", "关联作品" in body)
    import re

    check("页面没有等级 / 熟练度字样", not re.search(r"等级|熟练度|完成度|掌握度|Lv\.?\s*\d", body))
    check("页面没有百分比数字", not re.search(r"\d+\s*%", body))

    # 领域筛选走真实导航（SiteLink → 协调器），不应整页重载。
    #
    # 这里刻意用 `a[href="/velvet?domain=algorithm"]` 定位，而不是 `text=算法与数据结构`：
    # 后者会同时命中**合体下拉里的 option** 与筛选链接，Playwright 的 strict 模式
    # 会直接报错（"resolved to N elements"）—— 第一次跑就撞上了。
    origin_before = time_origin(page)
    page.click('a[href="/velvet?domain=algorithm"]')
    # 等 URL 真的变过去，而不是固定 sleep：`page.url` 在导航提交前就已经可能是新地址。
    page.wait_for_function("() => location.search.includes('domain=algorithm')", timeout=10000)
    page.wait_for_timeout(500)
    check("领域筛选不触发整页重载", time_origin(page) == origin_before)
    check("筛选后地址带 domain", "domain=algorithm" in page.url, page.url)
    check("筛选后只剩该领域的技能", "ACM" in page.inner_text("body"))
    filtered = page.locator("[data-skill]").count()
    check("筛选后技能卡变少", filtered < total_cards, f"{total_cards} → {filtered}")


def verify_combo(page: Page, web: str) -> None:
    open_page(page, f"{web}/velvet")
    select_a = page.locator("[data-combo-a]")
    select_b = page.locator("[data-combo-b]")
    check("合体控件存在两个选择器", select_a.count() == 1 and select_b.count() == 1)

    # 1) 重复选择同一技能：明确报错 + 按钮禁用 + 不发请求。
    select_a.select_option("acm-algorithms")
    select_b.select_option("acm-algorithms")
    page.wait_for_timeout(200)
    check("重复选择同一技能时给出明确提示", page.locator("[data-combo-same]").count() == 1)
    check("重复选择时运行按钮被禁用", page.locator("[data-combo-run]").is_disabled())

    # 2) 有交集：两个共同关联 p5-blog 的技能。
    select_b.select_option("fastapi-service-design")
    page.locator("[data-combo-run]").click()
    page.wait_for_selector("[data-combo-result]", timeout=8000)
    page.wait_for_timeout(300)
    rows = page.locator("[data-combo-result] [data-combo-project]")
    check("有交集时列出交集作品", rows.count() == 1, f"{rows.count()} 件")
    check(
        "交集作品就是 p5-blog",
        rows.first.get_attribute("data-combo-project") == PROJECT_SLUG,
        str(rows.first.get_attribute("data-combo-project")),
    )
    shot(page, "t09-combo-intersection")

    # 3) 空交集：明确空态，且页面没有「生成 / 推荐」入口。
    select_a.select_option("acm-algorithms")
    select_b.select_option(SEEDLESS_SKILL)
    page.wait_for_timeout(200)
    check(
        "两次选择都真的生效（不是只改了一个）",
        select_a.input_value() == "acm-algorithms"
        and select_b.input_value() == SEEDLESS_SKILL,
        f"{select_a.input_value()} × {select_b.input_value()}",
    )
    page.locator("[data-combo-run]").click()
    page.wait_for_selector("[data-combo-result]", timeout=8000)
    page.wait_for_selector("[data-combo-empty]", timeout=8000)
    page.wait_for_timeout(300)
    empty_text = page.locator("[data-combo-empty]").inner_text()
    check("空交集给出明确说明", "还没有同时用到这两个技能的公开作品" in empty_text)
    check("空交集说明里写明不会生成作品", "不会替你生成" in empty_text)
    buttons = " ".join(page.locator("button").all_inner_texts())
    check("空交集页面没有「生成 / 推荐 / 随机」按钮", not any(word in buttons for word in ("生成", "推荐", "随机")))
    shot(page, "t09-combo-empty")


def verify_skill_detail(page: Page, web: str) -> None:
    open_page(page, f"{web}/velvet/react-next-app-router")
    body = page.inner_text("body")
    check("技能详情显示范围说明", "范围说明" in body)
    check("技能详情显示掌握证据", "掌握证据" in body)
    check("技能详情显示关联作品小节", "能力对应的作品" in body)

    link = page.locator("[data-skill-project] a").first
    href = link.get_attribute("href")
    check("关联作品链到 T06 的作品详情", href == f"/showcase/projects/{PROJECT_SLUG}", str(href))

    origin_before = time_origin(page)
    link.click()
    page.wait_for_timeout(1200)
    check("从技能跳到作品不整页重载", time_origin(page) == origin_before)
    check("到达作品详情", f"/showcase/projects/{PROJECT_SLUG}" in page.url, page.url)
    shot(page, "t09-skill-to-project")


def verify_unpublished_skill_404(page: Page, web: str) -> None:
    response = page.goto(f"{web}/velvet/this-skill-does-not-exist-9f2a")
    check("不存在的技能返回真正的 404", response is not None and response.status == 404, str(response.status if response else None))
    shot(page, "t09-skill-404")


def verify_mementos(page: Page, web: str) -> None:
    open_page(page, f"{web}/apps/metanav/mementos")
    shot(page, "t09-mementos-desktop")
    cards = page.locator("[data-record]")
    check("问题记录列表渲染出记录", cards.count() >= 3, f"{cards.count()} 条")
    body = page.inner_text("body")
    check("列表明确写出是站主整理", "站主自己整理" in body)
    check("列表明确不是公开请求板", "不是公开的请求板" in body)
    check("列表保留分类探索入口", "分类印象空间" in body)

    stats = page.inner_text(".pme-stats")
    check("统计只显示公开记录", "全部" in stats)

    # 已解决记录：解决日期与实际结果说明。
    open_page(page, f"{web}/apps/metanav/mementos/animation-pointer-events")
    detail = page.inner_text("body")
    check("详情显示工作状态", "已解决" in detail)
    check("详情显示解决日期", "解决于" in detail)
    check("详情显示实际结果说明", "把过渡遮罩的卸载与指针事件的恢复放进同一个提交顺序里" in detail)
    shot(page, "t09-memento-detail")

    # 暂搁置的记录：不显示「解决于」，但它**有**结果说明（「查过了、先不做」本身是结论）。
    open_page(page, f"{web}/apps/metanav/mementos/pg-trgm-for-chinese-search")
    archived = page.inner_text("body")
    check("暂搁置的记录不显示解决日期", "解决于" not in archived)
    check("暂搁置的记录仍显示实际结果说明", "首版先用参数化条件查询" in archived)

    # 调查中且还没有结果说明：明确写「还没有结论」，而不是留一个空标题。
    open_page(page, f"{web}/apps/metanav/mementos/{OPEN_RECORD}")
    open_body = page.inner_text("body")
    check("调查中且无结果时写「还没有结论」", "还没有结论" in open_body)
    check("并说明它仍在哪个状态", "调查中" in open_body)
    check("没有结果时不显示空的结果段落", page.locator("[data-record-outcome]").count() == 0)
    shot(page, "t09-memento-open")


def verify_related_withdrawn(page: Page, web: str, slug: str, column: str) -> None:
    """用真实 SQL 撤回一件作品 / 一篇文章，确认隐藏标题**从可见变成不可见**。

    这里刻意先打开一次记录页再撤回：

      - 撤回**前**要确认那个标题真的出现过（否则「撤回后没有」可能只是因为本来就没渲染，
        断言会永远通过 —— 第一次跑就是这么错的，诊断信息直接暴露了它）；
      - 撤回**后**重新打开，确认引用整条消失，且 HTML 里连标题字符串都没有。
    """
    if column == "projects":
        target = PROJECT_SLUG
        hidden_title = "这个 P5 博客"
        restore = f"update projects set status = 'published', published_at = now() where slug = '{target}'"
        withdraw = f"update projects set status = 'draft', published_at = null where slug = '{target}'"
    else:
        target = "phantom-blog-launch"
        hidden_title = "我把博客改造成了怪盗的基地"
        restore = f"update posts set status = 'published', published_at = now() where slug = '{target}'"
        withdraw = f"update posts set status = 'draft', published_at = null where slug = '{target}'"

    open_page(page, f"{web}/apps/metanav/mementos/{slug}")
    before_html = page.content()
    check(f"{slug} 撤回 {column} 前该标题是可见的", hidden_title in before_html, hidden_title)

    psql(withdraw)
    try:
        open_page(page, f"{web}/apps/metanav/mementos/{slug}")
        html = page.content()
        check(
            f"撤回 {column} 后记录本身仍可读",
            page.locator("[data-record-reading]").count() == 1,
        )
        check(
            f"撤回 {column} 后不出现「已隐藏」占位",
            "已隐藏" not in html and "已撤回" not in html,
        )
        check(
            f"撤回 {column} 后隐藏标题不出现在 HTML 里",
            hidden_title not in html,
            f"（撤回前出现过：{hidden_title in before_html}）",
        )
        shot(page, f"t09-withdrawn-{column}")
    finally:
        psql(restore)

    # 恢复之后必须又能看到（证明上一步的消失是撤回造成的，而不是页面本来就不显示）。
    open_page(page, f"{web}/apps/metanav/mementos/{slug}")
    check(
        f"恢复 {column} 后标题重新可见",
        hidden_title in page.content(),
        hidden_title,
    )


def verify_responsive_and_runtime(page: Page, web: str) -> None:
    for label, viewport, url in (
        ("velvet-390", NARROW, "/velvet"),
        ("velvet-320", TINY, "/velvet"),
        ("mementos-390", NARROW, "/apps/metanav/mementos"),
        ("mementos-320", TINY, "/apps/metanav/mementos"),
    ):
        page.set_viewport_size(viewport)
        open_page(page, f"{web}{url}")
        width = overflow(page)
        check(f"{label} 无横向溢出", width <= 1, f"溢出 {width}px")
        shot(page, f"t09-{label}")
    page.set_viewport_size(DESKTOP)

    # 减少动态效果：页面仍可用（内容照常渲染，导航仍然工作）。
    page.emulate_media(reduced_motion="reduce")
    open_page(page, f"{web}/velvet")
    check("减少动态效果下技能全书仍可用", page.locator("[data-skill]").count() >= 3)
    page.emulate_media(reduced_motion="no-preference")

    # 音乐单例不被触碰：T09 的页面不新增 audio 元素。
    open_page(page, f"{web}/apps/metanav/mementos")
    before = music_count(page)
    page.locator("[data-record]").first.click()
    page.wait_for_timeout(1200)
    after = music_count(page)
    check("问题记录页面不新增音频元素", after <= before, f"{before} → {after}")

    # 键盘：Tab 能到达筛选控件，Enter 能激活链接。
    open_page(page, f"{web}/velvet")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    focused = page.evaluate("() => document.activeElement?.tagName ?? ''")
    check("键盘可达（Tab 聚焦到可交互元素）", focused in {"A", "BUTTON", "INPUT", "SELECT"}, focused)


def main() -> int:
    parser = argparse.ArgumentParser(description="T09 真实浏览器验收")
    parser.add_argument("--api", default="http://127.0.0.1:8109")
    parser.add_argument("--web", default="http://127.0.0.1:3110")
    parser.add_argument("--json-out", default=None)
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    origin = args.web
    admin = Admin(args.api)
    admin.login(origin)
    ensure_fixtures(admin, origin)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=not args.headed)
            page = browser.new_page(viewport=DESKTOP)
            page.set_default_timeout(20000)

            verify_velvet_book(page, args.web)
            verify_combo(page, args.web)
            verify_skill_detail(page, args.web)
            verify_unpublished_skill_404(page, args.web)
            verify_mementos(page, args.web)
            verify_related_withdrawn(page, args.web, "animation-pointer-events", "projects")
            verify_related_withdrawn(page, args.web, "dev-api-url-at-build-time", "posts")
            verify_responsive_and_runtime(page, args.web)

            browser.close()
    finally:
        withdraw_fixtures(admin, origin)

    passed = sum(1 for item in results if item["ok"])
    failed = [item for item in results if not item["ok"]]
    print(f"\n=== {passed}/{len(results)} 通过 ===")
    for item in failed:
        print(f"FAIL {item['check']} — {item['detail']}")
    print("screenshots:")
    for path in shots:
        print(f"  {path}")

    if args.json_out:
        pathlib.Path(args.json_out).write_text(
            json.dumps({"results": results, "screenshots": shots}, ensure_ascii=False, indent=2)
        )
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
