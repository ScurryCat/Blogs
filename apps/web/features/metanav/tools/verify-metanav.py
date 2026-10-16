#!/usr/bin/env python3
"""T04 真实浏览器验收（Playwright + 系统 chromium；不进 apps/web 依赖）。

前置（全部真实进程，无 mock）：

  1. 真实 PostgreSQL + 迁移 + T01 的旧文章导入 + 首个专题：
       python -m app.modules.nav.seed --create-tables --apply --publish
  2. 真实 API（T00 登记路由前用 dev_app 临时入口）：
       uvicorn app.modules.nav.dev_app:app --port 8100
  3. 构建并启动前端（`DEV_API_URL` 必须在 **build** 时就有值）：
       DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
       API_INTERNAL_URL=http://127.0.0.1:8100 npm --prefix apps/web run start
  4. 运行：python3 apps/web/features/metanav/tools/verify-metanav.py

覆盖的验收用例：
  * 不熟悉 P5 的访客能从列表直接进入文章（验收 1）；
  * 打开应用 / 输入 / 匹配结果**不触发全屏动画**；只有明确点「进入殿堂」才发送
    `metaverse-entry`（验收 5）—— 采样 `window.__PHANTOM_DEBUG__()` 的
    `navigation.source` 与 `transition`；
  * 未找到 / 输入不合法 / 服务不可用是三种不同反馈（验收 2）；
  * 全角 + 别名匹配在真实 HTTP + 真实数据库上成立；
  * 直接 URL / 刷新 / Back 不重播过场（验收 5 / 6）；
  * 全部关联文章撤回后列表、详情都不再可读（验收 3，用 SQL 真的撤回再恢复）；
  * 320 / 390px 无横向溢出并截图（验收 6）。

**水合时序**：点击前一定先等 `window.__PHANTOM_DEBUG__` 出现（水合完成）再等业务状态，
否则点到的是原生链接、会变成整页跳转 —— 那样「通过」的其实是没有验证导航来源的用例
（T02 踩过，见 T02-result.md）。
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
DEV_DB = "pl_test_t04_dev"
PALACE_SLUG = "phantom-base"
PALACE_POSTS = ("phantom-blog-launch", "css-p5-menu", "a11y-checklist", "assets-and-credits")

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
    """打开页面 → 关掉开屏 → 等运行时探针可用（= 水合完成）。"""
    page.goto(url if url.startswith("http") else base + url, wait_until="load")
    page.wait_for_timeout(200)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    # 关掉右下角问卷浮层（它会遮挡点击）。
    if page.locator(".poll--floating").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
    if hydrated:
        page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)


def debug(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.__PHANTOM_DEBUG__()")


def transition(page: Page) -> dict[str, Any]:
    return debug(page)["transition"]


def psql(sql: str) -> None:
    completed = subprocess.run(
        [PSQL, "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", DEV_DB, "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"psql 失败：{completed.stderr.strip()}")


def set_posts_status(status: str) -> None:
    slugs = ", ".join(f"'{slug}'" for slug in PALACE_POSTS)
    psql(f"update posts set status = '{status}' where slug in ({slugs})")


def resolve_form(page: Page, name: str, location: str, cognition: str) -> None:
    page.fill("#metanav-name", name)
    page.fill("#metanav-location", location)
    page.fill("#metanav-cognition", cognition)


def submit_resolve(page: Page) -> None:
    page.click('button[type="submit"]')


def scenario_entry(page: Page, base: str) -> None:
    """验收 1 + 5：列表 → 明确进入殿堂 → 读文章。"""
    open_page(page, "/apps/metanav", base)
    page.wait_for_selector("[data-palace]", timeout=15000)
    check(
        "列表显示真实专题（标题与公开文章数来自 API）",
        "怪盗据点工程" in page.inner_text("[data-palace]")
        and "4 篇公开文章" in page.inner_text("[data-palace]"),
        page.inner_text("[data-palace]").replace("\n", " / ")[:120],
    )
    check("打开应用本身不发送任何导航请求", debug(page)["navigation"]["source"] is None)

    # 手机/独立页都从「进入殿堂」这一个动作出发；这里测独立页的真实链接。
    page.click("[data-palace] a:has-text('进入殿堂')")
    page.wait_for_timeout(120)
    state = debug(page)
    check(
        "点「进入殿堂」发送 metaverse-entry 且不使用人群",
        state["navigation"]["source"] == "metaverse-entry" and state["transition"]["crowd"] is False,
        json.dumps({"source": state["navigation"]["source"], "kind": state["navigation"]["kind"], "transition": state["transition"]}),
    )
    page.wait_for_url("**/apps/metanav/palaces/phantom-base", timeout=15000)
    check("进入后落在专题 canonical 地址", page.url.endswith("/apps/metanav/palaces/phantom-base"), page.url)

    chapters = page.locator("ol li a")
    check("专题页显示真实章节标题（不是神秘代号）", chapters.count() >= 4, f"{chapters.count()} 个链接")
    shot(page, "t04-palace-desktop")

    # 两次操作内到达文章（验收 1）。
    first = page.locator("ol li a").first
    target = first.get_attribute("href")
    first.click()
    page.wait_for_url(f"**{target}", timeout=15000)
    check("从殿堂列表两次操作内到达文章", "/posts/" in page.url, page.url)
    check("文章页确实渲染了正文", "怪盗" in page.inner_text("body") or "博客" in page.inner_text("body"))


def scenario_direct_and_back(page: Page, base: str) -> None:
    """验收 5 / 6：直接 URL、刷新、Back 都不重播过场。"""
    open_page(page, f"/apps/metanav/palaces/{PALACE_SLUG}", base)
    check("直接打开专题 URL 不播放过场", transition(page)["joker"] is False and transition(page)["wipe"] is False)
    check("直接打开专题 URL 的导航来源为空（不是 metaverse-entry）", debug(page)["navigation"]["source"] is None)

    page.reload(wait_until="load")
    page.wait_for_timeout(250)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)
    check("刷新后专题内容仍在", "怪盗据点工程" in page.inner_text("body"))

    # 从列表进入专题，然后 Back：应回到列表且不重播。
    open_page(page, "/apps/metanav", base)
    page.wait_for_selector("[data-palace]", timeout=15000)
    page.click("[data-palace] a:has-text('进入殿堂')")
    page.wait_for_url("**/palaces/phantom-base", timeout=15000)
    page.wait_for_timeout(900)
    page.go_back()
    page.wait_for_url("**/apps/metanav", timeout=15000)
    page.wait_for_timeout(200)
    state = debug(page)
    check(
        "Back 回到列表且不重播过场",
        state["transition"]["joker"] is False
        and state["transition"]["crowd"] is False
        and state["transition"]["wipe"] is False,
        json.dumps(state["transition"]),
    )


def scenario_resolve(page: Page, base: str) -> None:
    """验收 2 / 5：三种反馈 + 匹配不触发动画 + 明确进入才发送来源。"""
    open_page(page, "/apps/metanav?screen=resolve", base)
    page.wait_for_selector("#metanav-name", timeout=15000)
    check("认知定位页有三个带说明的字段", page.locator("form label").count() >= 3)

    # 输入不合法：空白字段 → 字段级错误，且不发请求。
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url))
    submit_resolve(page)
    page.wait_for_timeout(300)
    check(
        "输入不合法给出字段错误（不是「未找到」）",
        "这一项不能为空" in page.inner_text("form"),
        page.inner_text("form").replace("\n", " / ")[:100],
    )
    check("输入不合法时不发定位请求", not any("/nav/resolve" in url for url in requests), str(requests[-3:]))

    # 全角 + 别名：真实 HTTP + 真实数据库。
    resolve_form(page, "ＳＣＵＲＲＹＣＡＴ", " Blog ", "ｈｉｄｅｏｕｔ")
    submit_resolve(page)
    page.wait_for_selector('[data-result="found"]', timeout=15000)
    found_text = page.inner_text('[data-result="found"]')
    check("全角 / 大小写 / 别名混合输入匹配成功", "怪盗据点工程" in found_text, found_text.replace("\n", " / ")[:120])
    state = debug(page)
    check(
        "匹配结果出现时不播放全屏动画、不发送导航请求",
        state["navigation"]["source"] is None
        and state["transition"]["joker"] is False
        and state["transition"]["crowd"] is False,
        json.dumps({"source": state["navigation"]["source"], "transition": state["transition"]}),
    )
    shot(page, "t04-resolve-found")

    page.click('[data-result="found"] a:has-text("进入殿堂")')
    page.wait_for_timeout(120)
    state = debug(page)
    check(
        "从匹配结果明确进入时发送 metaverse-entry",
        state["navigation"]["source"] == "metaverse-entry",
        json.dumps(state["navigation"]),
    )
    page.wait_for_url("**/palaces/phantom-base", timeout=15000)

    # 未找到：200 业务结果 + 建议，不是错误。
    open_page(page, "/apps/metanav?screen=resolve", base)
    page.wait_for_selector("#metanav-name", timeout=15000)
    resolve_form(page, "不存在的人", "不存在的地点", "不存在的形态")
    submit_resolve(page)
    page.wait_for_selector('[data-result="not_found"]', timeout=15000)
    not_found = page.inner_text('[data-result="not_found"]')
    check("未找到是明确的业务反馈（并保留输入）", "没有匹配的殿堂" in not_found)
    check("未找到时保留输入", page.input_value("#metanav-name") == "不存在的人")

    # 服务不可用：用 Playwright 在上游拦截，模拟真实的网络故障。
    page.route("**/api/v1/nav/resolve", lambda route: route.abort())
    resolve_form(page, "ScurryCat", "个人博客", "据点")
    submit_resolve(page)
    page.wait_for_selector('[data-result="unavailable"]', timeout=15000)
    unavailable = page.inner_text('[data-result="unavailable"]')
    check("服务故障显示「导航暂时不可用」", "导航暂时不可用" in unavailable)
    check("服务故障与未找到是不同反馈", "没有匹配的殿堂" not in unavailable)
    page.unroute("**/api/v1/nav/resolve")


def scenario_search_mugen_footprint(page: Page, base: str) -> None:
    """搜索 / 印象空间 / 足迹（验收 1 / 6）。"""
    open_page(page, "/apps/metanav?screen=search", base)
    page.wait_for_selector("#metanav-q", timeout=15000)
    page.fill("#metanav-q", "斜切")
    page.click('button[type="submit"]')
    page.wait_for_selector("[data-results]", timeout=15000)
    check("搜索返回排名后的结果（含文章）", "斜切菜单" in page.inner_text("[data-results]"), page.inner_text("[data-results]").replace("\n", " / ")[:120])
    shot(page, "t04-search-desktop")

    # 打开一篇文章：普通站点跳转。
    page.click("[data-results] button:has-text('斜切菜单')")
    page.wait_for_timeout(120)
    state = debug(page)
    check(
        "搜索里的文章链接是普通跳转（phone-link），不是认知入口",
        state["navigation"]["source"] == "phone-link",
        json.dumps(state["navigation"]),
    )
    page.wait_for_url("**/posts/css-p5-menu", timeout=15000)

    open_page(page, "/apps/metanav?screen=mugen", base)
    page.wait_for_selector('[aria-expanded]', timeout=15000)
    page.click("button:has-text('沿这条路径深入')")
    page.wait_for_selector("[data-path]", timeout=15000)
    check("印象空间按分类读取公开文章", "CSS" in page.inner_text("[data-path]") or "篇" in page.inner_text("[data-path]"), page.inner_text("[data-path]").replace("\n", " / ")[:120])

    # 足迹：进入一次后回到列表应能看到，然后清除。
    open_page(page, "/apps/metanav", base)
    page.wait_for_selector("[data-palace]", timeout=15000)
    page.click("[data-palace] a:has-text('进入殿堂')")
    page.wait_for_url("**/palaces/phantom-base", timeout=15000)
    open_page(page, "/apps/metanav", base)
    page.wait_for_selector("[data-palace]", timeout=15000)
    check("访问过的殿堂出现在本机足迹里", "最近访问的殿堂" in page.inner_text("body") and page.locator("button:has-text('怪盗据点工程')").count() >= 1)
    page.click("button:has-text('清除足迹')")
    page.wait_for_timeout(200)
    check("足迹可以清除", "还没有访问记录" in page.inner_text("body"))


def scenario_retraction(page: Page, base: str) -> None:
    """验收 3：全部关联文章撤回后，列表与详情都不可读；恢复后重新可读。"""
    try:
        set_posts_status("draft")
        open_page(page, "/apps/metanav", base)
        page.wait_for_timeout(600)
        check(
            "关联文章全部撤回后：列表里没有这座殿堂的卡片",
            page.locator("[data-palace]").count() == 0,
            f"{page.locator('[data-palace]').count()} 张卡片",
        )
        response = page.goto(base + f"/apps/metanav/palaces/{PALACE_SLUG}", wait_until="load")
        check(
            "关联文章全部撤回后：详情返回真正的 404",
            response is not None and response.status == 404,
            f"status={response.status if response else 'none'}",
        )
    finally:
        set_posts_status("published")
    response = page.goto(base + f"/apps/metanav/palaces/{PALACE_SLUG}", wait_until="load")
    check("恢复公开后专题重新可读", response is not None and response.status == 200, f"status={response.status if response else 'none'}")


def responsive(page: Page, base: str) -> None:
    for label, viewport in (("desktop", DESKTOP), ("390", NARROW), ("320", TINY)):
        page.set_viewport_size(viewport)
        open_page(page, "/apps/metanav", base)
        page.wait_for_selector("[data-palace]", timeout=15000)
        overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{label}：导航页无横向溢出", overflow <= 1, f"overflow={overflow}px")
        shot(page, f"t04-metanav-{label}")

        open_page(page, f"/apps/metanav/palaces/{PALACE_SLUG}", base)
        overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"{label}：专题页无横向溢出", overflow <= 1, f"overflow={overflow}px")
        if label != "desktop":
            shot(page, f"t04-palace-{label}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3100")
    parser.add_argument("--skip-retraction", action="store_true", help="跳过需要写数据库的撤回用例")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        try:
            scenario_entry(page, args.base)
            scenario_direct_and_back(page, args.base)
            scenario_resolve(page, args.base)
            scenario_search_mugen_footprint(page, args.base)
            responsive(page, args.base)
            if not args.skip_retraction:
                scenario_retraction(page, args.base)
        finally:
            page.close()
            browser.close()

    failed = [item for item in results if not item["ok"]]
    print("\n=== summary ===")
    print(json.dumps({"passed": len(results) - len(failed), "failed": len(failed), "screenshots": shots}, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
