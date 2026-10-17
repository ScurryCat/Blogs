"""端到端：手机里「消息页签 → 点角色」应留在手机内（screen=conversation）。

对应 §3.3 手机内导航一致性 P2。

根因背景：`ins/phone-manifest.tsx` 的 loader 曾返回 `InsPhoneView`（只认 feed/detail/saved），
且 screens 不含消息的两个屏 —— 于是 `screen=conversation` 不被宿主识别、回退桌面。
修好后这里应当直接进入会话并保持手机打开。

用法：python3 tools/e2e-ins-conversation.py [BASE]
"""

import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130"


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(BASE + "/?phone=ins", wait_until="load")
        page.wait_for_timeout(3500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(2500)
        page.wait_for_timeout(3500)

        tab = page.locator('[role="tab"]', has_text="消息")
        if tab.count() == 0:
            print("✗ 没有「消息」页签")
            browser.close()
            return 1
        tab.first.click()
        page.wait_for_timeout(3000)

        point = page.evaluate(
            """() => {
              const body = document.querySelector('.pw-appbody');
              if (!body) return null;
              for (const el of document.querySelectorAll('.pw-appbody li, .pw-appbody button, .pw-appbody a')) {
                if (!(el.textContent || '').includes('双叶')) continue;
                const r = el.getBoundingClientRect();
                if (r.width > 5) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              }
              return null;
            }"""
        )
        print(f"  角色入口：{point}")
        if point is None:
            print("✗ 找不到角色入口")
            browser.close()
            return 1
        page.mouse.click(point["x"], point["y"])
        page.wait_for_timeout(4500)

        state = page.evaluate(
            """() => ({
              url: location.pathname + location.search,
              phoneOpen: !!document.querySelector('[data-phone-host]'),
              appview: !!document.querySelector('.pw-appview'),
              text: (document.querySelector('.pw-appview')?.innerText || '').slice(0, 70).replace(/\\s+/g, ' '),
            })"""
        )
        print(f"  URL：{state['url']}")
        print(f"  状态：手机开={state['phoneOpen']} 应用层={state['appview']}")
        print(f"  摘要：{state['text']}")
        ok = state["phoneOpen"] and state["appview"] and "screen=conversation" in state["url"]
        print(f"\n  判定：{'✓ 会话在手机内，手机未关闭' if ok else '✗ 仍离开手机'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
