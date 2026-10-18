#!/usr/bin/env python3
"""视觉对照证据采集：17 张参考帧 ↔ 站点实际界面截图。

验收报告 §5.1 要求「补存档 / IM 等完整参考和视觉对照证据」。本脚本做两件事：
1. 用真实浏览器截取站点对应界面（桌面 1440×900，访客视角）；
2. 把参考帧与站点截图并排拼成对照图（`.dsh/screenshots/visual-comparison/`）。

**边界**：这是「参考帧可用 + 站点现状」的对照材料，**不是整屏还原验收通过**；
逐项差距与状态由 `docs/agent-deliveries/P4-visual-comparison-evidence.md` 人工判定。

用法：python3 tools/capture-visual-comparison.py [BASE]
"""

from __future__ import annotations

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100").rstrip("/")
OUT = pathlib.Path(".dsh/screenshots/visual-comparison")
CURATED = pathlib.Path("/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-curated/hud")

# 站点界面 → 对应参考帧（可多张）
SITES = [
    ("phone-home", "/?phone=home", ["p5-phone-home-fullframe.jpg", "p5r-street-hud-fullframe.jpg"]),
    ("im-list", "/?phone=ins&screen=messages", ["p5r-im-groupchat-fullframe.jpg"]),
    ("im-conversation", "/?phone=ins&screen=conversation&item=morgana", ["p5r-dialogue-choice-fullframe.jpg"]),
    ("im-conversation-photo", "/?phone=ins&screen=conversation&item=morgana", ["p5r-im-photo-fullframe.jpg"]),
    ("journal", "/apps/journal", ["p5-load-save-fullframe.jpg", "p5-calendar-fullframe.jpg"]),
    ("about", "/about", ["p5-status-fullframe.jpg"]),
    ("map", "/map", ["p5-map-school-fullframe.jpg", "p5-tokyo-map-fullframe.jpg"]),
    ("velvet", "/velvet", ["p5r-velvet-room-fullframe.jpg"]),
    ("mementos", "/apps/metanav/mementos", ["p5-mementos-fullframe.jpg"]),
    ("coop", "/apps/coop", ["p5r-coop-confidant-fullframe.jpg"]),
    ("showcase", "/showcase", ["p5-palace-treasure-fullframe.jpg"]),
    ("leisure", "/apps/leisure", ["p5-leisure-batting-fullframe.jpg"]),
]


def boot(page) -> None:
    page.wait_for_timeout(1500)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_timeout(1200)
    try:
        close = page.locator(".poll-close").first
        if close.count():
            close.click(timeout=1200)
            page.wait_for_timeout(200)
    except Exception:  # noqa: BLE001
        pass


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    shots: dict[str, str] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        for slug, path, _frames in SITES:
            page.goto(BASE + path, wait_until="load", timeout=60000)
            boot(page)
            page.wait_for_timeout(1800)
            # IM 图片消息对照：进入「这地方是什么」节点，让图片卡出现在截图里。
            if slug == "im-conversation-photo":
                try:
                    page.get_by_role("button", name="这地方是什么").click(timeout=5000)
                    page.wait_for_timeout(3500)
                except Exception:  # noqa: BLE001
                    pass
            file = OUT / f"site-{slug}.png"
            page.screenshot(path=str(file))
            shots[slug] = str(file)
            print(f"  ✓ {slug:<16} {path} → {file.name} | {page.title()[:40]}")
        browser.close()

    # 并排对照图（每行：参考帧 | 站点截图）
    try:
        from PIL import Image, ImageDraw, ImageFont

        font = ImageFont.truetype("/System/Library/Fonts/STHeiti Light.ttc", 15)
        pairs = []
        for slug, _path, frames in SITES:
            site_file = pathlib.Path(shots[slug])
            for frame in frames:
                ref = CURATED / frame
                if ref.exists() and site_file.exists():
                    pairs.append((slug, frame, ref, site_file))

        thumb = (640, 360)
        label_h = 26
        per_sheet = 5
        for sheet_idx in range(0, len(pairs), per_sheet):
            batch = pairs[sheet_idx : sheet_idx + per_sheet]
            canvas = Image.new("RGB", (2 * thumb[0] + 32, len(batch) * (thumb[1] + label_h + 10) + 10), (26, 26, 28))
            draw = ImageDraw.Draw(canvas)
            for row, (slug, frame, ref, site_file) in enumerate(batch):
                y = 6 + row * (thumb[1] + label_h + 10)
                left = Image.open(ref).convert("RGB"); left.thumbnail(thumb)
                right = Image.open(site_file).convert("RGB"); right.thumbnail(thumb)
                canvas.paste(left, (8, y + label_h))
                canvas.paste(right, (thumb[0] + 24, y + label_h))
                draw.text((8, y + 4), f"参考帧：{frame}", fill=(190, 230, 190), font=font)
                draw.text((thumb[0] + 24, y + 4), f"站点界面：{slug}", fill=(230, 220, 190), font=font)
            out = OUT / f"comparison-{sheet_idx // per_sheet + 1}.png"
            canvas.save(out)
            print(f"  ✓ 对照图 {out}")
    except Exception as error:  # noqa: BLE001
        print(f"  ⚠️ 对照图生成失败（截图仍已保存）：{error}")

    (OUT / "index.json").write_text(json.dumps({"base": BASE, "sites": shots, "frames": [f for _, _, fs in SITES for f in fs]}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n截图目录：{OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
