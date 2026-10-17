#!/usr/bin/env python3
"""N7 补充浏览器验收：§8.1 中主套件未覆盖的条目（真实构建 + 隔离栈）。

覆盖：
  * 生活页（勒布朗）只聚合摘要，并提供手记 / INS / 图库 / 留言 / 放课后入口，没有详情正文；
  * 关于页提供 COOP 入口且可打开；顶部导航没有第六个栏目；
  * 文章详情面包屑使用统一「情报档案」命名并链回 /posts；
  * 顶部导航普通链接保留真实 href，Ctrl+点击（修饰键）按浏览器原生行为开新标签页、本页不导航；
  * 首页「最新文章」摘要与「归档」入口真实存在；
  * 动态（INS）公开内容可读。

前置同 verify-round3.py（隔离栈 3107 / 8107 + 种子数据）。
用法：python3 apps/web/tools/browser-verification/verify-round3-supplement.py --base http://127.0.0.1:3107
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

REPO = pathlib.Path("/Users/学习/blog/Blogs")
OUT = REPO / ".dsh" / "screenshots"
REPORT = REPO / ".dsh" / "n7" / "browser-supplement-report.json"
DESKTOP = {"width": 1280, "height": 900}
results: list[dict[str, object]] = []
shots: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    results.append({"check": name, "ok": bool(condition), "detail": str(detail)[:600]})
    print(f"{'PASS' if condition else 'FAIL'} {name}{(' — ' + str(detail)[:400]) if detail != '' else ''}", flush=True)


def shot(page, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"n7-{name}.png"
    page.screenshot(path=str(path))
    shots.append(str(path))


def open_page(page, path: str, base: str) -> None:
    page.goto(path if path.startswith("http") else base + path, wait_until="load")
    page.wait_for_timeout(700)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
    page.wait_for_timeout(200)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3107")
    args = parser.parse_args()
    base = args.base

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. 生活页只聚合摘要 + 入口
        page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        open_page(page, "/apps/leblanc", base)
        links = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
        body = page.inner_text("body")
        expected_entry = ["/apps/journal", "/apps/ins", "/gallery", "/guestbook", "/apps/leisure"]
        missing = [href for href in expected_entry if not any((item or "").startswith(href) for item in links)]
        check("生活页（勒布朗）提供手记 / INS / 图库 / 留言 / 放课后入口", not missing, f"missing={missing}")
        check(
            "生活页只聚合摘要：有摘要类标题、不渲染完整正文",
            any(marker in body for marker in ("近况", "最新手记", "摘要", "INS", "图库")) and len(body) < 12000,
            f"body_len={len(body)}",
        )
        shot(page, "extra-leblanc-desktop")
        page.close()

        # 2. 关于页 COOP 入口 + 没有第六个栏目
        page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        open_page(page, "/about", base)
        coop_links = page.eval_on_selector_all("a[href*='/apps/coop']", "els => els.map(e => e.getAttribute('href'))")
        check("关于页提供清楚的 COOP / 友链入口", len(coop_links) >= 1, str(coop_links))
        nav_count = page.locator(".hud-nav a[data-k]").count()
        check("顶部没有第六个栏目（仍是 5 个）", nav_count == 5, str(nav_count))
        shot(page, "extra-about-desktop")
        page.close()

        # 3. 文章详情命名与返回索引
        page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        open_page(page, "/posts/css-p5-menu", base)
        breadcrumb = page.evaluate(
            "() => [...document.querySelectorAll('a[href=\"/posts\"]')].map(a => a.textContent || '').join('|')"
        )
        check("文章详情面包屑使用「情报档案」并链回 /posts", "情报档案" in breadcrumb, breadcrumb[:120])
        shot(page, "extra-post-detail-desktop")
        page.close()

        # 4. 普通链接保留 href；修饰键 / 中键必须交给浏览器原生行为，不拦截为本页过场
        #
        # 说明：headless Chromium shell 不会真的为 Ctrl+点击创建可访问的新标签页（middle click
        # 只得到 about:blank），因此这里断言**可观测的契约**：click 事件未被 preventDefault、
        # 本页 URL 不变、共享协调器没有发起导航 —— 即链接守卫没有拦截原生行为。
        # 「真的开了新标签页」需要带界面的浏览器，属环境限制，N7 报告如实标注。
        context = browser.new_context(viewport=DESKTOP, reduced_motion="no-preference")
        page = context.new_page()
        open_page(page, "/", base)
        page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=20000)
        page.evaluate(
            """() => {
                 window.__n7events = [];
                 for (const type of ['pointerdown', 'mousedown', 'click']) {
                   document.addEventListener(type, (event) => {
                     window.__n7events.push({
                       type, button: event.button, ctrl: event.ctrlKey || event.metaKey,
                       prevented: event.defaultPrevented, target: event.target?.tagName,
                     });
                   }, true);
                 }
               }"""
        )
        href = page.get_attribute('.hud-nav a[data-k="posts"]', "href")
        check("顶部导航普通链接保留真实 href", href == "/posts", str(href))
        page.click('.hud-nav a[data-k="posts"]', modifiers=["Control"])
        page.wait_for_timeout(500)
        ctrl_events = page.evaluate("() => window.__n7events")
        ctrl_nav = page.evaluate("() => window.__PHANTOM_DEBUG__().navigation")
        layers = page.evaluate(
            "() => ({ isekai: !!document.querySelector('.isekai')?.classList.contains('on'), joker: !!document.querySelector('.jk')?.classList.contains('on'), crowd: !!document.querySelector('.crowd')?.classList.contains('on') })"
        )
        pointer_ok = bool(ctrl_events) and all(not event["prevented"] for event in ctrl_events)
        check(
            "Ctrl+点击顶部导航：按下/点击事件未被拦截、本页不发起 SPA 导航（原生行为）",
            pointer_ok
            and ctrl_nav["navigating"] is False
            and ctrl_nav["kind"] == "none"
            and not any(layers.values())
            and page.url.endswith("/"),
            f"events={ctrl_events} nav={ctrl_nav} layers={layers} current={page.url}",
        )
        page.evaluate("() => { window.__n7events = []; }")
        page.click('.hud-nav a[data-k="map"]', button="middle")
        page.wait_for_timeout(500)
        middle_events = page.evaluate("() => window.__n7events")
        middle_nav = page.evaluate("() => window.__PHANTOM_DEBUG__().navigation")
        check(
            "中键点击顶部导航：本页不发起 SPA 导航（原生新标签行为）",
            page.url.endswith("/")
            and middle_nav["navigating"] is False
            and all(not event["prevented"] for event in middle_events),
            f"events={middle_events} nav={middle_nav} current={page.url}",
        )
        context.close()

        # 5. 首页最新文章摘要 + 归档入口
        page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        open_page(page, "/", base)
        posts_section = page.locator("#posts")
        rows = page.locator("#posts .rows > li").count() if posts_section.count() else 0
        archive_links = page.eval_on_selector_all(
            "#archive a[href]", "els => els.map(e => e.getAttribute('href'))"
        )
        check("首页最新文章是真实摘要列表", rows >= 1, f"rows={rows}")
        check(
            "首页归档入口指向 /posts?view=archive",
            any((href or "").startswith("/posts?view=archive") for href in archive_links),
            str(archive_links[:5]),
        )
        page.close()

        # 6. INS 公开动态可读（动态模块仍正常）
        page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        open_page(page, "/apps/ins", base)
        ins_body = page.inner_text("body")
        check("INS 动态页渲染公开动态内容", "N7 收录联动" in ins_body or "普通的一条动态" in ins_body, ins_body[:120].replace("\n", "|"))
        shot(page, "extra-ins-desktop")
        page.close()

        browser.close()

    failed = [item for item in results if not item["ok"]]
    payload = {
        "base": base,
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "checks": results,
        "screenshots": shots,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\n=== summary ===")
    print(json.dumps({"passed": payload["passed"], "failed": payload["failed"], "report": str(REPORT)}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
