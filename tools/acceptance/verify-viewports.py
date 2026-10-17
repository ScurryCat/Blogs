"""§8.2 多视口 / 缩放档 / 触控目标 / 出界检查（测量脚本，不依赖视觉）。

浏览器"缩放档"的模拟：Playwright 不能直接设浏览器 zoom，所以用 **视口缩小** 等价模拟 ——
125% 缩放 ≈ 把 CSS 视口按 1/1.25 缩小。这不是像素级等价（设备像素比不同），
但对"布局是否被挤压/溢出/触控目标是否过小"这类判定是有效的，结论按此口径记录。

用法：python3 tools/acceptance/verify-viewports.py [BASE_URL]
"""

from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3120"

# (标签, 宽, 高) —— 桌面按任务书建议覆盖 1280×720 / 1440×900 / 更大的视口
DESKTOP = [("1280x720", 1280, 720), ("1440x900", 1440, 900), ("1728x1080", 1728, 1080)]
ZOOMS = {"100%": 1.0, "80%": 0.8, "125%": 1.25}
SMALL = [("320", 320, 720), ("390", 390, 844)]

PROBE = """() => {
  const box = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
  const hit = (sel, fx, fy) => { const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
    return !!(target && target.closest && target.closest(sel)); };
  const zVar = getComputedStyle(document.querySelector('.pw')).getPropertyValue('--z').trim();
  const scr = document.querySelector('.pw-screen');
  return {
    z: zVar,
    viewport: { w: innerWidth, h: innerHeight },
    overflowX: document.documentElement.scrollWidth - innerWidth,
    phone: box('.pw'),
    screen: box('.pw-screen'),
    mini: box('[data-mini-player]'),
    miniVisible: (() => { const m = document.querySelector('[data-mini-player]');
      return !!m && getComputedStyle(m).display !== 'none'; })(),
    pageBtn: box('.pw-page-btn'),
    // 注意：**不能沿包围盒取样** —— 斜屏 + 条自身 skewX 会让包围盒两端落在视觉条之外
    // （第 2 轮踩过：包围盒中点行在两端根本不在条上）。这里沿「两端标记连线」取样。
    barHit: (() => {
      const bar = document.querySelector('.pw-bar:not(.vol)');
      if (!bar) return [false, false, false];
      const L = bar.querySelector('[data-pw-axis="left"]').getBoundingClientRect();
      const R = bar.querySelector('[data-pw-axis="right"]').getBoundingClientRect();
      return [0.08, 0.5, 0.92].map((f) => {
        const x = L.left + (R.left - L.left) * f;
        const y = L.top + (R.top - L.top) * f;
        const target = document.elementFromPoint(x, y);
        return !!(target && target.closest && target.closest('.pw-bar'));
      });
    })(),
    tileHit: hit('.pw-app', 0.5, 0.5),
    pagerClickable: !!document.querySelector('.pw-page-btn:not([disabled])'),
  };
}"""


def desktop_matrix(browser):
    rows = []
    for label, w, h in DESKTOP:
        for zoom_label, zoom in ZOOMS.items():
            vw, vh = int(w / zoom), int(h / zoom)
            page = browser.new_page(viewport={"width": vw, "height": vh})
            page.goto(BASE + "/", wait_until="load")
            page.wait_for_timeout(900)
            if page.locator("#boot").count():
                page.keyboard.press("Enter")
                page.wait_for_selector("#boot", state="detached", timeout=8000)
            page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=20000)
            page.locator(".pw-tab").first.click()
            page.wait_for_timeout(2200)
            data = page.evaluate(PROBE)
            inside = (
                data["phone"] is not None
                and data["phone"]["x"] >= -1
                and data["phone"]["y"] >= -1
                and data["phone"]["right"] <= vw + 1
                and data["phone"]["bottom"] <= vh + 1
            )
            # 沿视觉轴真实按下音量条，读 audio.volume —— 避开 Range/seek 干扰的干净判据
            press_ok = []
            for frac in (0.15, 0.5, 0.85):
                pos = page.evaluate(
                    """(f) => {
                      const bar = document.querySelector('.pw-bar.vol');
                      const L = bar.querySelector('[data-pw-axis="left"]').getBoundingClientRect();
                      const R = bar.querySelector('[data-pw-axis="right"]').getBoundingClientRect();
                      return { x: Math.round(L.left + (R.left - L.left) * f),
                               y: Math.round(L.top + (R.top - L.top) * f) };
                    }""",
                    frac,
                )
                page.mouse.move(pos["x"], pos["y"])
                page.mouse.down()
                page.wait_for_timeout(120)
                page.mouse.up()
                page.wait_for_timeout(120)
                vol = page.evaluate("() => document.querySelector('audio').volume")
                press_ok.append(abs(vol - frac) < 0.05)
            row = {
                "屏幕": label,
                "按下取值": press_ok,
                "缩放": zoom_label,
                "CSS视口": f"{vw}x{vh}",
                "z": data["z"],
                "手机在视口内": inside,
                "横向溢出": data["overflowX"],
                "分页按钮": f"{round(data['pageBtn']['w'])}x{round(data['pageBtn']['h'])}" if data["pageBtn"] else None,
                "滑杆命中": data["barHit"],
                "磁贴命中": data["tileHit"],
                "迷你栏可见": data["miniVisible"],
            }
            rows.append(row)
            page.close()
    return rows


