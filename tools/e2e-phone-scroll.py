"""端到端回归：手机里「手记列表滚动 → 读取正文 → 返回」后，滚动位置是否恢复。

**测的是 jsdom 覆盖不到的那条路径**：手机里真正滚动的元素是 `.pw-appbody`（不是
`.pw-screen`，也不是 window）。这个 bug 单测全绿但功能是坏的 —— 是这条端到端测量抓出来的。

前提（隔离栈，见 tools/e2e-seed-journal.py 的头注释）：
  1. 独立集群 + 迁移 + 站主；
  2. 隔离 API（如 8130）+ 用同一个 API 地址构建/运行的前端（如 3130）；
  3. 用 `tools/e2e-seed-journal.py` 造出足够多的公开手记（≥10 条才滚得起来）。

用法：python3 tools/e2e-phone-scroll.py [BASE]
"""


import os
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130"


SCROLLER = "document.querySelector('.pw-appbody') || document.querySelector('.pw-screen')"

def scroll_top(page):
    return page.evaluate("() => { const s = " + SCROLLER + "; return s ? Math.round(s.scrollTop) : null; }")


def set_scroll(page, ratio):
    page.evaluate(
        """(r) => { const s = document.querySelector('.pw-appbody') || document.querySelector('.pw-screen');
             s.scrollTop = Math.round(s.scrollHeight * r); }""",
        ratio,
    )


def visible_card_point(page):
    """返回屏幕可视区域内、最靠近中心的那张卡片的可点坐标。"""
    return page.evaluate(
        """() => {
          const screen = document.querySelector('.pw-appbody') || document.querySelector('.pw-screen');
          const sr = screen.getBoundingClientRect();
          const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2;
          const items = document.querySelectorAll('.pw-appbody li, .pw-screen li');
          let best = null, bestD = Infinity;
          for (const li of items) {
            const el = li.querySelector('button, a, [role="button"]') || li;
            const r = el.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) continue;
            if (r.bottom < sr.top + 8 || r.top > sr.bottom - 8) continue;  // 必须真的在屏幕内
            const px = Math.min(Math.max(cx, r.left + 8), r.right - 8);
            const py = Math.min(Math.max(cy, r.top + 8), r.bottom - 8);
            const d = Math.hypot(px - cx, py - cy);
            if (d < bestD) { bestD = d; best = { x: Math.round(px), y: Math.round(py), text: (el.textContent||'').trim().slice(0,16) }; }
          }
          return best;
        }"""
    )



def viewport() -> dict[str, int]:
    """视口可由 E2E_VIEWPORT 覆盖（如 `E2E_VIEWPORT=390x844`），默认桌面。"""
    raw = os.environ.get("E2E_VIEWPORT", "1440x900")
    width, _, height = raw.partition("x")
    return {"width": int(width), "height": int(height or 900)}

def click_read_button(page) -> None:
    """点「读取手记」。移动布局里预览面板在长列表之后，必须先滚动容器再点。"""
    point = page.evaluate(
        """() => {
          const btn = [...document.querySelectorAll('button')]
            .find((b) => (b.textContent || '').includes('读取手记'));
          if (!btn) return null;
          // 桌面宽度下滚动的是 .pw-appbody，手机全屏模式下滚动的是窗口 ——
          // scrollIntoView 会自己找可滚祖先，两种布局都适用。
          btn.scrollIntoView({ block: "center" });
          return true;
        }"""
    )
    if not point:
        raise RuntimeError("找不到「读取手记」按钮")
    page.wait_for_timeout(700)
    box = page.evaluate(
        """() => {
          const btn = [...document.querySelectorAll('button')]
            .find((b) => (b.textContent || '').includes('读取手记'));
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                   ok: r.top >= 0 && r.bottom <= innerHeight && r.width > 5 };
        }"""
    )
    if not box or not box["ok"]:
        raise RuntimeError(f"「读取手记」不在视口内：{box}")
    page.mouse.click(box["x"], box["y"])


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=viewport())
        page.goto(BASE + "/?phone=journal", wait_until="load")
        page.wait_for_timeout(2500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        page.wait_for_timeout(3000)

        items = page.locator(".pw-screen li").count()
        print(f"  手记条目：{items} 条")
        if items < 5:
            print("  ✗ 内容不足")
            browser.close()
            return 1

        set_scroll(page, 0.5)
        page.wait_for_timeout(400)
        before = scroll_top(page)
        print(f"  滚动到 {before}px")

        point = visible_card_point(page)
        print(f"  点选可见条目：{point}")
        if point is None:
            print("  ✗ 屏幕内没有可点条目")
            browser.close()
            return 1
        page.mouse.click(point["x"], point["y"])
        page.wait_for_timeout(800)
        # 点选卡片本身可能把列表滚到该卡片 —— 真正的「最后位置」要在跳转前一刻取
        before = scroll_top(page)
        print(f"  跳转前的位置 = {before}（点击前是 {before}）")

        # 「读取手记」按钮（预览区）
        read = page.locator("button", has_text="读取手记")
        if read.count() == 0:
            read = page.locator("button", has_text="读取")
        print(f"  「读取」按钮数：{read.count()}")
        click_read_button(page)
        page.wait_for_timeout(3000)
        detail_url = page.url
        print(f"  进入正文：{detail_url}")
        # 真正的「最后位置」= 跳转瞬间保存下来的值（点按钮本身也会让列表滚动）
        saved = page.evaluate("() => { const v = sessionStorage.getItem('journal.save.v1'); return v === null ? null : Number(v); }")
        print(f"  跳转时保存的位置 = {saved}")

        page.go_back(wait_until="load")
        page.wait_for_timeout(3500)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(1500)
        page.wait_for_timeout(2500)
        after = scroll_top(page)
        expected = saved if saved is not None else before
        print(f"  返回后 scrollTop = {after}（应为 {expected}）")

        ok = expected is not None and after is not None and abs(after - expected) <= 8
        print(f"\n  判定：{'✓ 滚动位置已恢复' if ok else '✗ 未恢复到原位置'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
