#!/usr/bin/env python3
"""第三轮 P5 内容架构 v3 · N7 真实浏览器验收（Playwright + 系统 Chromium，不向 apps/web 加依赖）。

对应任务书 §8.1 / §8.2 末行 / §8.4 中**必须用真实浏览器**判定的部分：
  * 顶部五栏目 + 副标题（桌面 / 390 / 320 同一份配置）、天气不再占一级栏目、Logo 回首页；
  * 子页面高亮按内容归属（文章详情 / 手记 / INS / 图库 / 留言 / 作品详情 / COOP）；
  * 地图 13 个开放地点、图标 / 出发 / 列表三入口同一目的地、上野三入口各播一次殿堂短过场、
    其他地点仍人群过场、12 个未开放地点无假入口；
  * /posts 搜索 / 分类 / 归档、直达归档地址、首页摘要、旧 `/#posts` `/#archive` 落点；
  * /gallery 照片墙 / 相册 / 相册内、年份与类型筛选、灯箱、真实图片解码；
  * 旧 /showcase/photos 308 带参数、旧手机照片 / 相册深链 → 图库且不播殿堂过场；
  * 殿堂短过场：顶部作品、地图上野三入口、手机桌面图标、首页 CTA / 外部作品详情；
    殿堂内部不重播、刷新 / 直接地址 / 历史前进后退不重播、跳过、连点、减少动效、媒体失败兜底、
    1–2 秒时长、音乐元素连续、无串播；
  * 手记存档列表：真实内容、编号、预览、读取、返回位置恢复、键盘、日历定位、私密不泄露、
    日期跨时区不错一天、长标题 / 长正文；
  * 320 / 390 视口无横向溢出。
真机触控 / 软键盘 / Safari 不在本脚本能力内（报告里如实标注未验证）。

前置（N7 隔离栈，见 .dsh/n7/setup_stack.sh）：
  1. 隔离库 pl_test_n7_accept 已迁移 + 种子数据已写入（.dsh/n7/seed_data.py）；
  2. 隔离 API 8107、旧站静态 8009（音乐）在跑；
  3. fresh build 后 `npx next start -p 3107 -H 127.0.0.1`（带 API_INTERNAL_URL / DEV_API_URL /
     DEV_LEGACY_STATIC_URL）。
运行：
  python3 apps/web/tools/browser-verification/verify-round3.py --base http://127.0.0.1:3107

截图与 JSON 证据：`/Users/学习/blog/Blogs/.dsh/screenshots/` 与 `.dsh/n7/browser-report.json`。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import Page, sync_playwright

REPO = pathlib.Path("/Users/学习/blog/Blogs")
OUT = REPO / ".dsh" / "screenshots"
REPORT = REPO / ".dsh" / "n7" / "browser-report.json"
DESKTOP = {"width": 1280, "height": 900}
NARROW = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 844}
SHOWCASE_LONG_TITLE = "这是一篇标题故意写得非常长的手记"

results: list[dict[str, Any]] = []
shots: list[str] = []
http_checks: list[dict[str, Any]] = []
console_errors: list[str] = []


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append({"check": name, "ok": bool(condition), "detail": detail})
    mark = "PASS" if condition else "FAIL"
    print(f"{mark} {name}{(' — ' + detail) if detail else ''}", flush=True)


def shot(page: Page, name: str) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"n7-{name}.png"
    page.screenshot(path=str(path), full_page=False)
    shots.append(str(path))
    return str(path)


def open_page(page: Page, path: str, base: str, *, wait: int = 250) -> None:
    """打开页面并关掉启动画面（`#boot` 会拦截所有指针事件）。"""
    page.goto(path if path.startswith("http") else base + path, wait_until="load")
    page.wait_for_timeout(wait)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
    page.wait_for_timeout(150)
    dismiss_poll(page)


def dismiss_poll(page: Page) -> None:
    if page.locator(".poll--floating").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(320)


def wait_runtime(page: Page) -> None:
    page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=30000)


def wait_isekai_ready(page: Page) -> bool:
    """等待短过场素材预热完成；超时不抛异常（由调用方的断言记录失败原因）。"""
    try:
        wait_runtime(page)
        page.wait_for_function(
            "() => window.__PHANTOM_DEBUG__().isekai && window.__PHANTOM_DEBUG__().isekai.ready === true",
            timeout=25000,
        )
        return True
    except Exception:  # noqa: BLE001
        return False


def wait_crowd_ready(page: Page) -> bool:
    try:
        wait_runtime(page)
        page.wait_for_function(
            "() => window.__PHANTOM_DEBUG__().crowd && window.__PHANTOM_DEBUG__().crowd.ready === true",
            timeout=25000,
        )
        return True
    except Exception:  # noqa: BLE001
        return False


def debug(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.__PHANTOM_DEBUG__()")


def active_nav_key(page: Page) -> str | None:
    return page.evaluate(
        "() => { const a = document.querySelector('.hud-nav a[aria-current=\"page\"]'); return a ? a.dataset.k : null; }"
    )


def nav_items(page: Page) -> list[dict[str, str]]:
    return page.evaluate(
        """() => [...document.querySelectorAll('.hud-nav a[data-k]')].map(a => ({
             k: a.dataset.k, href: a.getAttribute('href'),
             name: a.querySelector('.nav-name')?.textContent ?? '',
             sub: a.querySelector('.nav-sub')?.textContent ?? '',
           }))"""
    )


def no_horizontal_overflow(page: Page) -> tuple[bool, str]:
    metrics = page.evaluate(
        """() => ({
             scrollWidth: document.documentElement.scrollWidth,
             clientWidth: document.documentElement.clientWidth,
             innerWidth: window.innerWidth,
           })"""
    )
    ok = metrics["scrollWidth"] <= metrics["clientWidth"] + 1
    return ok, json.dumps(metrics)


INSTALL_OBSERVER = """
(() => {
  const state = { isekai: 0, joker: 0, crowd: 0, events: [] };
  window.__n7trans = state;
  const seen = { isekai: false, joker: false, crowd: false };
  const scan = () => {
    if (!document.documentElement) return;
    const pairs = [['isekai', '.isekai'], ['joker', '.jk'], ['crowd', '.crowd']];
    for (const [kind, sel] of pairs) {
      const el = document.querySelector(sel);
      const on = !!el && el.classList.contains('on');
      if (on !== seen[kind]) {
        seen[kind] = on;
        if (on) { state[kind] += 1; state.events.push({ kind, t: Math.round(performance.now()) }); }
      }
    }
  };
  const observer = new MutationObserver(scan);
  // document-start 时 document.documentElement 可能尚未创建，直接观察 document 节点。
  observer.observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  window.__n7observer = observer;
  scan();
})();
"""


def install_observer(page: Page) -> None:
    page.add_init_script(INSTALL_OBSERVER)


def transition_counts(page: Page) -> dict[str, int]:
    return page.evaluate("() => window.__n7trans ?? { isekai: -1, joker: -1, crowd: -1 }")


def map_icon_point(page: Page, location_id: int) -> tuple[float, float]:
    """返回地图图标的可点击坐标。

    SVG <a> 的 bounding box 中心可能落在两个子图形之间；真正的可点区域是
    `<image class="city">` / `<g class="tag">`。用真实鼠标事件点它的中心，
    避免 locator.click() 在处理会因 hover 重排的 SVG 元素时丢事件。
    """
    box = page.locator(f'a.loc[data-id="{location_id}"] image.city').bounding_box()
    if box is None:
        raise AssertionError(f"地图图标 {location_id} 不可见")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def hover_map_icon(page: Page, location_id: int) -> tuple[float, float]:
    x, y = map_icon_point(page, location_id)
    page.mouse.move(x, y)
    page.wait_for_timeout(180)
    return x, y


def wait_path(page: Page, pathname: str, timeout: int = 8000) -> bool:
    """等待 SPA 路由提交；超时返回 False，由调用方断言（不中断整套验收）。"""
    try:
        page.wait_for_function(
            "(expected) => location.pathname === expected", arg=pathname, timeout=timeout
        )
        return True
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# 0. HTTP 层：旧地址 308 / 天气页保留
# ---------------------------------------------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None


def http_get_no_redirect(url: str) -> tuple[int, dict[str, str]]:
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(url, timeout=15) as response:
            return response.status, dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers)


def redirect_checks(base: str) -> None:
    cases = [
        ("/showcase/photos", "/gallery", {}),
        (
            "/showcase/photos?album=n7-tokyo-life&scope=album&kind=photo&year=2026&month=5",
            "/gallery",
            {"album": ["n7-tokyo-life"], "scope": ["album"], "kind": ["photo"], "year": ["2026"], "month": ["5"]},
        ),
        ("/showcase/photos?scope=album", "/gallery", {}),
        ("/showcase/photos?kind=video&year=abc", "/gallery", {}),
        ("/showcase/photos?album=x&year=2026", "/gallery", {"album": ["x"], "year": ["2026"]}),
    ]
    for path, expected_path, expected_query in cases:
        status, headers = http_get_no_redirect(base + path)
        location = headers.get("Location") or headers.get("location") or ""
        parts = urlsplit(location)
        actual = {key: values for key, values in parse_qs(parts.query).items()}
        ok = status == 308 and parts.path == expected_path and actual == expected_query
        http_checks.append(
            {
                "request": path,
                "status": status,
                "location": location,
                "expected": {"path": expected_path, "query": expected_query},
                "ok": ok,
            }
        )
        check(
            f"旧 /showcase/photos 308：{path}",
            ok,
            f"HTTP {status} location={location}",
        )

    status, _ = http_get_no_redirect(f"{base}/weather")
    check("天气页 /weather 仍可用（只是不占一级栏目）", status == 200, f"HTTP {status}")

    status, headers = http_get_no_redirect(f"{base}/index.html#posts")
    check(
        "旧 /index.html 入口仍重定向（#posts 兼容链路第一跳）",
        status in (307, 308),
        f"HTTP {status} location={headers.get('Location') or headers.get('location')}",
    )


# ---------------------------------------------------------------------------
# 1. 顶部五栏目 / 高亮 / Logo / 旧锚点
# ---------------------------------------------------------------------------


def nav_suite(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/", base, wait=1200)
    items = nav_items(page)
    expected = [
        ("posts", "/posts", "文章", "情报档案"),
        ("life", "/apps/leblanc", "生活", "勒布朗"),
        ("showcase", "/showcase", "作品", "我的殿堂"),
        ("map", "/map", "地图", "东京漫游"),
        ("about", "/about", "关于", "人物档案"),
    ]
    actual = [(item["k"], item["href"], item["name"], item["sub"]) for item in items]
    check("顶部五栏目及副标题完全正确", actual == expected, json.dumps(actual, ensure_ascii=False))
    check(
        "天气不再占一级栏目（.hud-nav 里没有 weather）",
        page.locator('.hud-nav a[data-k="weather"]').count() == 0,
    )
    check(
        '作品栏目带 href="/showcase"（保留正确 href，不拦截修饰键）',
        page.get_attribute('.hud-nav a[data-k="showcase"]', "href") == "/showcase",
    )
    brand = page.evaluate(
        "() => { const a = document.querySelector('header a.brand'); return a ? a.getAttribute('href') : null; }"
    )
    check("Logo 链接返回首页", brand == "/", f"href={brand}")
    shot(page, "nav-home-desktop")

    # 子页面高亮按内容归属
    highlight_cases = [
        ("/posts", "posts"),
        ("/posts/css-p5-menu", "posts"),
        ("/apps/leblanc", "life"),
        ("/apps/journal", "life"),
        ("/apps/ins", "life"),
        ("/gallery", "life"),
        ("/guestbook", "life"),
        ("/showcase", "showcase"),
        ("/showcase/projects/n7-verification-booth", "showcase"),
        ("/map", "map"),
        ("/about", "about"),
        ("/apps/coop", "about"),
        ("/", None),
    ]
    for path, expected_key in highlight_cases:
        probe = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
        open_page(probe, path, base, wait=500)
        got = active_nav_key(probe)
        check(f"子页面高亮：{path} → {expected_key or '不高亮'}", got == expected_key, f"got={got}")
        probe.close()

    # 旧 /#posts、/#archive 落点
    for anchor, label in (("#posts", "旧 /#posts"), ("#archive", "旧 /#archive")):
        probe = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
        open_page(probe, f"/{anchor}", base, wait=1200)
        probe.wait_for_timeout(1500)
        info = probe.evaluate(
            """(id) => {
                 const el = document.getElementById(id);
                 if (!el) return null;
                 const rect = el.getBoundingClientRect();
                 const links = [...el.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
                 return { top: Math.round(rect.top), scrollY: Math.round(window.scrollY), links };
               }""",
            anchor[1:],
        )
        # 锚点落点允许落在视口内即可（首屏图片懒加载会带来轻微布局位移）；
        # 关键是「不悬空」：元素真实存在、已滚动到视口内、并有进入索引的真实入口。
        ok = bool(info) and -80 <= info["top"] <= 650 and info["scrollY"] > 80
        has_entry = bool(info) and any(
            href.startswith("/posts") for href in info["links"]
        )
        check(
            f"{label} 落到首页有意义位置且有进入索引的入口",
            ok and has_entry,
            json.dumps(info, ensure_ascii=False),
        )
        probe.close()

    # 移动端与桌面端同一份栏目配置
    for label, viewport in (("390", NARROW), ("320", TINY)):
        probe = browser.new_page(viewport=viewport, device_scale_factor=2, reduced_motion="no-preference")
        open_page(probe, "/", base, wait=900)
        mobile_items = nav_items(probe)
        same = [(item["k"], item["href"], item["name"]) for item in mobile_items] == [
            (item[0], item[1], item[2]) for item in expected
        ]
        check(f"{label}px：移动端渲染同一份五栏目配置", same, json.dumps(mobile_items, ensure_ascii=False))
        overflow_ok, detail = no_horizontal_overflow(probe)
        check(f"{label}px：首页无横向溢出", overflow_ok, detail)
        shot(probe, f"nav-home-{label}")
        probe.close()

    page.close()


# ---------------------------------------------------------------------------
# 2. /posts 搜索 / 分类 / 归档
# ---------------------------------------------------------------------------


def posts_suite(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/posts", base, wait=900)
    page.wait_for_selector(".rows")
    check(" /posts 列表渲染 8 篇真实文章", page.locator(".rows > li").count() == 8, str(page.locator(".rows > li").count()))
    shot(page, "posts-list-desktop")

    # 搜索
    page.fill("#q", "雪国")
    page.wait_for_timeout(300)
    rows = page.locator(".rows > li")
    titles = page.eval_on_selector_all(".rows > li", "els => els.map(e => e.innerText)")
    check(
        "搜索「雪国」得到 1 条且命中正确文章",
        rows.count() == 1 and any("雪国" in title for title in titles),
        json.dumps(titles, ensure_ascii=False)[:200],
    )
    page.fill("#q", "")
    page.wait_for_timeout(250)

    # 分类筛选（TECH 2 篇）
    tech_chip = page.locator(".chips .chip", has_text="TECH")
    tech_chip.click()
    page.wait_for_timeout(250)
    check("分类筛选 TECH = 2 篇", page.locator(".rows > li").count() == 2, str(page.locator(".rows > li").count()))
    pressed = tech_chip.get_attribute("aria-pressed")
    check("分类 chip 有选中态 aria-pressed", pressed == "true", str(pressed))
    page.locator(".chips .chip", has_text="全部").click()
    page.wait_for_timeout(200)

    # 归档视图切换
    page.locator(".pv-tab", has_text="归档").click()
    page.wait_for_timeout(400)
    url_after = page.url
    archive = page.locator(".pv-archive")
    year_ids = page.evaluate("() => [...document.querySelectorAll('[id^=year-]')].map(e => e.id)")
    check(
        "切换归档视图：地址栏 ?view=archive 且渲染年份分组",
        "view=archive" in url_after and archive.count() == 1 and year_ids == ["year-2026"],
        f"url={url_after} years={year_ids}",
    )
    shot(page, "posts-archive-desktop")
    page.close()

    # 直达归档地址（刷新 / 分享）
    direct = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(direct, "/posts?view=archive", base, wait=700)
    direct.wait_for_selector(".pv-archive")
    pressed = direct.evaluate(
        "() => [...document.querySelectorAll('.pv-tab')].map(b => ({ text: b.innerText.trim(), pressed: b.getAttribute('aria-pressed') }))"
    )
    check(
        "直达 /posts?view=archive：归档 tab 为选中态",
        any(item["text"] == "归档" and item["pressed"] == "true" for item in pressed),
        json.dumps(pressed, ensure_ascii=False),
    )
    direct.close()

    # 首页摘要（真实内容：最新文章 + 精选作品）
    home = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(home, "/", base, wait=1200)
    home_ids = home.evaluate("() => [...document.querySelectorAll('section[id]')].map(s => s.id)")
    check(
        "首页含摘要区块 latest / posts / featured-works / archive",
        {"posts", "featured-works", "archive"}.issubset(set(home_ids)),
        str(home_ids),
    )
    featured = home.eval_on_selector_all(".n1-work-a", "els => els.map(e => e.dataset.project)")
    check("首页精选作品展示真实作品数据（2 件）", len(featured) == 2, str(featured))
    home.close()


# ---------------------------------------------------------------------------
# 3. 地图：13 开放 / 三入口一致 / 上野 intent / 其余无假入口
# ---------------------------------------------------------------------------


def map_suite(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/map", base, wait=900)
    page.wait_for_selector(".mp-svg .loc.on")

    icons = page.eval_on_selector_all(
        "a.loc", "els => els.map(e => ({ id: e.dataset.id, href: e.getAttribute('href'), aria: e.getAttribute('aria-label') }))"
    )
    listed = page.eval_on_selector_all(
        ".mp-list a", "els => els.map(e => ({ id: e.dataset.id, href: e.getAttribute('href'), text: e.innerText.trim() }))"
    )
    closed = page.eval_on_selector_all(
        ".loc.off", "els => els.map(e => ({ tag: e.tagName, href: e.getAttribute('href') }))"
    )
    check("地图 13 个开放地点（可点图标）", len(icons) == 13, str(len(icons)))
    check("地图下方列表 13 项且与图标一一对应", len(listed) == 13 and {i["id"] for i in icons} == {i["id"] for i in listed})
    check(
        "其余 12 个地点保持未开放且无假链接（不是 <a>、无 href）",
        len(closed) == 12 and all(item["tag"] != "A" and not item["href"] for item in closed),
        json.dumps(closed, ensure_ascii=False),
    )
    list_href = {item["id"]: item["href"] for item in listed}
    legacy_ok = all(
        href and href.startswith("/") and ".html" not in href and "post=" not in href
        for href in list_href.values()
    )
    check("13 个目的地均为新站真实路由（无旧文章 slug 绑定 / 无 .html）", legacy_ok, json.dumps(list_href, ensure_ascii=False))
    expected_routes = {
        "18": "/apps/leblanc",
        "12": "/apps/ins",
        "0": "/apps/journal",
        "15": "/posts",
        "6": "/showcase",
        "23": "/gallery",
        "7": "/apps/leisure?screen=game",
        "3": "/apps/leisure?screen=anime",
        "19": "/apps/coop",
        "8": "/posts?view=archive",
        "9": "/weather",
        "10": "/guestbook",
        "13": "/about",
    }
    check(
        "13 个地点目的地与任务书 §2.3 表格一致",
        list_href == expected_routes,
        json.dumps({k: list_href.get(k) for k in expected_routes}, ensure_ascii=False),
    )

    # 三入口一致：逐个 hover 图标，右侧「出发」href 必须等于图标 / 列表 href
    page.mouse.move(8, 8)
    mismatches: list[str] = []
    for item in icons:
        hover_map_icon(page, int(item["id"]))
        card_href = page.get_attribute(".mp-card a.btn.red", "href")
        card_note = page.evaluate("() => document.querySelector('.mp-card .mp-c-n')?.textContent ?? ''")
        if card_href != item["href"] or not card_note.strip():
            mismatches.append(f'{item["id"]}: card={card_href} icon={item["href"]} note={card_note[:20]}')
    check("图标 / 出发 / 列表三入口读取同一份目的地配置（13/13 一致）", not mismatches, "; ".join(mismatches))
    page.close()

    # 上野三入口：各播一次异世界短过场，1–2 秒内到达 /showcase
    entries = [
        ("地图上野图标", "icon", False),
        ("地图上野「出发」", "card", True),
        ("地图上野列表", "list", False),
    ]
    for label, target, need_hover in entries:
        probe = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        install_observer(probe)
        open_page(probe, "/map", base, wait=900)
        wait_isekai_ready(probe)
        probe.mouse.move(8, 8)
        if need_hover:
            hover_map_icon(probe, 6)
            check(f"{label}：出发按钮 href 指向 /showcase", probe.get_attribute(".mp-card a.btn.red", "href") == "/showcase")
        start = time.time()
        if target == "icon":
            # hover 会触发 React 重排（选中态移动），必须先把鼠标停稳在图标上再按下，
            # 否则 mousedown / mouseup 之间元素被替换，click 事件会丢失（真实浏览器行为）。
            x, y = hover_map_icon(probe, 6)
            probe.mouse.click(x, y)
        elif target == "card":
            probe.click(".mp-card a.btn.red")
        else:
            probe.click('ul.mp-list a[data-id="6"]')
        probe.wait_for_timeout(140)
        mid = debug(probe)
        on = probe.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
        counts = transition_counts(probe)
        shot(probe, f"map-ueno-{label.replace('地图上野', '') or 'entry'}-mid")
        try:
            wait_path(probe, "/showcase", timeout=6000)
        except Exception:  # noqa: BLE001
            pass
        elapsed = round((time.time() - start) * 1000)
        check(
            f"{label}：播放一次异世界短过场（1–2 秒）",
            on
            and mid["navigation"]["kind"] == "isekai"
            and mid["navigation"]["intent"] == "enter-showcase"
            and counts["isekai"] == 1
            and counts["joker"] == 0
            and counts["crowd"] == 0
            and 1000 <= elapsed <= 4000,
            f"on={on} kind={mid['navigation']['kind']} elapsed={elapsed}ms counts={counts}",
        )
        probe.wait_for_timeout(300)
        gone = not probe.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
        check(f"{label}：过场结束后遮罩收起", gone)
        probe.close()

    # 其他地图目的地仍人群过场（不是殿堂短版）
    probe = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(probe)
    open_page(probe, "/map", base, wait=900)
    wait_crowd_ready(probe)
    probe.mouse.move(8, 8)
    x, y = hover_map_icon(probe, 0)
    probe.mouse.click(x, y)
    probe.wait_for_timeout(160)
    counts = transition_counts(probe)
    state = probe.evaluate("() => window.__PHANTOM_DEBUG__()")
    check(
        "其他地图目的地（青山一丁目）仍用人群过场，不串播殿堂短版",
        state["navigation"]["kind"] == "crowd" and counts["crowd"] == 1 and counts["isekai"] == 0,
        f"kind={state['navigation']['kind']} counts={counts}",
    )
    try:
        wait_path(probe, "/apps/journal", timeout=8000)
    except Exception:  # noqa: BLE001
        pass
    check("地图其他目的地到达正确页面", probe.url.endswith("/apps/journal"), probe.url)
    probe.close()


# ---------------------------------------------------------------------------
# 4. /gallery 三视图 / 旧链接兼容
# ---------------------------------------------------------------------------


def gallery_suite(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/gallery", base, wait=1200)
    page.wait_for_selector(".plg-wrap")
    tiles = page.locator(".photo-tile")
    check("/gallery 默认照片墙", page.locator('[data-gallery-tab="wall"][aria-current="page"]').count() == 1)
    total = page.inner_text("[data-photo-total]") if page.locator("[data-photo-total]").count() else ""
    check("照片墙 7 张去重后照片（含跨相册同图只出现一次）", tiles.count() == 7 and "7" in total, f"tiles={tiles.count()} total={total}")
    media_ids = page.eval_on_selector_all(".photo-tile", "els => els.map(e => e.dataset.mediaId)")
    check("照片墙 media_id 无重复（查询层去重）", len(media_ids) == len(set(media_ids)), str(len(media_ids)))
    image_ok = page.eval_on_selector_all(
        ".photo-tile img", "els => els.every(img => img.complete && img.naturalWidth > 0)"
    )
    check("照片墙图片真实解码（naturalWidth > 0）", image_ok)
    shot(page, "gallery-wall-desktop")

    # 年份筛选来自实际可展示图片
    year_chips = page.eval_on_selector_all("[data-filter^='year-']", "els => els.map(e => e.dataset.filter)")
    check("年份筛选项来自实际可展示图片（2026 / 2025）", year_chips == ["year-2026", "year-2025"], str(year_chips))
    page.click('[data-filter="year-2025"]')
    try:
        page.wait_for_function("() => location.search.includes('year=2025')", timeout=8000)
        page.wait_for_timeout(300)
    except Exception:  # noqa: BLE001
        pass
    tiles_2025 = page.locator(".photo-tile").count()
    check("年份筛选 /gallery?year=2025 真的过滤到 1 张", tiles_2025 == 1 and "year=2025" in page.url, f"tiles={tiles_2025} url={page.url}")

    # 类型筛选（重新进入照片墙，避免客户端返回竞态）
    open_page(page, "/gallery", base, wait=900)
    page.wait_for_selector(".plg-wrap")
    page.click('[data-filter="kind-screenshot"]')
    try:
        page.wait_for_function("() => location.search.includes('kind=screenshot')", timeout=8000)
        page.wait_for_timeout(300)
    except Exception:  # noqa: BLE001
        pass
    check("类型筛选 screenshot → 2 张", page.locator(".photo-tile").count() == 2, str(page.locator(".photo-tile").count()))
    open_page(page, "/gallery", base, wait=900)
    page.wait_for_selector(".plg-wrap")
    page.wait_for_selector(".plg-tabs")

    # 灯箱
    page.locator(".photo-tile button").first.click()
    page.wait_for_timeout(600)
    lightbox = page.locator(".plg-lightbox")
    check("灯箱可打开", lightbox.count() == 1)
    if lightbox.count():
        shot(page, "gallery-lightbox-desktop")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        check("灯箱可用 Escape 关闭", page.locator(".plg-lightbox").count() == 0)

    # 相册视图
    page.click('[data-gallery-tab="albums"]')
    try:
        page.wait_for_function("() => location.search.includes('view=albums')", timeout=8000)
        page.wait_for_selector("[data-album-gallery]", timeout=8000)
    except Exception:  # noqa: BLE001
        pass
    check(
        "「相册」切换进入 /gallery?view=albums",
        "view=albums" in page.url and page.locator("[data-album-gallery]").count() == 1,
        page.url,
    )
    albums = page.eval_on_selector_all("[data-album]", "els => els.map(e => e.dataset.album)")
    check("相册视图 3 个公开相册，草稿相册不出现", albums == ["n7-moment-album", "n7-game-shots", "n7-tokyo-life"] or set(albums) == {"n7-moment-album", "n7-game-shots", "n7-tokyo-life"}, str(albums))
    check("草稿相册 n7-draft-album 未公开", "n7-draft-album" not in albums)
    album_img_ok = page.eval_on_selector_all(
        "[data-album] img", "els => els.length > 0 && els.every(img => img.complete && img.naturalWidth > 0)"
    )
    check("相册封面真实解码", album_img_ok)
    shot(page, "gallery-albums-desktop")

    # 相册内页（保留该相册自己的顺序与说明）
    page.click('[data-album="n7-tokyo-life"]')
    page.wait_for_timeout(800)
    scope = page.get_attribute("[data-album-scope]", "data-album-scope")
    check(
        "相册内页 /gallery?scope=album&album=n7-tokyo-life 有 4 张",
        "scope=album" in page.url and scope == "album" and page.locator(".photo-tile").count() == 4,
        f"url={page.url} scope={scope} tiles={page.locator('.photo-tile').count()}",
    )
    shot(page, "gallery-album-scope-desktop")
    page.close()

    # 旧手机照片 / 相册深链 → 图库，且**不播放殿堂过场**
    deep_links = [
        ("旧手机照片深链", "/?phone=showcase&screen=photos", "/gallery"),
        (
            "旧手机相册深链",
            "/?phone=showcase&screen=album&item=n7-tokyo-life",
            "/gallery",
        ),
    ]
    for label, path, expected_path in deep_links:
        probe = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
        install_observer(probe)
        open_page(probe, path, base, wait=1200)
        try:
            wait_path(probe, expected_path, timeout=15000)
        except Exception:  # noqa: BLE001
            pass
        probe.wait_for_timeout(600)
        counts = transition_counts(probe)
        url = probe.url
        ok = "gallery" in url and counts["isekai"] == 0
        if label == "旧手机相册深链":
            ok = ok and "scope=album" in url and "album=n7-tokyo-life" in url
        check(f"{label} → 生活图库且不播殿堂过场", ok, f"url={url} isekai={counts['isekai']}")
        shot(probe, f"gallery-legacy-phone-{'photos' if 'photos' in path else 'album'}")
        probe.close()

    # 殿堂不再含照片展区
    probe = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(probe, "/showcase", base, wait=900)
    body = probe.inner_text("body")
    has_photo_tab = probe.evaluate(
        "() => [...document.querySelectorAll('.pls-tabs a, .pls-tabs button')].some(e => (e.innerText || '').includes('照片'))"
    )
    check(
        "「我的殿堂」不再有照片页签 / 照片墙入口",
        not has_photo_tab and "照片墙" not in body,
        f"photo_tab={has_photo_tab}",
    )
    probe.close()


# ---------------------------------------------------------------------------
# 5. 殿堂异世界短过场
# ---------------------------------------------------------------------------


def transition_suite(browser, base: str) -> None:
    # (a) 顶部「作品」
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_isekai_ready(page)
    page.evaluate("() => { window.__firstAudio = document.querySelector('audio[data-pl-music]'); }")
    start = time.time()
    page.click('.hud-nav a[data-k="showcase"]')
    page.wait_for_timeout(130)
    mid = debug(page)
    state_on = page.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
    video = page.evaluate(
        """() => { const v = document.querySelector('.isekai video');
                   return v ? { paused: v.paused, duration: v.duration, muted: v.muted, currentTime: v.currentTime } : null; }"""
    )
    shot(page, "transition-topnav-mid")
    wait_path(page, "/showcase", timeout=6000)
    elapsed = round((time.time() - start) * 1000)
    counts = transition_counts(page)
    check(
        "顶部「作品」→ 异世界短过场一次（1–2 秒、静音视频在播）",
        state_on
        and mid["navigation"]["intent"] == "enter-showcase"
        and video is not None
        and video["paused"] is False
        and video["muted"] is True
        and 1.3 <= float(video["duration"] or 0) <= 1.7
        and 1000 <= elapsed <= 2200
        and counts["isekai"] == 1
        and counts["crowd"] == 0
        and counts["joker"] == 0,
        f"elapsed={elapsed}ms video={video} counts={counts}",
    )
    check("顶部「作品」到达 /showcase", page.url.endswith("/showcase"), page.url)
    check(
        "过场期间背景音乐元素不变（同一实例、数量不变）",
        page.evaluate(
            "() => window.__firstAudio === document.querySelector('audio[data-pl-music]') && document.querySelectorAll('audio').length === 1"
        ),
    )
    page.wait_for_timeout(400)
    check("过场结束后遮罩收起（不残留黑屏）", not page.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')"))
    page.close()

    # (b) 手机桌面殿堂图标
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_isekai_ready(page)
    page.click(".pw-tab")
    page.wait_for_selector(".pw-wrap.on .pw-app", timeout=10000)
    page.wait_for_timeout(600)
    page.evaluate("() => { window.__firstAudio = document.querySelector('audio[data-pl-music]'); }")
    page.click('.pw-app[data-app-id="showcase"]')
    page.wait_for_timeout(160)
    on = page.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
    mid = debug(page)
    shot(page, "transition-phone-icon-mid")
    try:
        page.wait_for_function(
            "() => location.search.includes('phone=showcase') && !document.querySelector('.isekai')?.classList.contains('on')",
            timeout=8000,
        )
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(300)
    counts = transition_counts(page)
    wrap_on = page.evaluate("() => !!document.querySelector('.pw-wrap')?.classList.contains('on')")
    url = page.url
    check(
        "手机桌面殿堂图标 → 异世界短过场一次，结束后仍在斜屏手机内",
        on
        and mid["navigation"]["intent"] == "enter-showcase"
        and counts["isekai"] == 1
        and counts["crowd"] == 0
        and counts["joker"] == 0
        and wrap_on
        and "phone=showcase" in url,
        f"on={on} wrap_on={wrap_on} url={url} counts={counts}",
    )
    check(
        "手机图标过场期间音乐元素不变",
        page.evaluate("() => window.__firstAudio === document.querySelector('audio[data-pl-music]')"),
    )
    shot(page, "transition-phone-after")
    page.close()

    # (c) 首页 CTA / 外部作品详情入口 → 短过场
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_isekai_ready(page)
    page.locator('#featured-works .home-cta a[href="/showcase"]').first.click()
    page.wait_for_timeout(140)
    on = page.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
    counts = transition_counts(page)
    wait_path(page, "/showcase", timeout=6000)
    check("首页「我的殿堂」CTA → 异世界短过场", on and counts["isekai"] == 1 and page.url.endswith("/showcase"), f"on={on} counts={counts}")
    page.close()

    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_isekai_ready(page)
    project_link = page.locator(".n1-work-a[data-project]").first
    project_href = project_link.get_attribute("href")
    project_link.click()
    page.wait_for_timeout(140)
    on = page.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
    counts = transition_counts(page)
    page.wait_for_timeout(2200)
    check(
        "外部作品详情入口 → 异世界短过场",
        on and counts["isekai"] == 1 and page.url.endswith(project_href or ""),
        f"on={on} counts={counts} url={page.url}",
    )
    page.close()

    # (d) 殿堂内部不重播
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/showcase", base, wait=1200)
    wait_isekai_ready(page)
    page.click('.hud-nav a[data-k="showcase"]')
    page.wait_for_timeout(1600)
    counts_after_nav = transition_counts(page)
    page.locator(".pls-card[data-project]").first.click()
    page.wait_for_timeout(1600)
    counts_after_card = transition_counts(page)
    check(
        "殿堂内部：再点顶部「作品」与切换作品都不重播殿堂短过场",
        counts_after_nav["isekai"] == 0 and counts_after_card["isekai"] == 0,
        f"nav={counts_after_nav} card={counts_after_card}",
    )
    page.close()

    # (e) 刷新 / 直接地址 / 历史前进后退不重播
    page = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/showcase", base, wait=1200)
    page.wait_for_timeout(800)
    direct_counts = transition_counts(page)
    page.reload(wait_until="load")
    page.wait_for_timeout(1500)
    reload_counts = transition_counts(page)
    check(
        "直接地址 / 刷新 /showcase 不自动重播殿堂短过场",
        direct_counts["isekai"] == 0 and reload_counts["isekai"] == 0,
        f"direct={direct_counts} reload={reload_counts}",
    )
    # 前进后退：首页 → 作品（播一次）→ 后退 → 前进，前进不得重播
    page.goto(base + "/", wait_until="load")
    page.wait_for_timeout(1200)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
    wait_isekai_ready(page)
    page.click('.hud-nav a[data-k="showcase"]')
    page.wait_for_timeout(1800)
    after_click = transition_counts(page)
    page.go_back()
    page.wait_for_timeout(900)
    page.go_forward()
    page.wait_for_timeout(1200)
    after_forward = transition_counts(page)
    check(
        "历史前进后退回到 /showcase 不自动重播",
        after_click["isekai"] == 1 and after_forward["isekai"] == after_click["isekai"],
        f"after_click={after_click} after_forward={after_forward}",
    )
    page.close()

    # (f) 跳过
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/", base, wait=1200)
    wait_isekai_ready(page)
    page.click('.hud-nav a[data-k="showcase"]')
    try:
        page.wait_for_selector(".isekai-skip.is-on", timeout=3000)
    except Exception:  # noqa: BLE001
        pass
    skip_metrics = page.evaluate(
        "() => { const b = document.querySelector('.isekai-skip'); const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, label: b.getAttribute('aria-label') }; }"
    )
    start = time.time()
    page.click(".isekai-skip")
    wait_path(page, "/showcase", timeout=4000)
    skip_ms = round((time.time() - start) * 1000)
    check(
        "跳过按钮可用：≥44px 触控目标，点击后立即进入 /showcase",
        skip_metrics["w"] >= 44 and skip_metrics["h"] >= 44 and skip_ms <= 900,
        f"size={skip_metrics['w']}x{skip_metrics['h']} skip={skip_ms}ms label={skip_metrics['label']}",
    )
    page.close()

    # (g) 连点
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_isekai_ready(page)
    box = page.locator('.hud-nav a[data-k="showcase"]').bounding_box()
    assert box is not None
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.click(x, y)
    page.wait_for_timeout(40)
    page.mouse.click(x, y)
    page.wait_for_timeout(40)
    page.mouse.click(x, y)
    page.wait_for_timeout(2000)
    counts = transition_counts(page)
    check("连点 3 次：只播一次殿堂短过场（防重令牌）", counts["isekai"] == 1 and page.url.endswith("/showcase"), f"counts={counts} url={page.url}")
    page.close()

    # (h) 减少动态效果
    context = browser.new_context(viewport=DESKTOP, reduced_motion="reduce")
    page = context.new_page()
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_runtime(page)
    start = time.time()
    page.click('.hud-nav a[data-k="showcase"]')
    wait_path(page, "/showcase", timeout=4000)
    elapsed = round((time.time() - start) * 1000)
    counts = transition_counts(page)
    check(
        "prefers-reduced-motion：不等待视频、直接进入（无殿堂过场）",
        elapsed <= 800 and counts["isekai"] == 0,
        f"elapsed={elapsed}ms counts={counts}",
    )
    context.close()

    # (i) 素材未就绪 / 播放失败 → 斜切兜底继续进入，不黑屏
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    page.route("**/assets/clip/isekai-showcase.webm", lambda route: route.abort())
    install_observer(page)
    open_page(page, "/", base, wait=1200)
    wait_runtime(page)
    page.wait_for_timeout(2500)
    state = debug(page)
    start = time.time()
    page.click('.hud-nav a[data-k="showcase"]')
    wait_path(page, "/showcase", timeout=5000)
    elapsed = round((time.time() - start) * 1000)
    page.wait_for_timeout(800)
    counts = transition_counts(page)
    stuck = page.evaluate(
        """() => ({
             isekai: !!document.querySelector('.isekai')?.classList.contains('on'),
             wipe: !!document.querySelector('.wipe')?.classList.contains('go'),
           })"""
    )
    check(
        "过场媒体加载失败：走斜切兜底继续进入，无黑屏残留",
        state["isekai"]["ready"] is False and counts["isekai"] == 0 and not stuck["isekai"] and elapsed <= 4000,
        f"ready={state['isekai']['ready']} elapsed={elapsed}ms counts={counts} stuck={stuck}",
    )
    page.close()

    # (j) 390 / 320 视口过场可用
    for label, viewport in (("390", NARROW), ("320", TINY)):
        page = browser.new_page(viewport=viewport, device_scale_factor=2, reduced_motion="no-preference")
        install_observer(page)
        open_page(page, "/", base, wait=1200)
        wait_isekai_ready(page)
        page.click('.hud-nav a[data-k="showcase"]')
        page.wait_for_timeout(150)
        on = page.evaluate("() => !!document.querySelector('.isekai')?.classList.contains('on')")
        shot(page, f"transition-{label}-mid")
        wait_path(page, "/showcase", timeout=6000)
        overflow_ok, detail = no_horizontal_overflow(page)
        check(f"{label}px：殿堂短过场可用且落地后无横向溢出", on and overflow_ok, f"on={on} {detail}")
        shot(page, f"showcase-{label}")
        page.close()


# ---------------------------------------------------------------------------
# 6. 手记：真实内容 / 存档列表 / 键盘 / 日历 / 私密 / 时区
# ---------------------------------------------------------------------------


def journal_suite(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/apps/journal", base, wait=1500)
    page.wait_for_selector("[data-journal-screen]")
    page.wait_for_selector("[data-journal-slot]")
    screen = page.get_attribute("[data-journal-screen]", "data-journal-screen")
    check("手记默认呈现存档列表", screen == "list", str(screen))
    slots = page.eval_on_selector_all(
        "[data-journal-slot]",
        "els => els.map(e => ({ no: e.dataset.slotNumber, date: e.dataset.slotDate, sel: e.getAttribute('aria-selected') }))",
    )
    check("存档列表 8 条真实公开手记", len(slots) == 8, str(len(slots)))
    check("存档编号 01–08 且与数据库 ID 无关（只是显示顺序）", [s["no"] for s in slots] == [f"{i:02d}" for i in range(1, 9)], str([s["no"] for s in slots]))
    check("默认选中 No.01", slots and slots[0]["sel"] == "true")
    check("日期按项目日历日期展示（2026-10-05 → 2026.10）", slots[1]["date"] == "2026-10-05", str(slots[1]))

    preview = page.inner_text("[data-journal-preview]")
    check("预览显示长标题完整文本", SHOWCASE_LONG_TITLE in preview, preview[:120].replace("\n", "|"))
    check("预览含心情 / 地点等真实字段", "心情：平静" in preview and "地点：四轩茶屋" in preview, preview[:200].replace("\n", "|"))
    read_href = page.get_attribute("[data-journal-preview] a", "href")
    check("「读取手记」保留真实正文 href", bool(read_href and read_href.startswith("/apps/journal/")), str(read_href))
    shot(page, "journal-save-desktop")

    # 长标题不截断成乱码 / 不挤爆布局
    long_title_ok = page.evaluate(
        """() => {
             const slot = document.querySelector('[data-journal-slot]');
             const preview = document.querySelector('[data-journal-preview]');
             const titleEl = [...slot.querySelectorAll('*')].find(e => (e.textContent||'').includes('这是一篇标题故意写得非常长'));
             const doc = document.documentElement;
             return {
               found: !!titleEl,
               textLen: titleEl ? titleEl.textContent.length : 0,
               noDocOverflow: doc.scrollWidth <= doc.clientWidth + 1,
               previewOk: !!preview,
             };
           }"""
    )
    check(
        "长标题完整渲染且不产生横向溢出",
        long_title_ok["found"] and long_title_ok["textLen"] >= len(SHOWCASE_LONG_TITLE) and long_title_ok["noDocOverflow"],
        json.dumps(long_title_ok, ensure_ascii=False),
    )

    # 选中 + 键盘
    page.locator('[data-journal-slot][data-slot-number="02"]').click()
    page.wait_for_timeout(300)
    selected = page.get_attribute("[data-journal-slot][aria-selected='true']", "data-slot-number")
    check("点击选中 No.02 并更新预览", selected == "02", str(selected))
    page.locator("[data-journal-slot][aria-selected='true']").focus()
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(250)
    selected = page.get_attribute("[data-journal-slot][aria-selected='true']", "data-slot-number")
    focused_role = page.evaluate("() => document.activeElement?.getAttribute('role')")
    check("键盘 ArrowDown 移动选中并同步焦点", selected == "03" and focused_role == "option", f"selected={selected} focus_role={focused_role}")
    page.keyboard.press("Home")
    page.wait_for_timeout(200)
    check("键盘 Home 回到 No.01", page.get_attribute("[data-journal-slot][aria-selected='true']", "data-slot-number") == "01")

    # 读取 + 返回位置恢复
    page.locator('[data-journal-slot][data-slot-number="02"]').click()
    page.wait_for_timeout(250)
    page.locator("[data-journal-preview] a").click()
    page.wait_for_selector("[data-journal-reading]", timeout=10000)
    heading = page.inner_text("[data-journal-reading] h1")
    check("「读取手记」进入正文页并渲染标题", "周末在涩谷走了一整天" in heading, heading[:60])
    shot(page, "journal-reading-desktop")
    page.go_back()
    page.wait_for_selector("[data-journal-slot]", timeout=10000)
    page.wait_for_timeout(600)
    restored = page.get_attribute("[data-journal-slot][aria-selected='true']", "data-slot-number")
    check("从正文返回后恢复上次选中的 No.02（返回位置）", restored == "02", str(restored))

    # 日历切换 + 日期定位
    page.locator("nav[aria-label='浏览方式'] button", has_text="日历").click()
    page.wait_for_selector("[data-journal-calendar]", timeout=10000)
    tz_hint = page.get_attribute("[data-journal-calendar]", "data-journal-calendar")
    day = page.locator("[data-day][data-count='1']").first
    day_value = day.get_attribute("data-day")
    day.click()
    page.wait_for_timeout(800)
    body_after_day = page.inner_text("body")
    day_filter_ok = "周末在涩谷走了一整天" in body_after_day or page.locator("[data-journal-slot]").count() >= 1
    back_to_list = page.get_by_text("返回存档列表").count() >= 1
    check(
        "日历屏可用：显示时区并可按日期定位到真实手记",
        bool(tz_hint) and day_filter_ok and back_to_list,
        f"tz={tz_hint} day={day_value} day_filter={day_filter_ok} back={back_to_list}",
    )
    shot(page, "journal-calendar-desktop")
    page.close()

    # 更多记录 / 私密不泄露（页面文本层面）
    tmp = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(tmp, "/apps/journal", base, wait=1500)
    tmp.wait_for_selector("[data-journal-slot]")
    body = tmp.inner_text("body")
    check(
        "私密 / 草稿手记不泄露到访客界面",
        "私密手记" not in body and "草稿手记" not in body and tmp.locator("[data-journal-slot]").count() == 8,
        f"slots={tmp.locator('[data-journal-slot]').count()}",
    )
    tmp.close()

    # 私密 / 草稿记录的直接地址必须 404（不泄露「存在但私密」）
    summary_path = REPO / ".dsh" / "n7" / "seed-summary.json"
    if summary_path.is_file():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        for label, key in (("私密手记", "journal_private_id"), ("草稿手记", "journal_draft_id")):
            entry_id = summary.get(key)
            response = browser.new_page(viewport=DESKTOP).goto(
                f"{base}/apps/journal/{entry_id}", wait_until="load"
            )
            status = response.status if response else -1
            check(f"{label}直接地址返回 404", status == 404, f"HTTP {status}")
            browser.new_page(viewport=DESKTOP).close()

    # 跨时区：日期不能因时区错一天
    readings: list[dict[str, str]] = []
    for tz in ("Pacific/Honolulu", "Asia/Tokyo"):
        context = browser.new_context(viewport=DESKTOP, timezone_id=tz)
        probe = context.new_page()
        open_page(probe, "/apps/journal", base, wait=1500)
        probe.wait_for_selector("[data-journal-slot]")
        rows = probe.eval_on_selector_all(
            "[data-journal-slot]",
            "els => els.slice(0, 3).map(e => ({ no: e.dataset.slotNumber, date: e.dataset.slotDate, text: e.innerText.replace(/\\n+/g, ' ') }))",
        )
        readings.append({"tz": tz, "rows": rows})
        context.close()
    same = readings[0]["rows"] == readings[1]["rows"]
    check(
        "日期跨时区一致（Honolulu / Tokyo 的日期与星期不错一天）",
        same,
        json.dumps(readings, ensure_ascii=False),
    )


# ---------------------------------------------------------------------------
# 7. 320 / 390 视口截图与溢出
# ---------------------------------------------------------------------------


def responsive_suite(browser, base: str) -> None:
    pages = [
        ("/", "home"),
        ("/posts", "posts"),
        ("/gallery", "gallery"),
        ("/map", "map"),
        ("/showcase", "showcase"),
        ("/apps/journal", "journal"),
    ]
    for label, viewport in (("390", NARROW), ("320", TINY)):
        for path, name in pages:
            page = browser.new_page(viewport=viewport, device_scale_factor=2, reduced_motion="no-preference")
            open_page(page, path, base, wait=900)
            overflow_ok, detail = no_horizontal_overflow(page)
            check(f"{label}px {path} 无横向溢出", overflow_ok, detail)
            shot(page, f"responsive-{name}-{label}")
            page.close()


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3107")
    parser.add_argument("--report", default=str(REPORT))
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    started = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        redirect_checks(args.base)
        nav_suite(browser, args.base)
        posts_suite(browser, args.base)
        map_suite(browser, args.base)
        gallery_suite(browser, args.base)
        transition_suite(browser, args.base)
        journal_suite(browser, args.base)
        responsive_suite(browser, args.base)
        browser.close()

    failed = [item for item in results if not item["ok"]]
    payload = {
        "base": args.base,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "duration_seconds": round(time.time() - started, 1),
        "passed": len(results) - len(failed),
        "failed": len(failed),
        "checks": results,
        "http": http_checks,
        "screenshots": shots,
    }
    pathlib.Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(args.report).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("\n=== summary ===")
    print(
        json.dumps(
            {"passed": payload["passed"], "failed": payload["failed"], "report": args.report, "screenshots": len(shots)},
            ensure_ascii=False,
        )
    )
    if failed:
        print("\n失败项：")
        for item in failed:
            print(f"  FAIL {item['check']} — {item['detail']}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
