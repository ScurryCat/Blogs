#!/usr/bin/env python3
"""真实浏览器结构可及性巡检（Playwright + Chromium，无新依赖）。

检查项（全部为可机械判定的结构问题）：
  1. `<img>` 缺 `alt` 属性；
  2. 重复 `id`（无效 HTML，会打断 aria 引用 / label for）；
  3. `aria-controls` / `aria-labelledby` / `aria-describedby` 指向不存在的 id（无效 ARIA 引用）；
  4. 表单控件没有可访问名称（显式 label / 包裹 label / aria-label / placeholder）；
  5. 按钮与站内链接没有可访问名称（且不是 aria-hidden 装饰元素）；
  6. `main` 数量与文档标题（每页应恰有一个 main）；
  7. 标题层级跳过（h1→h3 之类，仅作为 best-practice 提示，不计为 WCAG 失败）。

用法：
    python3 tools/audit-structure.py [BASE] [--json OUT]
默认 BASE=http://127.0.0.1:3130（隔离栈前端）。

退出码：0 = 没有硬问题（1–6 类）；1 = 有硬问题。
"""

from __future__ import annotations

import argparse
import json
import sys

from playwright.sync_api import sync_playwright

PAGES = {
    "home": "/",
    "about": "/about",
    "posts": "/posts",
    "guestbook": "/guestbook",
    "showcase": "/showcase",
    "gallery": "/gallery",
    "gallery-album": "/gallery?scope=album&album=tokyo-nights",
    "velvet": "/velvet",
    "metanav": "/apps/metanav",
    "metanav-resolve": "/apps/metanav?screen=resolve",
    "coop": "/apps/coop",
    "leisure": "/apps/leisure",
    "journal": "/apps/journal",
    "journal-calendar": "/apps/journal?screen=calendar",
    "mementos": "/apps/metanav/mementos",
}

JS = r"""
() => {
  const out = {};
  // 1) 图片 alt
  out.imgMissingAlt = [...document.querySelectorAll('img:not([alt])')]
    .map((img) => img.getAttribute('src') || String(img.className))
    .slice(0, 5);
  out.imgCount = document.querySelectorAll('img').length;
  // 2) 重复 id
  const ids = {};
  for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  out.duplicateIds = Object.entries(ids).filter(([, count]) => count > 1).slice(0, 5);
  // 3) aria 引用
  const bad = [];
  for (const el of document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]')) {
    for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      for (const id of value.split(/\s+/)) {
        if (id && !document.getElementById(id)) bad.push({ attr, id, cls: String(el.className || '').slice(0, 40) });
      }
    }
  }
  out.brokenAriaRefs = bad.slice(0, 8);
  // 4) 表单可访问名称（显式 label / 包裹 label / aria / placeholder）
  const unlabeled = [];
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    const explicit = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    const wrapped = el.closest('label');
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder');
    if (!explicit && !wrapped && !aria) unlabeled.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 30) });
  }
  out.unlabeledFields = unlabeled.slice(0, 6);
  // 5) 按钮/链接可访问名称（排除 aria-hidden 装饰元素）
  const unnamed = [];
  for (const el of document.querySelectorAll('button, a[href]')) {
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const name = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!name) unnamed.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 36) });
  }
  out.unnamedControls = unnamed.slice(0, 6);
  // 6) main 数量 / 标题
  out.mainCount = document.querySelectorAll('main').length;
  out.title = document.title;
  // 7) 标题层级（best-practice）
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.textContent || '').trim().slice(0, 26),
  }));
  out.h1Count = heads.filter((h) => h.level === 1).length;
  const skips = [];
  let prev = 0;
  for (const h of heads) {
    if (prev && h.level > prev + 1) skips.push({ from: prev, to: h.level, text: h.text });
    prev = h.level;
  }
  out.headingSkips = skips.slice(0, 6);
  return out;
}
"""


def boot(page) -> None:
    page.wait_for_timeout(1300)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(400)


def dismiss_poll(page) -> None:
    try:
        button = page.locator(".poll-close").first
        if button.count():
            button.click(timeout=1000)
            page.wait_for_timeout(200)
    except Exception:  # noqa: BLE001
        pass


def hard_issues(info: dict) -> dict:
    """只统计会构成无效 HTML/ARIA 或命名缺失的硬问题（标题跳级不算）。"""
    return {
        key: info[key]
        for key in ("imgMissingAlt", "duplicateIds", "brokenAriaRefs", "unlabeledFields", "unnamedControls")
        if info.get(key)
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://127.0.0.1:3130")
    parser.add_argument("--json", default="")
    args = parser.parse_args()

    report: dict[str, dict] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        for name, path in PAGES.items():
            page = context.new_page()
            try:
                page.goto(args.base + path, wait_until="load", timeout=30000)
                boot(page)
                page.wait_for_timeout(1400)
                dismiss_poll(page)
                report[name] = page.evaluate(JS)
            except Exception as error:  # noqa: BLE001 - 单页失败不中断整轮
                report[name] = {"error": str(error)[:120]}
            page.close()
        browser.close()

    failures = {name: hard_issues(info) for name, info in report.items() if "error" not in info and hard_issues(info)}
    notes = {
        name: {"h1Count": info.get("h1Count"), "headingSkips": info.get("headingSkips")}
        for name, info in report.items()
        if "error" not in info and (info.get("h1Count") == 0 or info.get("headingSkips"))
    }
    print(
        json.dumps(
            {
                "pages": {name: ("error" if "error" in info else "ok") for name, info in report.items()},
                "hard_issue_pages": {name: list(issues) for name, issues in failures.items()},
                "best_practice_notes": notes,
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=1)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
