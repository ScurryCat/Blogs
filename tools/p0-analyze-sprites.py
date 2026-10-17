"""P0：程序化分析已提取的 sprite 属性，缩小「身份核对」范围（不依赖视觉）。

用法：python3 tools/p0-analyze-sprites.py
产物：.dsh/p0-analysis/analysis-<前缀>.json + 控制台摘要

判断依据（全部可计算，不是猜测）：
  - **饱和度**：黑白美术（原版 P5 头像）接近 0，红色 UI 图标偏高；
  - **主色**：接近 P5 的红(#E60012) / 白 / 黑 的比例，用来区分「红底图标」与「照片」；
  - **尺寸与长宽比**：头像多为正方；消息块/按钮多为横长；
  - **不透明占比**：整块满幅的更像照片/背景，零星图形更像图标。
这些指标只用来**排序候选**，最终「这是谁/这是哪个图标」仍须图像核对。
"""

from __future__ import annotations

import colorsys
import json
import os

import numpy as np
from PIL import Image

OUT = "/Users/学习/blog/Blogs/.dsh/p0-analysis"

SHEETS = ["p5-profile-pics", "p5r-im-assets", "p5-confidant", "p5-calendar", "p5-minigames", "p5-shops", "p5r-buttons"]

P5_RED = (230, 0, 18)


def analyze(prefix: str) -> list[dict] | None:
    report_path = os.path.join(OUT, f"{prefix}-report.json")
    if not os.path.isfile(report_path):
        return None
    with open(report_path, encoding="utf-8") as fh:
        items = json.load(fh)
    rows = []
    for item in items:
        path = os.path.join(OUT, item["file"])
        try:
            im = Image.open(path).convert("RGBA")
        except OSError:
            continue
        arr = np.array(im).astype(np.float32)
        alpha = arr[:, :, 3] / 255.0
        opaque = alpha > 0.5
        if opaque.sum() == 0:
            continue
        rgb = arr[:, :, :3][opaque] / 255.0
        # 饱和度与亮度（只统计不透明像素，避免透明区的黑色拉低均值）
        mx = rgb.max(axis=1)
        mn = rgb.min(axis=1)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
        lum = 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]
        # 与 P5 红的距离（归一化到 0..1，越小越接近）
        red = np.array(P5_RED, dtype=np.float32) / 255.0
        dist_red = np.linalg.norm(rgb - red, axis=1).mean()
        w, h = im.size
        rows.append({
            "index": item["index"],
            "file": item["file"],
            "size": f"{w}x{h}",
            "aspect": round(w / h, 3) if h else None,
            "fill": round(float(opaque.mean()), 3),
            "sat_mean": round(float(sat.mean()), 3),
            "lum_mean": round(float(lum.mean()), 3),
            "red_dist": round(float(dist_red), 3),
            "grayscale_like": bool(sat.mean() < 0.12),
            "red_heavy": bool((dist_red < 0.5).mean() > 0.3),
        })
    out = os.path.join(OUT, f"analysis-{prefix}.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=1)
    return rows


def main() -> int:
    for prefix in SHEETS:
        rows = analyze(prefix)
        if rows is None:
            print(f"  · 跳过 {prefix}（没有报告）")
            continue
        gray = [r for r in rows if r["grayscale_like"]]
        red = [r for r in rows if r["red_heavy"]]
        square = [r for r in rows if r["aspect"] and 0.85 <= r["aspect"] <= 1.18]
        print(f"  {prefix}: {len(rows)} 个 | 近黑白 {len(gray)} | 红色主导 {len(red)} | 近正方 {len(square)}")
        if prefix == "p5-profile-pics" and gray:
            ids = ", ".join(str(r["index"]) for r in gray[:20])
            print(f"    近黑白（原版头像候选）：{ids}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
