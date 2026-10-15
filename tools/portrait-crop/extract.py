#!/usr/bin/env python3
"""从画集扫描页里抠出「我」的对话框立绘。

用法：python3 tools/portrait-crop/extract.py <画集页.jpg> <输出.png>

源：p5artbook-020.jpg（2200×1700，Main Characters 页）。右页那张 Initial Image
是正面线稿。抠法两步：
  1. 背景是浅灰纸面（>200），从画面边界做连通域洪泛 —— 只把「与边界相连」的亮区
     当背景，所以被头发/眼镜围住的白脸不会被吃掉；
  2. 去小连通块：页面上那几行说明文字（Initial Image / School Uniform / 签名框）
     是碎结构，头发与大衣是整块大结构，按「面积 <3000 且在顶部 30%」丢掉即可。
       —— 用矩形硬裁试过，会把头发的左缘切掉。
输出按 320px 宽（立绘显示 160px，2 倍屏够用）+ 32 色调色板，10 KB 左右。
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

# 右页里立绘本体的位置（源图坐标 (2200×1700)：右页 x≥1144，再切掉页边与图注）
CROP = (1272, 58, 2046, 1256)
OUT_W, MIN_BLOB, TOP = 320, 3000, .30


def main(src, dst):
    right = Image.open(src).convert("RGB").crop(CROP)
    g = np.asarray(right.convert("L")).astype(np.int16)

    bright = g > 200
    lab, _ = ndimage.label(bright)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    bg = np.isin(lab, list(edge))

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    ink = alpha > 40
    lab2, n2 = ndimage.label(ink)
    sizes = ndimage.sum(ink, lab2, range(1, n2 + 1))
    objs = ndimage.find_objects(lab2)
    keep = np.zeros_like(ink)
    for i, s in enumerate(sizes):
        if s >= MIN_BLOB or objs[i][0].start > right.height * TOP:
            keep |= (lab2 == i + 1)

    a = Image.fromarray(np.where(keep, alpha, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = right.convert("RGBA")
    out.putalpha(a)
    out = out.crop(a.point(lambda v: 255 if v > 8 else 0).getbbox())
    out = out.resize((OUT_W, round(out.height * OUT_W / out.width)), Image.LANCZOS)
    out.quantize(colors=32, method=Image.FASTOCTREE).save(dst, optimize=True)
    print(f"写出 {dst}: {out.size}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
