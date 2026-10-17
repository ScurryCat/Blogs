#!/usr/bin/env python3
"""首页回归验收（2026-10-17 · 站主指令：去「怪盗手记」红底 + 首屏完整显示）。

最终口径：
  1) 首页布局保持原本样式（无 ?home 变体）；
  2) 「PHANTOM LOG」下方「怪盗手记」不再有红色背景方块（`.hero-t .cn` 背景透明），
     但区块徽标 `.sec-h .cn` 仍保持深红底（对比度修复不回退）；
  3) 打开首页**不需要滚动**即可完整看到人物卡片 + 左侧 5 个选择栏
     （1024×768 ~ 1920×1080 常见桌面视口）；
  4) 底部迷你播放器保持移除；320/390 无横向溢出（手机允许纵向滚动）。

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

DESKTOP = (
    (1024, 768),
    (1280, 720),
    (1366, 768),
    (1440, 900),
    (1536, 864),
    (1600, 900),
    (1728, 1080),
    (1920, 1080),
)
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
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, x: r.x, width: r.width };
  };
  const items = [...document.querySelectorAll('.pm')].map((el) => {
    const style = getComputedStyle(el);
    const cn = el.querySelector('.pm-c');
    return {
      text: (el.textContent || '').trim().slice(0, 12),
      on: el.classList.contains('on'),
      color: style.color,
      cnColor: cn ? getComputedStyle(cn).color : null,
      box: box(el),
    };
  });
  const art = box(document.querySelector('.hero-art'));
  const overlap2d = art
    ? items.filter((item) => item.box.right > art.left && item.box.left < art.right
        && item.box.bottom > art.top && item.box.top < art.bottom).length
    : 0;
  const cn = document.querySelector('.hero-t .cn');
  const badge = document.querySelector('.sec-h .cn');
  return {
    variant: document.querySelector('.home')?.getAttribute('data-home-variant') ?? null,
    hero: box(document.querySelector('.hero')),
    art,
    items,
    overlap2d,
    heroCnbBg: cn ? getComputedStyle(cn).backgroundColor : null,
    secBadgeBg: badge ? getComputedStyle(badge).backgroundColor : null,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    mini: document.querySelectorAll('[data-mini-player]').length,
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

        def visit(path: str, width: int, height: int):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)[:120]))
            page.goto(BASE + path, wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(900)
            return context, page, errors

        # 桌面矩阵：首屏必须完整包含 Hero（人物卡 + 5 个栏目）
        for width, height in DESKTOP:
            context, page, errors = visit("/", width, height)
            data = page.evaluate(PROBE)
            key = f"{width}x{height}"
            results[key] = data
            vh = height
            if data["variant"] is not None:
                failures.append(f"{key}: 仍是变体布局（data-home-variant={data['variant']}）")
            if data["mini"] != 0:
                failures.append(f"{key}: 底部播放器仍在 DOM")
            if data["overflowX"] > 0:
                failures.append(f"{key}: 横向溢出 {data['overflowX']}px")
            if len(data["items"]) != 5:
                failures.append(f"{key}: 左侧栏目数量 {len(data['items'])} ≠ 5")
            if not data["hero"] or data["hero"]["bottom"] > vh + 1:
                failures.append(f"{key}: Hero 未收进首屏（bottom={data['hero'] and round(data['hero']['bottom'])} / {vh}）")
            if not data["art"] or data["art"]["bottom"] > vh - 4 or data["art"]["top"] < 0:
                failures.append(f"{key}: 人物卡未完整显示（{data['art'] and round(data['art']['bottom'])} / {vh}）")
            if any(item["box"]["bottom"] > vh - 4 for item in data["items"]):
                failures.append(f"{key}: 左侧栏目未完全显示")
            if data["overlap2d"]:
                failures.append(f"{key}: 栏目与人物卡重叠 {data['overlap2d']} 处")
            if data["heroCnbBg"] not in ("rgba(0, 0, 0, 0)", "transparent"):
                failures.append(f"{key}: 「怪盗手记」仍有背景色 {data['heroCnbBg']}")
            if data["secBadgeBg"] != "rgb(168, 12, 20)":
                failures.append(f"{key}: 区块徽标 `.sec-h .cn` 深红底丢失（{data['secBadgeBg']}）")
            active = next((item for item in data["items"] if item["on"]), None)
            if active is None:
                failures.append(f"{key}: 没有当前项（.pm.on）")
            else:
                if active["color"] != "rgb(10, 10, 11)":
                    failures.append(f"{key}: 当前项英文颜色 {active['color']} ≠ 黑字")
                if active["cnColor"] not in ("rgb(159, 12, 18)", "rgb(168, 12, 20)"):
                    failures.append(f"{key}: 当前项中文颜色 {active['cnColor']} 不是深红")
            if errors:
                failures.append(f"{key}: 页面 JS 错误 {errors[:1]}")
            if (width, height) == (1440, 900):
                page.screenshot(path=str(OUT_DIR / "home-fit-desktop.png"))
            if (width, height) == (1280, 720):
                page.screenshot(path=str(OUT_DIR / "home-fit-laptop.png"))
            context.close()

        # 手机：允许纵向滚动，但不得横向溢出、不得有变体/底部播放器
        for width, height in MOBILE:
            context, page, errors = visit("/", width, height)
            data = page.evaluate(PROBE)
            results[f"mobile-{width}"] = data
            if data["variant"] is not None:
                failures.append(f"小屏 {width}: 仍是变体布局")
            if data["mini"] != 0:
                failures.append(f"小屏 {width}: 底部播放器仍在 DOM")
            if data["overflowX"] > 0:
                failures.append(f"小屏 {width}: 横向溢出 {data['overflowX']}px")
            if data["heroCnbBg"] not in ("rgba(0, 0, 0, 0)", "transparent"):
                failures.append(f"小屏 {width}: 「怪盗手记」仍有背景色")
            if errors:
                failures.append(f"小屏 {width}: 页面 JS 错误 {errors[:1]}")
            if width == 390:
                page.screenshot(path=str(OUT_DIR / "home-original-mobile.png"))
            context.close()

        # /posts 的区块徽标深红底也必须在（防止通用 .cn 去掉后漏掉徽标场景）
        context, page, errors = visit("/posts", 1440, 900)
        badge = page.evaluate(
            "() => { const el = document.querySelector('.sec-h .cn'); return el ? getComputedStyle(el).backgroundColor : null; }"
        )
        if badge != "rgb(168, 12, 20)":
            failures.append(f"/posts 区块徽标深红底丢失（{badge}）")
        if errors:
            failures.append(f"/posts: 页面 JS 错误 {errors[:1]}")
        context.close()

        # 旧锚点仍在
        context, page, _ = visit("/", 1440, 900)
        anchors = page.evaluate("() => ['posts', 'latest', 'archive'].map((id) => !!document.getElementById(id))")
        if not all(anchors):
            failures.append(f"首页旧锚点缺失：{anchors}")
        context.close()
        browser.close()

    print("== 首页回归验收（去红底 + 首屏完整显示）==")
    for key in ("1024x768", "1280x720", "1440x900", "1728x1080", "1920x1080"):
        data = results.get(key, {})
        if not isinstance(data, dict) or not data.get("items"):
            print(f"  {key}: 缺失")
            continue
        print(
            f"  {key}: heroBottom={round(data['hero']['bottom'])}/{key.split('x')[1]} "
            f"人物卡bottom={round(data['art']['bottom'])} 栏目bottom={round(max(i['box']['bottom'] for i in data['items']))} "
            f"怪盗手记底色={data['heroCnbBg']}"
        )
    print(f"  截图：{OUT_DIR}/home-fit-{{desktop,laptop}}.png")
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
