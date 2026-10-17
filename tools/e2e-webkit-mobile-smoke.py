#!/usr/bin/env python3
"""移动引擎冒烟（WebKit / iPhone 视口）——验收报告「真机未验证」的部分证据。

**边界（必须如实标注）**：本脚本用 Playwright 的 **WebKit 引擎**（Safari 同源引擎）
+ iPhone 尺寸/触控上下文运行，**不是真实设备**：不能替代真实触控、软键盘/中文输入法、
硬件性能与真机 iOS Safari 的验证。它只补「Safari 引擎渲染 + 触控事件 + 320/390 布局」证据。

用法：
    PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright python3 tools/e2e-webkit-mobile-smoke.py [BASE]
默认 BASE=http://127.0.0.1:3100（生产构建）。截图写到 .dsh/screenshots/mobile-webkit/。
退出码：0 = 全部通过；1 = 有失败。
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100").rstrip("/")
SHOTS = pathlib.Path(".dsh/screenshots/mobile-webkit")
BROWSERS = pathlib.Path(".dsh/ms-playwright")
if BROWSERS.exists():
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(BROWSERS))

VIEWPORTS = [(390, 844), (320, 720)]
PASS: list[str] = []
FAIL: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail and not ok else ""))


def boot(page) -> None:
    page.wait_for_timeout(1500)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_timeout(1200)
    try:
        close = page.locator(".poll-close").first
        if close.count():
            close.click(timeout=1200)
            page.wait_for_timeout(200)
    except Exception:  # noqa: BLE001
        pass


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    print(f"== 移动引擎冒烟（WebKit，非真机）：{BASE} ==")
    results: dict[str, object] = {}
    with sync_playwright() as p:
        browser = p.webkit.launch()
        for width, height in VIEWPORTS:
            ctx = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                ),
            )
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(800)
            state = page.evaluate(
                """() => ({
                  overflowX: document.documentElement.scrollWidth - innerWidth,
                  hero: !!document.querySelector('.hero'),
                  cn: (document.querySelector('.hero-t .cn')?.getBoundingClientRect().width || 0) > 0,
                  cnBg: (() => { const el = document.querySelector('.hero-t .cn');
                    return el ? getComputedStyle(el).backgroundColor : null; })(),
                })"""
            )
            key = f"{width}x{height}"
            results[key] = {"home": state}
            check(f"[{key}] 首页在 WebKit 渲染", state["hero"])
            check(f"[{key}] 无横向溢出", state["overflowX"] == 0, str(state["overflowX"]))
            check(f"[{key}] 「怪盗手记」无红底", state["cnBg"] in ("rgba(0, 0, 0, 0)", "transparent"), str(state["cnBg"]))
            page.screenshot(path=str(SHOTS / f"home-{key}.png"))

            # 手机桌面（触控上下文）
            page.goto(BASE + "/?phone=home", wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(1600)
            phone = page.evaluate(
                """() => ({
                  open: !!document.querySelector('[data-phone-host]'),
                  apps: document.querySelectorAll('.pw-app').length,
                  originalIcons: [...document.querySelectorAll('img[data-app-icon=\"original\"]')]
                    .map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })),
                  styles: [...document.styleSheets].length,
                  appview: !!document.querySelector('.pw-appview'),
                })"""
            )
            results[key]["phone"] = phone
            check(f"[{key}] 手机可打开", phone["open"])
            check(f"[{key}] 桌面应用磁贴渲染", phone["apps"] > 0, str(phone["apps"]))
            check(f"[{key}] 原版图标 2 枚加载", len(phone["originalIcons"]) == 2 and all(i["w"] > 0 for i in phone["originalIcons"]), str(phone["originalIcons"]))
            if phone["apps"]:
                # 触控点按第一个应用磁贴：应进入应用层（.pw-appview）或仍留在桌面
                page.locator(".pw-app").first.tap()
                page.wait_for_timeout(1200)
                tapped = page.evaluate("() => !!document.querySelector('.pw-appview') || !!document.querySelector('.pw-app-page')")
                results[key]["tapOpensApp"] = tapped
                check(f"[{key}] 触控点按应用磁贴有响应", tapped)
            page.screenshot(path=str(SHOTS / f"phone-{key}.png"))

            # IM（脚本/消息渲染）
            page.goto(BASE + "/?phone=ins", wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(1800)
            ins = page.evaluate(
                """() => ({
                  open: !!document.querySelector('[data-phone-host]'),
                  appview: !!document.querySelector('.pw-appview'),
                  feed: !!document.querySelector('.ins-feed-wrap'),
                  text: (document.querySelector('.pw-appview')?.innerText || '').slice(0, 60).replace(/\\s+/g, ' '),
                })"""
            )
            results[key]["ins"] = ins
            check(f"[{key}] IM 在手机内打开", ins["open"] and ins["appview"])
            check(f"[{key}] IM feed 渲染", ins["feed"])
            page.screenshot(path=str(SHOTS / f"ins-{key}.png"))

            # 图库 + 灯箱（触控）
            page.goto(BASE + "/gallery", wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(1800)
            gallery = page.evaluate(
                "() => ({ cards: document.querySelectorAll('button.photo-tile-button, .photo-tile').length })"
            )
            results[key]["gallery"] = gallery
            check(f"[{key}] 图库页有内容", gallery["cards"] > 0, str(gallery["cards"]))
            opened = False
            try:
                target = page.locator("button.photo-tile-button").first
                if target.count():
                    target.tap()
                    page.wait_for_timeout(1500)
                    opened = page.evaluate("() => !!document.querySelector('.plg-lightbox[role=\"dialog\"]')")
                    if opened:
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(600)
                        closed = page.evaluate("() => !document.querySelector('.plg-lightbox')")
                        results[key]["lightboxClosed"] = closed
                        check(f"[{key}] Escape 关闭灯箱", closed)
            except Exception:  # noqa: BLE001
                pass
            results[key]["lightbox"] = opened
            check(f"[{key}] 触控打开灯箱", opened)
            page.screenshot(path=str(SHOTS / f"gallery-{key}.png"))
            ctx.close()
        browser.close()

    print("\n== 结果 ==")
    print(f"  通过 {len(PASS)} 项；失败 {len(FAIL)} 项")
    print("  ⚠️ 本结果来自 WebKit 引擎 + iPhone 视口，**不是真实设备**；触控/软键盘/中文输入法/真机 Safari 仍需真机验证。")
    pathlib.Path(".dsh/mobile-webkit-results.json").write_text(
        json.dumps({"pass": PASS, "fail": FAIL, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    for item in FAIL:
        print(f"  ✗ {item}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
