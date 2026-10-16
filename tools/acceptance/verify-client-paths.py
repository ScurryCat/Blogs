#!/usr/bin/env python3
"""客户端取数路径审计：走遍桌面页面与手机应用，记录所有 `/api/v1` 失败响应。

**为什么需要这个脚本**（2026-10-16 的教训，连续两轮踩到）：
集成 T06 后，我在手机里点开「殿堂」看到 Not Found，追下去发现**两个不同的缺陷**：

  1. `apiRequest` 无条件拼 `base + path`，而调用点传了已经带 `/api/v1` 的绝对路径
     → 请求变成 `/api/v1/api/v1/projects`；
  2. 作品详情把**页面路径** `projectPath()`（`/showcase/projects/<slug>`）当 API 路径用
     → 请求变成 `/api/v1/showcase/projects/<slug>`。

两者的共同点，也是**四个包各自的浏览器套件都没抓到的原因**：

    服务端渲染的同一页面是**好的**（服务端自己拼完整地址），
    只有**客户端交互**（加载更多、筛选）与**手机里的取数**才暴露。

所以这里不再依赖「页面能打开」这种判断，而是直接看**每一发 `/api/v1` 请求的响应码**，
并把手机作为重点表面（两个缺陷都在那里现形）。

前置：
  1. API：`uv run uvicorn app.main:app --port 8100`（`DATABASE_URL` 指向已迁移的库）
  2. 新站：`cd apps/web && DEV_API_URL=http://127.0.0.1:8100 npx next start -p 3100`
  3. 运行：`python3 tools/acceptance/verify-client-paths.py`

退出码 0 = 没有非预期失败。**401 是允许的**（管理端点在未登录时本就该拒绝）。
"""

from __future__ import annotations

import collections
import sys

BASE = "http://127.0.0.1:3100"

PAGES = [
    "/", "/about", "/map", "/weather", "/guestbook",
    "/showcase", "/showcase/photos",
    "/apps/ins", "/apps/coop", "/apps/journal", "/apps/leisure", "/apps/leblanc", "/apps/metanav",
    "/admin/projects", "/admin/albums", "/admin/friends", "/admin/journal", "/admin/leisure",
    "/admin/messages",
]

APPS = ["ins", "journal", "leisure", "coop", "metanav", "showcase",
        "palace", "tokyo", "cast", "profile"]

# 管理端点在未登录时返回 401 是**正确行为**，不算失败。
ALLOWED = {401}


def main() -> int:
    from playwright.sync_api import sync_playwright

    calls: collections.Counter[int] = collections.Counter()
    fails: dict[int, set[str]] = collections.defaultdict(set)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def observe(page):
            def on_response(r):
                url = r.url.replace(BASE, "").split("?")[0]
                if "/api/v1/" not in url:
                    return
                calls[r.status] += 1
                if r.status >= 400 and r.status not in ALLOWED:
                    fails[r.status].add(url)
            page.on("response", on_response)

        # --- 桌面页面 -------------------------------------------------------
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        observe(page)
        for path in PAGES:
            page.goto(BASE + path, wait_until="load", timeout=25000)
            page.wait_for_timeout(1100)
            if page.locator("#boot").count():
                page.keyboard.press("Enter")
                page.wait_for_selector("#boot", state="detached", timeout=6000)
            page.wait_for_timeout(1300)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(900)
            for selector in ("button:not([type=submit])", "a[href^='/showcase']"):
                elements = page.locator(selector)
                for i in range(min(elements.count(), 4)):
                    try:
                        elements.nth(i).click(timeout=1500)
                        page.wait_for_timeout(600)
                    except Exception:
                        pass
        page.close()

        # --- 手机（两个缺陷都在这里现形，重点审计）---------------------------
        phone = browser.new_page(viewport={"width": 390, "height": 844})
        observe(phone)
        for app in APPS:
            phone.goto(f"{BASE}/?phone={app}", wait_until="load")
            phone.wait_for_timeout(1000)
            if phone.locator("#boot").count():
                phone.keyboard.press("Enter")
                phone.wait_for_selector("#boot", state="detached", timeout=6000)
            try:
                phone.wait_for_function(
                    "() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=12000
                )
            except Exception:
                pass
            phone.wait_for_timeout(1500)
            for selector in (".pw-appview button", ".pw-appview a", ".pw-appview [role=tab]"):
                elements = phone.locator(selector)
                for i in range(min(elements.count(), 3)):
                    try:
                        elements.nth(i).click(timeout=1200)
                        phone.wait_for_timeout(600)
                    except Exception:
                        pass
        phone.close()
        browser.close()

    print(f"== /api/v1 响应分布 ==")
    for code, count in sorted(calls.items()):
        mark = "" if code < 400 or code in ALLOWED else "  ← 非预期"
        note = "（管理端点未登录，预期）" if code in ALLOWED else ""
        print(f"  {code}: {count} 次{mark}{note}")
    print("\n== 非预期的失败端点 ==")
    if not fails:
        print("  （无 ✓）")
    for code in sorted(fails):
        for url in sorted(fails[code]):
            print(f"  ✗ {code} {url}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
