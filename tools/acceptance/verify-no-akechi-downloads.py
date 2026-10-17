#!/usr/bin/env python3
"""N6 / N7 复验：浏览器**实际下载**的文件中不得含明智吾郎素材，且公开目录替换资源可用。

第三轮 P5 内容架构 v3 · 任务书 §5.2 / §8.3。
前置：`cd apps/web && npm run build && npx next start -p 3102 -H 127.0.0.1`
（本脚本不依赖仓库 package.json；用系统 Python 的 Playwright + 系统 Chromium，与
`tools/browser-check/check.py` 同一约定。）

用法：
    python3 tools/acceptance/verify-no-akechi-downloads.py
    python3 tools/acceptance/verify-no-akechi-downloads.py --base-url http://127.0.0.1:3102

检查内容：
  1. 访问 /、/posts/p5r-platinum、/map、/gallery、/apps/coop、/showcase、/about，
     收集浏览器真实请求的 `/assets/**` 响应，逐个下载字节算 SHA-256：
     - 不得命中 3 个含明智原文件哈希；
     - 文件名不得含明智别名（akechi/goro/明智/あけち/クロウ/black-mask；`crow` 仅当不是 crowd）。
  2. `/assets/legacy/img/icon/crow.webp`、`/assets/legacy/img/band-halftone.jpg` 必须 404。
  3. p5r-platinum 文章封面：`img[src*=platinum]` 成功解码（naturalWidth>0），截图存档。
  4. crowd 人群过场 12 张 original 精灵：HTTP 200 且哈希与 provenance.json 一致。
  5. N5 过场短版 `clip/isekai-showcase.webm` HTTP 200，打印哈希。

截图与证据输出：`/Users/学习/blog/.dsh/screenshots/n6-*.png` 与
`/Users/学习/blog/.dsh/screenshots/n6-download-evidence.json`。
退出码 0 = 全部通过。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[2]
PUBLIC = REPO / "apps/web/public"
OUT = pathlib.Path("/Users/学习/blog/.dsh/screenshots")
CROWD_DIR = PUBLIC / "assets/legacy/img/crowd/original"
BANNED_SHA256 = {
    "2c94638757c68b665742067376ce8abeb375b31749311cd7420c400430e9c58e": "icon/crow.webp（明智头像）",
    "085e6df989e982f1c92f83ab6606c10fb4b2f2d229fb11eb0b3011c9a8bad2d6": "cover/platinum.jpg 原版（明智立绘）",
    "f6eade8ed6710a3f6b16317cbda8521b34ca57d1962b81d954c73a49352519db": "band-halftone.jpg 原版",
}
REMOVED = [
    "/assets/legacy/img/icon/crow.webp",
    "/assets/legacy/img/band-halftone.jpg",
]
PAGES = [
    ("home", "/"),
    ("post-platinum", "/posts/p5r-platinum"),
    ("map", "/map"),
    ("gallery", "/gallery"),
    ("coop", "/apps/coop"),
    ("showcase", "/showcase"),
    ("about", "/about"),
]
SHOTS = OUT


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3102")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    downloads: dict[str, dict] = {}
    shots: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        collected: list[str] = []

        def on_response(resp) -> None:
            url = resp.url
            path = pathlib.Path(url.split(base, 1)[-1]) if base in url else pathlib.Path(url)
            if "/assets/" in url and str(path).startswith("/assets/"):
                collected.append(url)

        page.on("response", on_response)
        for name, route in PAGES:
            page.goto(base + route, wait_until="networkidle")
            page.screenshot(path=str(SHOTS / f"n6-{name}-desktop.png"), full_page=True)
            shots.append(str(SHOTS / f"n6-{name}-desktop.png"))

        # 打开一次手机桌面（COOP / 印象空间图标所在 UI），额外截图。
        try:
            page.goto(base + "/", wait_until="networkidle")
            # 开机画面（#boot）会拦截点击；按 Enter / 点击一次跳过。
            try:
                if page.locator("#boot").count():
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(900)
            except Exception:  # noqa: BLE001 - 跳过失败不影响后续
                pass
            tab = page.locator(".pw-tab").first
            if tab.count():
                tab.click()
                page.wait_for_timeout(600)
                page.screenshot(path=str(SHOTS / "n6-phone-desktop-desktop.png"))
                shots.append(str(SHOTS / "n6-phone-desktop-desktop.png"))
                # 打开 COOP 应用，确认图标（app/coop.png）真实加载
                coop = page.locator('[data-app-id="coop"]').first
                if coop.count():
                    coop.click()
                    page.wait_for_timeout(600)
                    page.screenshot(path=str(SHOTS / "n6-phone-coop-desktop.png"))
                    shots.append(str(SHOTS / "n6-phone-coop-desktop.png"))
        except Exception as exc:  # noqa: BLE001 - 手机 UI 只是补充证据，不阻塞资源复验
            print(f"[WARN] 手机 UI 截图/交互失败：{exc}", file=sys.stderr)

        # 1) 逐一下载浏览器真实请求过的 /assets/** 文件并校验
        request = context.request
        for url in sorted(set(collected)):
            path = url.split(base, 1)[-1].split("?")[0]
            try:
                resp = request.get(url)
                body = resp.body()
            except Exception as exc:  # noqa: BLE001
                problems.append(f"{path} 下载失败：{exc}")
                continue
            digest = sha(body)
            downloads[path] = {"status": resp.status, "bytes": len(body), "sha256": digest}
            if digest in BANNED_SHA256:
                problems.append(f"{path} 命中含明智原文件哈希（{BANNED_SHA256[digest]}）")
            lowered = path.lower()
            if any(alias in lowered for alias in ("akechi", "goro", "明智", "あけち", "クロウ", "black-mask")):
                problems.append(f"{path} 文件名含明智别名")
            if "crow" in lowered and "crowd" not in lowered:
                problems.append(f"{path} 文件名含 crow（非 crowd）")

        # 2) 被移除资源必须 404
        for path in REMOVED:
            resp = request.get(base + path)
            if resp.status != 404:
                problems.append(f"{path} 期望 404，实际 {resp.status}")

        # 3) p5r-platinum 封面真实加载 + 截图
        page.goto(base + "/posts/p5r-platinum", wait_until="networkidle")
        cover = page.locator('img[src*="platinum"]').first
        if cover.count():
            natural = cover.evaluate("el => el.naturalWidth")
            if not natural:
                problems.append("p5r-platinum 封面图未成功解码（naturalWidth=0，破图）")
            cover.screenshot(path=str(SHOTS / "n6-platinum-cover-desktop.png"))
            shots.append(str(SHOTS / "n6-platinum-cover-desktop.png"))
        else:
            problems.append("p5r-platinum 页面未找到 platinum 封面图")
        narrow = browser.new_context(viewport={"width": 390, "height": 844})
        npage = narrow.new_page()
        npage.goto(base + "/posts/p5r-platinum", wait_until="networkidle")
        npage.screenshot(path=str(SHOTS / "n6-post-platinum-narrow.png"), full_page=True)
        shots.append(str(SHOTS / "n6-post-platinum-narrow.png"))

        # 4) crowd 12 张 original 精灵：200 + 哈希与 provenance 一致
        prov = json.loads((CROWD_DIR / "provenance.json").read_text(encoding="utf-8"))
        for entry in prov["sprites"]:
            path = f"/assets/legacy/img/crowd/original/{entry['file']}"
            resp = request.get(base + path)
            if resp.status != 200:
                problems.append(f"{path} 期望 200，实际 {resp.status}")
                continue
            if sha(resp.body()) != entry["sha256"]:
                problems.append(f"{path} 哈希与 provenance 不一致")

        # 5) N5 短版媒体
        media_path = "/assets/clip/isekai-showcase.webm"
        resp = request.get(base + media_path)
        if resp.status != 200:
            problems.append(f"{media_path} 期望 200，实际 {resp.status}")
        else:
            downloads[media_path] = {"status": 200, "bytes": len(resp.body()), "sha256": sha(resp.body())}
        browser.close()

    evidence = {
        "base_url": base,
        "pages": [p for _, p in PAGES],
        "downloaded_asset_count": len(downloads),
        "downloads": downloads,
        "screenshots": shots,
        "problems": problems,
    }
    (OUT / "n6-download-evidence.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if problems:
        print(f"FAIL: {len(problems)} 项问题（浏览器实际下载/页面）", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(
        f"PASS: 浏览器实际下载 {len(downloads)} 个 /assets 文件均无明智素材；"
        f"被移除 2 个 URL 均 404；platinum 封面正常；crowd 12/12 哈希一致。"
    )
    print(f"证据：{OUT / 'n6-download-evidence.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
