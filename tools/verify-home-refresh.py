#!/usr/bin/env python3
"""首页回归验收（2026-10-17 · 站主指令：还原原本布局，仅修字体显示异常）。

站主两次指令的最终口径：
  - 首页**布局还原为原本的样子**（不做变体排版、不压缩 Hero、不换区块顺序）；
  - 只修复「主角头像左侧栏目看不清」这个字体显示异常：
    当前项文字回到黑字、中文标签深红（不再是纸白压纸色拼贴）；
  - 底部迷你播放器保持移除（站主此前明确不要）；
  - 320/390 无横向溢出。

用法：python3 tools/verify-home-refresh.py [BASE] [--json OUT]
默认 BASE=http://127.0.0.1:3100（生产构建）；开发时传 http://localhost:3131。
退出码：0 = 全部通过；1 = 有失败。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT_DIR = Path(__file__).resolve().parents[1] / ".dsh/screenshots/home-refresh"

DESKTOP = ((1440, 900), (1280, 720))
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
    const style = getComputedStyle(el);
    const cn = el.querySelector('.pm-c');
    return {
      text: (el.textContent || '').trim().slice(0, 12),
      on: el.classList.contains('on'),
      color: style.color,
      cnColor: cn ? getComputedStyle(cn).color : null,
    };
  });
  return {
    variant: document.querySelector('.home')?.getAttribute('data-home-variant') ?? null,
    items,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    mini: document.querySelectorAll('[data-mini-player]').length,
    h1: document.querySelectorAll('h1').length,
  };
}"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://127.0.0.1:3100")
    parser.add_argument("--json", default="")
    args = parser.parse_args()
    BASE = args.base.rstrip("/")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    results: dict[str, object] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()

        def visit(width: int, height: int):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)[:120]))
            page.goto(BASE + "/", wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(900)
            return context, page, errors

        for width, height in DESKTOP + MOBILE:
            context, page, errors = visit(width, height)
            data = page.evaluate(PROBE)
            key = f"{width}x{height}"
            results[key] = data
            if data["variant"] is not None:
                failures.append(f"{key}: 首页仍是变体布局（data-home-variant={data['variant']}），应为原本布局")
            if data["mini"] != 0:
                failures.append(f"{key}: 底部播放器仍在 DOM")
            if data["overflowX"] > 0:
                failures.append(f"{key}: 横向溢出 {data['overflowX']}px")
            if len(data["items"]) != 5:
                failures.append(f"{key}: 左侧栏目数量 {len(data['items'])} ≠ 5")
            active = next((item for item in data["items"] if item["on"]), None)
            if active is None:
                failures.append(f"{key}: 没有当前项（.pm.on）")
            else:
                # 字体显示异常修复的核心断言：当前项不再是「纸白字压在纸色拼贴上」。
                if active["color"] != "rgb(10, 10, 11)":
                    failures.append(f"{key}: 当前项英文颜色 {active['color']} ≠ 黑字（字体异常未修复）")
                if active["cnColor"] not in ("rgb(159, 12, 18)", "rgb(168, 12, 20)"):
                    failures.append(f"{key}: 当前项中文颜色 {active['cnColor']} 不是深红")
            if errors:
                failures.append(f"{key}: 页面 JS 错误 {errors[:1]}")
            if (width, height) in ((1440, 900), (390, 844)):
                page.screenshot(path=str(OUT_DIR / f"home-original-{'desktop' if width > 900 else 'mobile'}.png"))
            context.close()

        # 原有首页结构必须还在（旧锚点/标题）
        context, page, errors = visit(1440, 900)
        anchors = page.evaluate(
            "() => ['posts', 'latest', 'archive'].map((id) => !!document.getElementById(id))"
        )
        if not all(anchors):
            failures.append(f"首页旧锚点缺失：{anchors}")
        context.close()
        browser.close()

    print("== 首页回归验收（原本布局 + 字体修复）==")
    for key in ("1440x900", "1280x720", "320x720", "390x844"):
        data = results.get(key, {})
        print(
            f"  {key}: 栏目={len(data.get('items', [])) if isinstance(data, dict) else '?'} "
            f"变体标记={data.get('variant') if isinstance(data, dict) else '?'} "
            f"底部播放器={data.get('mini') if isinstance(data, dict) else '?'}"
        )
    print(f"  截图：{OUT_DIR}/home-original-*.png")
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
