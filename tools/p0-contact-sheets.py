"""P0：把已提取的 sprite 拼成带编号的对照图，供**有图像能力的人/模型**核对身份。

用法：python3 tools/p0-contact-sheets.py
产物：.dsh/p0-analysis/contact-<前缀>.png

背景用深色 + 交替底色，便于看清透明边缘；每格左上角是报告 JSON 里的 sprite 序号，
与 `<前缀>-report.json` 的 `index` 一一对应 —— 核对后把「序号 → 应用/用途」回填映射表即可。
"""

from __future__ import annotations

import json
import os

from PIL import Image, ImageDraw, ImageFont

OUT = "/Users/学习/blog/Blogs/.dsh/p0-analysis"

SHEETS = [
    ("p5r-buttons", "P5R 按钮/图标", 84),
    ("p5-profile-pics", "P5 头像表", 96),
    ("p5r-im-assets", "P5R IM 元件", 96),
    ("p5-confidant", "P5 协助者/阿卡那图标", 92),
    ("p5-calendar", "P5 日历界面", 84),
    ("p5-minigames", "P5 迷你游戏", 84),
    ("p5-shops", "P5 商店界面", 92),
]


def build(prefix: str, title: str, cell: int) -> int | None:
    report_path = os.path.join(OUT, f"{prefix}-report.json")
    if not os.path.isfile(report_path):
        return None
    with open(report_path, encoding="utf-8") as fh:
        items = json.load(fh)
    if not items:
        return None
    cols = 10
    rows = (len(items) + cols - 1) // cols
    pad = 6
    w = cols * (cell + pad) + pad
    h = rows * (cell + pad) + pad + 22
    sheet = Image.new("RGB", (w, h), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 12)
        head = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 14)
    except OSError:  # 字体缺失时退回默认字体，仍可用
        font = ImageFont.load_default()
        head = font
    draw.text((pad, 4), f"{title} · {len(items)} sprites（序号对应 *-report.json 的 index）", fill=(240, 240, 240), font=head)
    for i, item in enumerate(items):
        col, row = i % cols, i // cols
        x = pad + col * (cell + pad)
        y = 22 + pad + row * (cell + pad)
        # 交替底色，便于看清透明边缘
        draw.rectangle([x, y, x + cell, y + cell], fill=(30, 30, 34) if (i // cols + i % cols) % 2 == 0 else (24, 24, 27))
        try:
            sprite = Image.open(os.path.join(OUT, item["file"])).convert("RGBA")
        except OSError:
            continue
        sprite.thumbnail((cell - 6, cell - 6), Image.LANCZOS)
        sheet.paste(sprite, (x + (cell - sprite.width) // 2, y + (cell - sprite.height) // 2), sprite)
        draw.text((x + 2, y + 1), str(item["index"]), fill=(230, 0, 18), font=font)
    out_path = os.path.join(OUT, f"contact-{prefix}.png")
    sheet.save(out_path)
    print(f"  ✓ {out_path}  ({len(items)} 个，{sheet.width}×{sheet.height})")
    return len(items)


def main() -> int:
    total = 0
    for prefix, title, cell in SHEETS:
        got = build(prefix, title, cell)
        if got is None:
            print(f"  · 跳过 {prefix}（没有报告）")
        else:
            total += got
    print(f"  合计 {total} 个 sprite 已排成对照图")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