def small_matrix(browser):
    rows = []
    for label, w, h in SMALL:
        page = browser.new_page(viewport={"width": w, "height": h})
        page.goto(BASE + "/", wait_until="load")
        page.wait_for_timeout(900)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=20000)
        page.locator(".pw-tab").first.click()
        page.wait_for_timeout(2200)
        data = page.evaluate(PROBE)
        rows.append(
            {
                "屏幕": label,
                "CSS视口": f"{w}x{h}",
                "z": data["z"],
                "横向溢出": data["overflowX"],
                "分页按钮": f"{round(data['pageBtn']['w'])}x{round(data['pageBtn']['h'])}" if data["pageBtn"] else None,
                "滑杆命中": data["barHit"],
                "磁贴命中": data["tileHit"],
                "迷你栏可见": data["miniVisible"],
            }
        )
        page.close()
    return rows


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        desk = desktop_matrix(browser)
        small = small_matrix(browser)
        browser.close()

    print("== 桌面：3 视口 × 3 缩放档 ==")
    for r in desk:
        ok_overflow = r["横向溢出"] <= 0
        ok_hit = all(r["滑杆命中"]) and r["磁贴命中"] and r["分页按钮"]
        print(
            f"  {r['屏幕']:<10} {r['缩放']:<5} CSS={r['CSS视口']:<10} z={r['z']:<5} "
            f"在视口内={'✓' if r['手机在视口内'] else '✗'} "
            f"横向溢出={'✓' if ok_overflow else f'✗ {r[chr(27124)+chr(21521)+chr(28322)+chr(20986)]}'} "
            f"滑杆={'✓' if all(r['滑杆命中']) else str(r['滑杆命中'])} "
            f"磁贴={'✓' if r['磁贴命中'] else '✗'} "
            f"分页按钮={r['分页按钮']} 迷你栏={'✓' if r['迷你栏可见'] else '✗'} "
            f"按下取值={'✓' if all(r['按下取值']) else str(r['按下取值'])}"
        )
    print("\n== 小屏：全屏手机 ==")
    for r in small:
        print(
            f"  {r['屏幕']:<5} CSS={r['CSS视口']:<9} z={r['z']:<5} "
            f"横向溢出={'✓' if r['横向溢出'] <= 0 else '✗'} "
            f"滑杆={'✓' if all(r['滑杆命中']) else str(r['滑杆命中'])} "
            f"磁贴={'✓' if r['磁贴命中'] else '✗'} "
            f"分页按钮={r['分页按钮']} 迷你栏={'✓' if r['迷你栏可见'] else '（小屏不显示，预期 ✓）'}"
        )

    failures = []
    for r in desk:
        if not r["手机在视口内"]:
            failures.append(f"{r['屏幕']}@{r['缩放']}: 手机超出视口")
        if r["横向溢出"] > 0:
            failures.append(f"{r['屏幕']}@{r['缩放']}: 横向溢出 {r['横向溢出']}px")
        if not all(r["滑杆命中"]):
            failures.append(f"{r['屏幕']}@{r['缩放']}: 滑杆命中不全 {r['滑杆命中']}")
        if not all(r["按下取值"]):
            failures.append(f"{r['屏幕']}@{r['缩放']}: 音量按下取值不准 {r['按下取值']}")
        if not r["磁贴命中"]:
            failures.append(f"{r['屏幕']}@{r['缩放']}: 磁贴不可点")
        if r["分页按钮"] is None:
            failures.append(f"{r['屏幕']}@{r['缩放']}: 分页按钮缺失")
    for r in small:
        if r["横向溢出"] > 0:
            failures.append(f"小屏 {r['屏幕']}: 横向溢出 {r['横向溢出']}px")
        if not all(r["滑杆命中"]):
            failures.append(f"小屏 {r['屏幕']}: 滑杆命中不全 {r['滑杆命中']}")
        if r["迷你栏可见"]:
            failures.append(f"小屏 {r['屏幕']}: 迷你栏不该显示")

    print("\n== 失败项 ==")
    if failures:
        for f in failures:
            print(f"  ✗ {f}")
        print(json.dumps({"failures": failures}, ensure_ascii=False))
        return 1
    print("  （无 ✓）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
