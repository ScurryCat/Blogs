#!/usr/bin/env python3
"""演示内容 + 手机 deep link 验收（2026-10-17 · 用户反馈 R3）。

两层断言：
  1) 数据层（HTTP，默认 API 8100）：9 个界面的公开内容量达到约定阈值；
  2) 页面层（Playwright，默认前端 localhost:3131）：每个独立界面能打开、能显示演示内容、
     没有失败态；13 个手机 deep link 逐个验证能打开对应应用（无效 id 安全回退桌面）。

截图输出：.dsh/screenshots/demo/
退出码：0 = 全部通过；1 = 有失败。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

os.environ.setdefault("no_proxy", "127.0.0.1,localhost,::1")
os.environ.setdefault("NO_PROXY", os.environ["no_proxy"])

REPO = Path(__file__).resolve().parents[1]
API_DIR = REPO / "apps/api"
OUT_DIR = REPO / ".dsh/screenshots/demo"

THRESHOLDS = (
    ("殿堂作品", "/api/v1/projects?limit=30", 5),
    ("图库相册", "/api/v1/gallery/albums?limit=30", 3),
    ("放课后", "/api/v1/leisure/entries?limit=30", 6),
    ("COOP 友链", "/api/v1/coop/links?limit=30", 5),
    ("手记", "/api/v1/journal/entries?limit=30", 8),
    ("导航专题", "/api/v1/nav/palaces?limit=30", 4),
    ("天鹅绒技能", "/api/v1/skills?limit=30", 9),
    ("印象空间记录", "/api/v1/exploration/records?limit=30", 11),
)

FAIL_WORDS = ("读取失败", "暂时读不到", "暂时不可用", "连不上接口", "FAILED")


def boot(page) -> None:
    page.wait_for_timeout(1500)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        try:
            page.wait_for_selector("#boot", state="detached", timeout=8000)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(500)
    try:
        close = page.locator(".poll-close").first
        if close.count():
            close.click(timeout=1200)
            page.wait_for_timeout(200)
    except Exception:  # noqa: BLE001
        pass


def http_counts(api: str) -> tuple[dict[str, int], list[str]]:
    counts: dict[str, int] = {}
    failures: list[str] = []
    for label, path, threshold in THRESHOLDS:
        try:
            with urllib.request.urlopen(api + path, timeout=15) as response:
                payload = json.loads(response.read())
            count = len(payload.get("items") or [])
        except Exception as error:  # noqa: BLE001
            failures.append(f"{label}: 读取失败 {str(error)[:120]}")
            continue
        counts[label] = count
        if count < threshold:
            failures.append(f"{label}: {count} < 目标 {threshold}")
    return counts, failures


def im_content_check() -> list[str]:
    """IM 内容加长通过后端剧本自检（节点数 / 版本），不依赖浏览器。"""
    code = (
        "from app.modules.messaging import stories;"
        "print(','.join(f'{s.character_id}:{s.version}:{len(s.nodes)}' for s in stories.STORIES))"
    )
    env = dict(os.environ)
    env.update(
        {
            "UV_CACHE_DIR": str(REPO / ".dsh/uv-cache"),
            "SECRET_KEY": "demo-verify-placeholder-0123456789",
            "DATABASE_URL": "postgresql+psycopg://pl@127.0.0.1:55432/pl_test",
        }
    )
    result = subprocess.run(
        ["uv", "run", "python", "-c", code],
        cwd=API_DIR,
        env=env,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        return [f"IM 剧本读取失败：{(result.stderr or result.stdout)[-200:]}"]
    failures: list[str] = []
    raw = result.stdout.strip().splitlines()[-1]
    print(f"  IM 剧本：{raw}")
    for item in raw.split(","):
        parts = item.split(":")
        if len(parts) != 3:
            continue
        character, version, nodes = parts
        minimum = 12 if character == "futaba" else 10
        if int(nodes) < minimum:
            failures.append(f"IM 角色 {character} 节点数 {nodes} < {minimum}")
        if version != "1.1.0":
            failures.append(f"IM 角色 {character} 剧本版本 {version} ≠ 1.1.0")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base", nargs="?", default="http://localhost:3131")
    parser.add_argument("--api", default="http://127.0.0.1:8100")
    parser.add_argument("--json", default="")
    args = parser.parse_args()
    BASE = args.base.rstrip("/")
    API = args.api.rstrip("/")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    print("== 数据层：公开内容量 ==")
    counts, count_failures = http_counts(API)
    for label, _, threshold in THRESHOLDS:
        value = counts.get(label)
        print(f"  {'✓' if value is not None and value >= threshold else '✗'} {label}: {value}（目标 ≥{threshold}）")
    failures.extend(count_failures)
    failures.extend(im_content_check())

    # 页面层：独立界面
    pages = [
        ("/showcase", "showcase", "可访问性审计工具集"),
        ("/gallery?view=albums", "gallery-albums", "日常碎片"),
        ("/velvet", "velvet", "可访问性审计"),
        ("/apps/metanav", "metanav", "第四面墙"),
        ("/apps/coop", "coop", "MDN Web Docs"),
        ("/apps/leisure", "leisure", "葬送的芙莉莲"),
        ("/apps/journal", "journal", "系统代理骗了我一次"),
        ("/apps/metanav/mementos", "mementos", "aria-controls"),
    ]
    # 手机 deep link：id + 期望文案（None = 只要手机打开且不崩）
    phone_links = [
        ("home", None, "手机桌面"),
        ("ins", None, "INS 动态"),
        ("ins&screen=messages", "双叶", "IM 角色列表"),
        ("ins&screen=conversation&item=futaba", "双叶", "IM 与双叶的会话"),
        ("journal", "系统代理骗了我一次", "手记"),
        ("journal&screen=calendar", None, "手记日历"),
        ("leisure", "葬送的芙莉莲", "放课后"),
        ("leisure&screen=game", "Persona 5 Royal", "放课后·游戏"),
        ("coop", "Next.js 文档", "COOP"),
        ("showcase", "可访问性审计工具集", "殿堂"),
        # 殿堂的 photos/album 屏幕按设计是「转发旧手机深链到 /gallery」，会关掉手机；
        # 这里单独断言重定向，而不是要求手机还开着。
        ("showcase&screen=photos", "@redirect:/gallery", "殿堂·照片墙（转发到 /gallery）"),
        ("metanav", None, "导航"),
        ("metanav&screen=resolve", None, "导航·认知定位"),
        ("velvet", "可访问性审计", "天鹅绒"),
        ("mementos", "aria-controls", "印象空间"),
        ("palace", None, "旧站链接·情报"),
        ("tokyo", None, "旧站链接·地图"),
        ("cast", None, "旧站链接·天气"),
        ("profile", None, "旧站链接·档案"),
        ("nosuchapp", None, "无效 id 安全回退"),
    ]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        for path, name, keyword in pages:
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)[:120]))
            page.goto(BASE + path, wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(1600)
            text = page.locator("main").inner_text() if page.locator("main").count() else page.content()
            if keyword not in text:
                failures.append(f"页面 {path}: 未找到演示内容关键词「{keyword}」")
            for word in FAIL_WORDS:
                if word in text:
                    failures.append(f"页面 {path}: 出现失败态「{word}」")
                    break
            if errors:
                failures.append(f"页面 {path}: JS 错误 {errors[:1]}")
            page.screenshot(path=str(OUT_DIR / f"page-{name}.png"))
            page.close()

        for spec, keyword, label in phone_links:
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)[:120]))
            page.goto(f"{BASE}/?phone={spec}", wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(1500)
            if keyword and keyword.startswith("@redirect:"):
                target = keyword.split("@redirect:", 1)[1]
                from urllib.parse import urlparse
                pathname = urlparse(page.url).path
                if pathname != target:
                    failures.append(f"deep link phone={spec}（{label}）: 期望转发到 {target}，实际 {pathname}")
                if errors:
                    failures.append(f"deep link phone={spec}: JS 错误 {errors[:1]}")
                page.close()
                continue
            opened = page.locator(".pw-wrap.on").count() > 0
            if not opened:
                failures.append(f"deep link phone={spec}: 手机没有打开")
            if keyword:
                body = page.locator(".pw-wrap.on").inner_text() if opened else ""
                if keyword not in body:
                    failures.append(f"deep link phone={spec}（{label}）: 未找到「{keyword}」")
            if errors:
                failures.append(f"deep link phone={spec}: JS 错误 {errors[:1]}")
            if label in ("IM 角色列表", "殿堂", "手记"):
                page.screenshot(path=str(OUT_DIR / f"phone-{spec.replace('&', '-').replace('=', '_')}.png"))
            page.close()
        browser.close()

    print("\n== 失败项 ==")
    if failures:
        for item in failures:
            print(f"  ✗ {item}")
        if args.json:
            Path(args.json).write_text(json.dumps({"failures": failures, "counts": counts}, ensure_ascii=False, indent=1), encoding="utf-8")
        return 1
    print("  （无 ✓）")
    print(f"\n截图：{OUT_DIR}")
    if args.json:
        Path(args.json).write_text(json.dumps({"failures": [], "counts": counts}, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
