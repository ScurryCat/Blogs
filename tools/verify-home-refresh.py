#!/usr/bin/env python3
"""首页刷新验收（2026-10-17 · 用户反馈 R1/R2/R4）。

断言：
  R1 底部迷你播放器已整条移除（DOM 无 [data-mini-player]）；
  R2 常见桌面视口下 Hero 左侧 5 个栏目全部在首屏、不与主角图重叠、
     当前项文字颜色符合（英文黑字 / 中文深红），320/390 无横向溢出；
  R4 `?home=a|b|c` 三套排版都能渲染、锚点保留、无 console error。

用法：python3 tools/verify-home-refresh.py [BASE] [--json OUT]
默认 BASE=http://localhost:3131（dev）；验收生产构建时传 http://127.0.0.1:3100。
退出码：0 = 全部通过；1 = 有失败（逐条打印）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT_DIR = Path(__file__).resolve().parents[1] / ".dsh/screenshots/home-refresh"

DESKTOP = ((1024, 768), (1280, 720), (1440, 900), (1728, 1080))
MOBILE = ((320, 720), (390, 844))


def boot(page) -> None:
    page.wait_for_timeout(1500)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(500)
    try:
        close = page.locator(".poll-close").first
        if close.count():
            close.click(timeout=1200)
            page.wait_for_timeout(200)
    except Exception:  # noqa: BLE001
        pass


PROBE = """() => {
  const items = [...document.querySelectorAll('.pm')].map((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const cn = el.querySelector('.pm-c');
    return {
      text: (el.textContent || '').trim().slice(0, 12),
      on: el.classList.contains('on'),
      color: style.color,
      cnColor: cn ? getComputedStyle(cn).color : null,
      x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
    };
  });
  const art = document.querySelector('.hero-art')?.getBoundingClientRect();
  const overlap2d = art
    ? items.filter((i) => i.right > art.x && i.x < art.right && i.y < art.bottom && i.bottom > art.y)
    : [];
  const anchors = ['posts', 'latest', 'archive', 'home-apps'].map((id) => !!document.getElementById(id));
  return {
    variant: document.querySelector('.home')?.getAttribute('data-home-variant'),
    items,
    off: items.filter((i) => i.bottom > innerHeight),
    overlap2d: overlap2d.length,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    anchors,
    apps: document.querySelectorAll('[data-home-app]').length,
    mini: document.querySelectorAll('[data-mini-player]').length,
    h1: document.querySelectorAll('h1').length,
  };
}"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://localhost:3131")
    parser.add_argument("--json", default="")
    args = parser.parse_args()
    BASE = args.base.rstrip("/")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    results: dict[str, object] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()

        def visit(path: str, width: int, height: int, *, reduced: bool = False):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)[:120]))
            page.goto(BASE + path, wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(900)
            return context, page, errors

        # R2：桌面首屏与文字可读性（A 与 D 都要满足：D 只是人物卡片构图不同）
        for variant in ("a", "d"):
            for width, height in DESKTOP:
                context, page, errors = visit(f"/?home={variant}", width, height)
                data = page.evaluate(PROBE)
                key = f"{width}x{height}" if variant == "a" else f"d-{width}x{height}"
                results[key] = data
                if not data["items"]:
                    failures.append(f"{key}: 没有找到左侧栏目（.pm）")
                if len(data["items"]) != 5:
                    failures.append(f"{key}: 栏目数量 {len(data['items'])} ≠ 5")
                if data["off"]:
                    failures.append(f"{key}: {len(data['off'])} 个栏目在首屏之外")
                if data["overlap2d"]:
                    failures.append(f"{key}: 栏目与主角图重叠 {data['overlap2d']} 处")
                if data["overflowX"] > 0:
                    failures.append(f"{key}: 横向溢出 {data['overflowX']}px")
                active = next((item for item in data["items"] if item["on"]), None)
                if active is None:
                    failures.append(f"{key}: 没有当前项（.pm.on）")
                else:
                    if active["color"] != "rgb(10, 10, 11)":
                        failures.append(f"{key}: 当前项英文颜色 {active['color']} ≠ 黑字")
                    if active["cnColor"] not in ("rgb(159, 12, 18)", "rgb(168, 12, 20)"):
                        failures.append(f"{key}: 当前项中文颜色 {active['cnColor']} 不是深红")
                if data["mini"] != 0:
                    failures.append(f"{key}: 底部播放器仍在 DOM（[data-mini-player] 数量 {data['mini']}）")
                if errors:
                    failures.append(f"{key}: 页面 JS 错误 {errors[:1]}")
                context.close()

        # R2：小屏无横向溢出（A 与 D）
        for variant in ("a", "d"):
            for width, height in MOBILE:
                context, page, errors = visit(f"/?home={variant}", width, height)
                data = page.evaluate(PROBE)
                results[f"mobile-{width}" if variant == "a" else f"d-mobile-{width}"] = data
                if data["overflowX"] > 0:
                    failures.append(f"小屏 {width}: 横向溢出 {data['overflowX']}px")
                if data["mini"] != 0:
                    failures.append(f"小屏 {width}: 底部播放器仍在 DOM")
                if errors:
                    failures.append(f"小屏 {width}: 页面 JS 错误 {errors[:1]}")
                context.close()

        # R4：三变体
        for variant in ("a", "b", "c", "d"):
            for width, height, label in ((1440, 900, "desktop"), (390, 844, "mobile")):
                context, page, errors = visit(f"/?home={variant}", width, height)
                data = page.evaluate(PROBE)
                if data["variant"] != variant:
                    failures.append(f"变体 {variant} @{label}: data-home-variant={data['variant']}")
                if not (data["anchors"][0] and data["anchors"][1] and data["anchors"][2]):
                    failures.append(f"变体 {variant} @{label}: 旧锚点缺失（posts/latest/archive）")
                if variant == "c":
                    if not data["anchors"][3]:
                        failures.append("变体 c: 缺少应用入口区（#home-apps）")
                    if data["apps"] != 9:
                        failures.append(f"变体 c: 应用入口 {data['apps']} ≠ 9")
                if data["mini"] != 0:
                    failures.append(f"变体 {variant} @{label}: 底部播放器仍在 DOM")
                if errors:
                    failures.append(f"变体 {variant} @{label}: JS 错误 {errors[:1]}")
                page.screenshot(path=str(OUT_DIR / f"home-{variant}-{label}.png"))
                context.close()

        # 移除播放器后的音乐连续性：跨路由仍是同一个 audio 元素（只读探针）
        context, page, errors = visit("/", 1440, 900)
        before = page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length")
        page.click('a[href="/posts"]', timeout=8000)
        page.wait_for_timeout(1500)
        after = page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length")
        results["music-elements"] = {"before": before, "after": after}
        if before != 1 or after != 1:
            failures.append(f"音乐元素数量异常：before={before} after={after}")
        context.close()
        browser.close()

    print("== 首页刷新验收 ==")
    for key in ("1024x768", "1280x720", "1440x900", "1728x1080", "mobile-320", "mobile-390",
                "d-1280x720", "d-1440x900", "d-mobile-390"):
        data = results.get(key, {})
        off = len(data.get("off", [])) if isinstance(data, dict) else "?"
        print(
            f"  {key}: 栏目={len(data.get('items', [])) if isinstance(data, dict) else '?'} "
            f"首屏外={off} 重叠={data.get('overlap2d') if isinstance(data, dict) else '?'} "
            f"底部播放器={data.get('mini') if isinstance(data, dict) else '?'}"
        )
    print(f"  四变体截图（A/B/C/D，桌面+移动）：{OUT_DIR}")
    print("\n== 失败项 ==")
    if failures:
        for item in failures:
            print(f"  ✗ {item}")
        if args.json:
            Path(args.json).write_text(json.dumps({"failures": failures, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
        return 1
    print("  （无 ✓）")
    if args.json:
        Path(args.json).write_text(json.dumps({"failures": [], "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
