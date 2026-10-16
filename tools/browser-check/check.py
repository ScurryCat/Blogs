#!/usr/bin/env python3
"""旧站浏览器回归：把 tests/*-browser.html 从「人工点开」变成可复现命令。

背景：旧站的浏览器检查页需要人工点击 #run 并肉眼读结果，因此验收清单里的
「浏览器证据」一直无法自动收集。这个脚本用系统 Python 的 Playwright 驱动真实
Chromium，跑完断言并以退出码报告结果。

依赖（**刻意不进任何 pyproject / package.json**，属开发机工具）：
    python3 -m playwright install chromium     # 已装则跳过
    系统 Python 3.13 需有 playwright 包

用法：
    python3 tools/browser-check/check.py                       # 跑全部页面
    python3 tools/browser-check/check.py --page poll           # 只跑一个
    python3 tools/browser-check/check.py --shots DIR           # 额外截图

前置：旧站静态预览在跑，默认 127.0.0.1:8000（与仓库既有约定一致）：
    python3 -m http.server 8000
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from dataclasses import dataclass, field

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - 环境问题要给出可执行的提示
    print(
        "缺少 playwright。请先安装：python3 -m pip install playwright && "
        "python3 -m playwright install chromium",
        file=sys.stderr,
    )
    raise SystemExit(2)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
RESULTS_ID = "#results"


@dataclass
class Page:
    """一个浏览器检查页的判定规则。

    done_markers：结果文本里出现任一即视为跑完（成功或失败由 fail_markers 决定）。
    settle_ms：没有终态标记的页面（例如逐条累加结果的）用「文本稳定」判定跑完，
               这是启发式，因此下面同时保留了失败标记。
    """

    slug: str
    path: str
    title: str
    done_markers: tuple[str, ...] = ()
    fail_markers: tuple[str, ...] = ("FAIL ", "检查中止")
    settle_ms: int = 0
    ready_selector: str | None = None
    shots: tuple[tuple[str, str, dict], ...] = field(default_factory=tuple)


PAGES: tuple[Page, ...] = (
    Page(
        slug="poll",
        path="tests/poll-browser.html",
        title="问卷生命周期与视觉断言",
        done_markers=("ALL BROWSER CHECKS PASSED", "FAIL "),
    ),
    Page(
        slug="crowd",
        path="tests/crowd-browser.html",
        title="地图过场人群渲染断言",
        # 该页逐条累加结果且没有终态文案，只能靠「文本稳定」判定；失败仍有标记。
        settle_ms=2500,
        ready_selector="#readiness",
    ),
)


def run_page(browser, base: str, page_spec: Page, shot_dir: pathlib.Path | None) -> tuple[bool, list[str]]:
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto(f"{base}/{page_spec.path}", wait_until="load")

    if page_spec.ready_selector:
        try:
            page.wait_for_function(
                "sel => { const el = document.querySelector(sel);"
                " return !el || /就绪|ready|完成/i.test(el.textContent); }",
                arg=page_spec.ready_selector,
                timeout=20_000,
            )
        except Exception:
            pass  # 就绪文案不是判定依据，交给断言本身

    page.click("#run")

    if page_spec.done_markers:
        literals = ", ".join(repr(marker) for marker in page_spec.done_markers)
        page.wait_for_function(
            f"() => {{ const t = document.getElementById('results').textContent;"
            f" return [{literals}].some(m => t.includes(m)); }}",
            timeout=60_000,
        )
    elif page_spec.settle_ms:
        previous = None
        for _ in range(120):
            current = page.inner_text(RESULTS_ID)
            if current and current == previous:
                break
            previous = current
            page.wait_for_timeout(page_spec.settle_ms // 10)
        page.wait_for_timeout(page_spec.settle_ms // 5)

    text = page.inner_text(RESULTS_ID)
    lines = [line for line in text.splitlines() if line.strip()]

    if shot_dir:
        shot_dir.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(shot_dir / f"{page_spec.slug}-browser-check.png"), full_page=True)

    page.close()

    failed = [line for line in lines if any(marker in line for marker in page_spec.fail_markers)]
    passed = [line for line in lines if line.startswith("PASS")]
    ok = not failed and bool(passed)
    return ok, lines


def main() -> int:
    parser = argparse.ArgumentParser(description="旧站浏览器回归")
    parser.add_argument("--base", default="http://127.0.0.1:8000", help="旧站预览地址")
    parser.add_argument("--page", action="append", choices=[p.slug for p in PAGES], help="只跑指定页面")
    parser.add_argument("--shots", type=pathlib.Path, default=None, help="截图输出目录")
    parser.add_argument("--headed", action="store_true", help="显示浏览器窗口（调试用）")
    args = parser.parse_args()

    selected = [p for p in PAGES if not args.page or p.slug in args.page]
    exit_code = 0

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not args.headed)
        for page_spec in selected:
            print(f"=== {page_spec.slug} · {page_spec.title} ===")
            try:
                ok, lines = run_page(browser, args.base, page_spec, args.shots)
            except Exception as error:
                print(f"  运行失败：{type(error).__name__}: {error}")
                exit_code = 1
                continue
            for line in lines:
                print(f"  {line}")
            print(f"  → {'通过' if ok else '未通过'}\n")
            if not ok:
                exit_code = 1
        browser.close()

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
