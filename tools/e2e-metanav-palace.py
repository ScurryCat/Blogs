"""端到端：手机里「导航 → 进入殿堂」应留在手机内（screen=palace）。

对应 §3.3 手机内导航一致性 P4。需要 `tools/e2e-stack.sh up`（含殿堂种子）。
用法：python3 tools/e2e-metanav-palace.py [BASE]
"""

import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(BASE + "/?phone=metanav", wait_until="load")
        page.wait_for_timeout(3500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(2500)
        page.wait_for_timeout(5000)

        entries = page.evaluate(
            """() => [...document.querySelectorAll('.pw-appview button')]
                 .map(b => (b.textContent || '').trim().slice(0, 12))
                 .filter(t => t.includes('进入殿堂') || t.includes('殿堂'))"""
        )
        print(f"  可点入口：{entries[:5]}")

        point = page.evaluate(
            """() => {
              const body = document.querySelector('.pw-appbody');
              if (!body) return null;
              const sr = body.getBoundingClientRect();
              for (const b of document.querySelectorAll('.pw-appview button')) {
                const text = (b.textContent || '');
                if (!text.includes('进入殿堂')) continue;
                const r = b.getBoundingClientRect();
                if (r.width < 5 || r.top > sr.bottom - 20) continue;
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              }
              return null;
            }"""
        )
        print(f"  「进入殿堂」位置：{point}")
        if point is None:
            print("✗ 找不到可点的「进入殿堂」")
            browser.close()
            return 1
        page.mouse.click(point["x"], point["y"])
        page.wait_for_timeout(4000)

        state = page.evaluate(
            """() => ({
              url: location.pathname + location.search,
              phoneOpen: !!document.querySelector('[data-phone-host]'),
              appview: !!document.querySelector('.pw-appview'),
              palaceScreen: document.querySelectorAll('[data-metanav-screen="palace"]').length,
              text: (document.querySelector('.pw-appview')?.innerText || '').slice(0, 100).replace(/\\s+/g, ' '),
            })"""
        )
        print(f"  URL：{state['url']}")
        print(f"  状态：手机开={state['phoneOpen']} 应用层={state['appview']} palace屏={state['palaceScreen']}")
        print(f"  正文摘要：{state['text']}")
        ok = (
            state["phoneOpen"]
            and state["appview"]
            and state["palaceScreen"] > 0
            and "screen=palace" in state["url"]
        )
        print(f"\n  判定：{'✓ 殿堂正文在手机内打开，手机未关闭' if ok else '✗ 仍离开手机或未渲染'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
