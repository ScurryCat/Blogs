"""P0 收尾：程序化提取剩余大表的 sprite（scipy 连通域，可复现）。

用法：python3 tools/p0-extract-sheets.py
产物：.dsh/p0-analysis/<prefix>-NN-<x>_<y>-<w>x<h>.png + <prefix>-report.json

只读参考库、只写 .dsh/ 本地分析目录，不碰源码与公开素材。
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

REF = "/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona5-spriters"
OUT = "/Users/学习/blog/Blogs/.dsh/p0-analysis"

SHEETS = [
    # (相对路径, 前缀, 最小像素数, 说明)
    ("p5/hud/92093-confidant-icons.png", "p5-confidant", 800, "P5 协助者/阿卡那图标"),
    ("p5/hud/92120-calendar-jpn.png", "p5-calendar", 4000, "P5 日历界面（JPN）"),
    ("p5r/hud/132783-photos-im.png", "p5r-photos-im", 40000, "P5R IM 照片集"),
    ("p5/hud/92711-minigames-jpn.png", "p5-minigames", 1500, "P5 迷你游戏（JPN）"),
    ("p5/hud/92712-shops.png", "p5-shops", 1500, "P5 商店界面"),
]


def extract(rel: str, prefix: str, min_px: int, label: str) -> dict:
    path = os.path.join(REF, rel)
    im = Image.open(path).convert("RGBA")
    alpha = np.array(im)[:, :, 3] > 8
    # 8 邻域连通域；scipy 的 label 对 24M 像素也是秒级
    structure = np.ones((3, 3), dtype=np.uint8)
    labeled, total = ndimage.label(alpha, structure=structure)
    slices = ndimage.find_objects(labeled)
    boxes = []
    for idx, sl in enumerate(slices, start=1):
        if sl is None:
            continue
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        count = int((labeled[ys, xs] == idx).sum())
        if count < min_px:
            continue
        boxes.append((xs.start, ys.start, w, h, count))
    boxes.sort(key=lambda b: (b[1], b[0]))
    report = []
    for i, (x, y, w, h, count) in enumerate(boxes):
        name = f"{prefix}-{i:02d}-{x}_{y}-{w}x{h}.png"
        im.crop((x, y, x + w, y + h)).save(os.path.join(OUT, name))
        report.append({"index": i, "bbox": [x, y, x + w, y + h], "size": f"{w}x{h}",
                       "pixels": count, "file": name})
    with open(os.path.join(OUT, f"{prefix}-report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(f"  {label}: {im.size[0]}×{im.size[1]} → {len(report)} 个 sprite（≥{min_px}px）")
    return {"label": label, "size": im.size, "count": len(report)}


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    summary = []
    for rel, prefix, min_px, label in SHEETS:
        if not os.path.isfile(os.path.join(REF, rel)):
            print(f"  ✗ 缺文件: {rel}")
            continue
        summary.append(extract(rel, prefix, min_px, label))
    with open(os.path.join(OUT, "sheets-summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)
    print(f"  合计 {sum(s['count'] for s in summary)} 个 sprite")
    return 0


if __name__ == "__main__":
    sys.exit(main())
