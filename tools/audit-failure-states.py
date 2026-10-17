#!/usr/bin/env python3
"""真实浏览器「接口不可用」失败态巡检（Playwright + Chromium，无新依赖）。

背景：站点验收要求「读取失败必须如实显示失败原因，绝不降级成『没有内容』」。
本脚本在**接口不可用**的前端实例上逐页检查：失败原因、重试入口、以及有没有被 Next
错误覆盖层占据；同时把「不依赖 API 的页面」列为不受影响（posts 走本地静态数据、
guestbook 是本机存储示例、weather 走外部气象接口）。

前置（脚本不负责起服务）：
    # 一个正常能打开、但 API 指向死端口的 dev 实例（端口自定，例如 3132）：
    cd apps/web && API_INTERNAL_URL=http://127.0.0.1:9 DEV_API_URL=http://127.0.0.1:9 \\
        npx next dev -p 3132
    # 运行：
    python3 tools/audit-failure-states.py http://localhost:3132

用法：python3 tools/audit-failure-states.py [BASE] [--json OUT]
退出码：0 = 所有「应显示失败态」的页面都显示了失败原因；1 = 有页面静默降级/报错。
"""

from __future__ import annotations

import argparse
import json
import sys

from playwright.sync_api import sync_playwright

# 依赖 API 的页面：接口不可用时**必须**出现失败原因（不能显示空态/正常内容）。
API_PAGES = {
    "home": "/",
    "about": "/about",
    "showcase": "/showcase",
    "gallery": "/gallery",
    "gallery-albums": "/gallery?view=albums",
    "velvet": "/velvet",
    "metanav": "/apps/metanav",
    "coop": "/apps/coop",
    "leisure": "/apps/leisure",
    "journal": "/apps/journal",
    "mementos": "/apps/metanav/mementos",
}
# 不依赖站点 API 的页面：不要求失败态，但要求「不崩、无 Next 错误覆盖层」。
STATIC_PAGES = {
    "posts": "/posts",
    "post-article": "/posts/phantom-blog-launch",
    "guestbook": "/guestbook",
    "weather": "/weather",
}
FAIL_WORDS = ("失败", "不可用", "无法", "连不上", "暂时", "读取不到", "读不出来", "重新读取", "重新加载", "重试")

JS = r"""
() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const states = [...document.querySelectorAll(
    "[role=alert], [data-load-more-error], [class*=state], [class*=notice], [class*=alert], [class*=empty], [class*=error]",
  )]
    .filter(visible)
    .map((el) => ({
      cls: String(el.className || "").slice(0, 48),
      role: el.getAttribute("role") || "",
      text: (el.textContent || "").trim().slice(0, 120),
    }))
    .filter((item) => item.text.length > 0)
    .slice(0, 10);
  const retries = [...document.querySelectorAll("button, a")]
    .filter(visible)
    .map((el) => (el.textContent || "").trim())
    .filter((text) => /重试|重新读取|重新加载/.test(text))
    .slice(0, 6);
  const nextErrorOverlay = Boolean(
    document.querySelector("nextjs-portal [data-nextjs-dialog], nextjs-portal [data-nextjs-error-overlay]"),
  );
  return { states, retries, nextErrorOverlay };
}
"""


def boot(page) -> None:
    page.wait_for_timeout(1600)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(600)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://localhost:3132")
    parser.add_argument("--json", default="")
    args = parser.parse_args()

    report: dict[str, dict] = {}
    failures: dict[str, str] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        for kind, pages in (("api", API_PAGES), ("static", STATIC_PAGES)):
            for name, path in pages.items():
                page = context.new_page()
                page_errors: list[str] = []
                page.on("pageerror", lambda error: page_errors.append(str(error)[:120]))
                try:
                    page.goto(args.base + path, wait_until="load", timeout=30000)
                    boot(page)
                    page.wait_for_timeout(2500)
                    info = page.evaluate(JS)
                    info.update({"kind": kind, "path": path, "page_errors": page_errors[:1]})
                    report[name] = info
                    joined = " ".join(state["text"] for state in info["states"])
                    if info["nextErrorOverlay"]:
                        failures[name] = "被 Next 错误覆盖层占据"
                    elif page_errors:
                        failures[name] = "页面 JS 错误：" + page_errors[0]
                    elif kind == "api" and not any(word in joined for word in FAIL_WORDS):
                        failures[name] = "接口不可用时没有显示失败原因（疑似静默降级）"
                except Exception as error:  # noqa: BLE001 - 单页失败不中断整轮
                    report[name] = {"error": str(error)[:120]}
                    failures[name] = "页面无法打开：" + str(error)[:80]
                page.close()
        browser.close()

    for name, info in report.items():
        if "error" in info:
            print(f"✗ {name}: {info['error']}")
            continue
        text = " / ".join(state["text"] for state in info["states"])[:110]
        retries = "、".join(info["retries"]) or "（无）"
        print(f"{'✗' if name in failures else '✓'} {name}: {text or '（无状态块）'} | 重试：{retries}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump({"report": report, "failures": failures}, handle, ensure_ascii=False, indent=1)
    if failures:
        print(json.dumps({"failures": failures}, ensure_ascii=False, indent=1))
        return 1
    print("✓ 失败态巡检通过：接口不可用时所有依赖页面都如实显示失败原因。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
