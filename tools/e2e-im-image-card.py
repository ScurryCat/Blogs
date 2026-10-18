#!/usr/bin/env python3
"""端到端：IM 图片消息（B4 方案 A · Phase 1）在手机对话里真实渲染。

前置：本地 3100 生产构建 + 8100 API + 演示数据（含公开相册 tokyo-nights）。
流程：打开 morgana 剧本会话 → 选「这地方是什么」→ 卡片出现（图片卡 + 站内入口）
→ 校验 img 的 src/alt/width/height 与 HTTP 200 → 点击开灯箱 → Escape 关闭。

用法：python3 tools/e2e-im-image-card.py [BASE]
退出码：0 = 通过；1 = 失败。
"""

from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100").rstrip("/")
PASS: list[str] = []
FAIL: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail and not ok else ""))


def main() -> int:
    print(f"== IM 图片消息端到端（真实浏览器）：{BASE} ==")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        media: list[tuple[int, str]] = []
        page.on(
            "response",
            lambda r: media.append((r.status, r.url)) if "/api/v1/media/" in r.url else None,
        )
        page.goto(BASE + "/?phone=ins&screen=conversation&item=morgana", wait_until="load", timeout=60000)
        page.wait_for_timeout(2500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(1500)
        try:
            close = page.locator(".poll-close").first
            if close.count():
                close.click(timeout=1200)
                page.wait_for_timeout(250)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(2500)

        page.get_by_role("button", name="这地方是什么").click()
        page.wait_for_timeout(4000)

        state = page.evaluate(
            """() => {
              const img = document.querySelector('.msg-photo-img');
              return {
                cards: document.querySelectorAll('.msg-photo').length,
                src: img?.getAttribute('src') ?? null,
                alt: img?.getAttribute('alt') ?? null,
                width: img?.getAttribute('width') ?? null,
                height: img?.getAttribute('height') ?? null,
                caption: document.querySelector('.msg-photo-caption')?.textContent ?? null,
              };
            }"""
        )
        check("图片卡出现（1 张）", state["cards"] == 1, str(state))
        check("图片卡使用 w640 变体地址", bool(state["src"]) and state["src"].endswith("/w640.webp"), str(state["src"]))
        check("alt 非空", bool(state["alt"] and state["alt"].strip()), str(state["alt"]))
        check("宽高来自服务端（640×480）", state["width"] == "640" and state["height"] == "480", str(state))
        check("图片 HTTP 200", any(status == 200 and url.endswith("/w640.webp") for status, url in media), str(media[-3:]))

        page.locator(".msg-photo").first.click()
        page.wait_for_timeout(900)
        dialog = page.evaluate(
            "() => ({ open: !!document.querySelector('[role=dialog].msg-photo-lightbox'), alt: document.querySelector('.msg-photo-lightbox-img')?.getAttribute('alt') ?? null })"
        )
        check("点击打开灯箱", dialog["open"])
        check("灯箱图片 alt 非空", bool(dialog["alt"]), str(dialog["alt"]))
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)
        check("Escape 关闭灯箱", page.evaluate("() => !document.querySelector('[role=dialog].msg-photo-lightbox')"))

        page.screenshot(path=".dsh/screenshots/im-image-card/e2e-visible.png")
        browser.close()

    print("\n== 结果 ==")
    print(f"  通过 {len(PASS)} 项；失败 {len(FAIL)} 项")
    for item in FAIL:
        print(f"  ✗ {item}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
