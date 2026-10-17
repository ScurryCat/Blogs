"""端到端：手机里「读取手记」应留在手机内（不再跳独立路由并关闭手机）。

对应 §3.3 手机内导航一致性（台账专项审计 P3）。jsdom 只能断言宿主调用，只有真实浏览器
才能确认「手机没被关闭、正文在手机内渲染」。

前提：`tools/e2e-stack.sh up`（含 15 条种子手记）。
用法：python3 tools/e2e-journal-reading.py [BASE]
"""

import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(BASE + "/?phone=journal", wait_until="load")
        page.wait_for_timeout(3500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(2500)
        page.wait_for_timeout(5000)

        point = page.evaluate(
            """() => {
              const body = document.querySelector('.pw-appbody');
              if (!body) return null;
              const sr = body.getBoundingClientRect();
              for (const li of document.querySelectorAll('.pw-appbody li')) {
                const r = li.getBoundingClientRect();
                if (r.top > sr.top + 60 && r.bottom < sr.bottom - 120) {
                  return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
                }
              }
              return null;
            }"""
        )
        if point is None:
            print("✗ 找不到可点的条目")
            browser.close()
            return 1
        page.mouse.click(point["x"], point["y"])
        page.wait_for_timeout(800)

        read = page.locator("button", has_text="读取手记")
        if read.count() == 0:
            print("✗ 找不到「读取手记」")
            browser.close()
            return 1
        read.first.click()
        page.wait_for_timeout(3500)

        state = page.evaluate(
            """() => ({
              url: location.pathname + location.search,
              phoneOpen: !!document.querySelector('[data-phone-host]'),
              appview: !!document.querySelector('.pw-appview'),
              reading: !!document.querySelector('[data-journal-screen="reading"]'),
              back: [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('返回存档列表')),
            })"""
        )
        print(f"  URL：{state['url']}")
        print(f"  状态：手机开={state['phoneOpen']} 应用层={state['appview']} 正文={state['reading']} 返回钮={state['back']}")
        ok = (
            state["phoneOpen"]
            and state["appview"]
            and state["reading"]
            and state["back"]
            and "screen=reading" in state["url"]
        )
        print(f"\n  判定：{'✓ 正文在手机内打开，手机未关闭' if ok else '✗ 仍离开手机或未渲染'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
