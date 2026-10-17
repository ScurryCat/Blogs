"""端到端：手机里「INS 按标签筛选」应留在手机内（screen=tagged）。

对应 §3.3 手机内导航一致性 P1。直接打开 `?phone=ins&screen=tagged&item=<标签>`：
手机要保持打开、渲染出带筛选的 feed、并且「全部」标签可用（换屏回 feed）。

用法：python3 tools/e2e-ins-tag.py [BASE] [标签名]
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130"
TAG = sys.argv[2] if len(sys.argv) > 2 else "端到端"



def viewport() -> dict[str, int]:
    """视口可由 E2E_VIEWPORT 覆盖（如 `E2E_VIEWPORT=390x844`），默认桌面。"""
    raw = os.environ.get("E2E_VIEWPORT", "1440x900")
    width, _, height = raw.partition("x")
    return {"width": int(width), "height": int(height or 900)}

def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=viewport())
        page.goto(f"{BASE}/?phone=ins&screen=tagged&item={TAG}", wait_until="load")
        page.wait_for_timeout(3500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(2500)
        page.wait_for_timeout(4500)

        state = page.evaluate(
            """() => ({
              url: location.pathname + location.search,
              phoneOpen: !!document.querySelector('[data-phone-host]'),
              appview: !!document.querySelector('.pw-appview'),
              chips: [...document.querySelectorAll('.pw-appview .ins-chip')].map(c => (c.textContent || '').trim()),
              chipButtons: [...document.querySelectorAll('.pw-appview button.ins-chip')].length,
              feedWrap: !!document.querySelector('.pw-appview .ins-feed-wrap'),
              text: (document.querySelector('.pw-appview')?.innerText || '').slice(0, 90).replace(/\\s+/g, ' '),
            })"""
        )
        print(f"  URL：{state['url']}")
        print(f"  状态：手机开={state['phoneOpen']} 应用层={state['appview']} feed={state['feedWrap']}")
        print(f"  标签 chips：{state['chips']}（其中按钮 {state['chipButtons']} 个）")
        print(f"  摘要：{state['text']}")

        ok = (
            state["phoneOpen"]
            and state["appview"]
            and state["feedWrap"]
            and "screen=tagged" in state["url"]
            and state["chipButtons"] >= 1
        )
        print(f"\n  判定：{'✓ 标签筛选在手机内，手机未关闭' if ok else '✗ 仍离开手机或未渲染'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
