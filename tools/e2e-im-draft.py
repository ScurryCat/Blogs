"""端到端回归：IM 草稿在「离开会话 → 再进入」后是否还在（真实浏览器）。

jsdom 只覆盖了 hook 的存取逻辑；这条测的是真实页面路径：输入框默认收起（点「自己说一句」
展开），离开会话再回来时草稿要能恢复。

前提（隔离栈，见 tools/e2e-seed-journal.py 头注释）：
  1. 独立集群 + 迁移 + 站主；
  2. 隔离 API（如 8130）+ 用同一 API 地址构建/运行的前端（如 3130）；
  3. 不需要额外种子数据 —— 角色来自代码里的故事模块。

用法：python3 tools/e2e-im-draft.py [BASE] [character]
"""

import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130"
CHARACTER = sys.argv[2] if len(sys.argv) > 2 else "futaba"
DRAFT = "草稿端到端验证-40"


def open_conversation(page):
    page.goto(f"{BASE}/apps/ins/messages/{CHARACTER}", wait_until="load")
    page.wait_for_timeout(4000)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_timeout(2500)
    page.wait_for_timeout(5000)


def expand_composer(page):
    button = page.locator("button", has_text="自己说一句")
    if button.count():
        button.first.click()
        page.wait_for_timeout(1200)
    return page.locator("textarea").count() > 0


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        open_conversation(page)
        if not expand_composer(page):
            print("✗ 展开后仍没有输入框")
            browser.close()
            return 1
        page.locator("textarea").first.fill(DRAFT)
        page.wait_for_timeout(1000)
        stored = page.evaluate(
            "() => Object.entries(sessionStorage).filter(([k]) => k.includes('draft'))"
        )
        print(f"  输入后存储：{stored}")

        page.goto(f"{BASE}/apps/ins/messages", wait_until="load")
        page.wait_for_timeout(2500)
        open_conversation(page)
        expand_composer(page)
        value = page.evaluate(
            "() => { const t = document.querySelector('textarea'); return t ? t.value : null; }"
        )
        print(f"  重新进入后草稿：{value!r}")
        ok = value == DRAFT
        print(f"  判定：{'✓ 草稿仍在' if ok else '✗ 草稿丢失'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
