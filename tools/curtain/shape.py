"""从素材帧提取矢量姿势：亚像素轮廓 -> 按弧长重采样 -> 顶点表。
   同时给出与原帧掩膜的 IoU，用来量化「精细」到什么程度。"""
import numpy as np
from PIL import Image
from scipy import ndimage


def frame(n, d=".w/frames"):
    return np.asarray(Image.open(f"{d}/f{n:03d}.png").convert("RGB")).astype(np.int16)


def masks(n, d=".w/frames"):
    a = frame(n, d)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return {"dark": (r < 60) & (g < 60) & (b < 60),
            "blue": (b > 90) & (b > r + 40) & (b > g + 30),
            "white": (r > 150) & (g > 150) & (b > 150)}


def biggest(m, fill=True):
    lab, k = ndimage.label(m)
    if k == 0:
        return np.zeros_like(m)
    sizes = ndimage.sum(m, lab, range(1, k + 1))
    out = lab == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_fill_holes(out) if fill else out


def subpixel_contour(mask, sigma=0.75, level=0.5):
    """高斯模糊把二值掩膜变成软场，再在 0.5 等值面上做带线性插值的 marching squares ——
       得到的是亚像素轮廓，不是像素阶梯。返回最长的闭合环（float 坐标）。
       先用 numpy 把 230k 个格子筛成几千个跨等值面的格子，再走 Python 循环。"""
    f = ndimage.gaussian_filter(mask.astype(np.float32), sigma)
    f = np.pad(f, 1, constant_values=0)
    tl = f[:-1, :-1] > level
    tr = f[:-1, 1:] > level
    br = f[1:, 1:] > level
    bl = f[1:, :-1] > level
    idx = tl.astype(np.uint8) * 8 + tr * 4 + br * 2 + bl * 1
    ys, xs = np.nonzero((idx != 0) & (idx != 15))
    segs = {}

    def add(a, b):
        segs.setdefault(a, []).append(b)

    for y, x in zip(ys.tolist(), xs.tolist()):
        a, b, c, d = f[y, x], f[y, x+1], f[y+1, x+1], f[y+1, x]
        def ip(u, v):
            t = (level - u) / (v - u) if v != u else .5
            return float(np.clip(t, 0, 1))
        top = (x + ip(a, b), float(y))
        right = (float(x + 1), y + ip(b, c))
        bottom = (x + ip(d, c), float(y + 1))
        left = (float(x), y + ip(a, d))
        for p, q in {
            1: [(left, bottom)], 2: [(bottom, right)], 3: [(left, right)], 4: [(right, top)],
            5: [(left, top), (bottom, right)], 6: [(bottom, top)], 7: [(left, top)],
            8: [(top, left)], 9: [(top, bottom)], 10: [(top, right), (bottom, left)],
            11: [(top, right)], 12: [(right, left)], 13: [(right, bottom)], 14: [(bottom, left)],
        }[idx[y, x]]:
            add(p, q)
    loops = []
    while segs:
        start = next(iter(segs))
        loop, cur = [start], start
        while True:
            outs = segs.get(cur)
            if not outs:
                break
            nxt = outs.pop()
            if not outs:
                del segs[cur]
            loop.append(nxt)
            cur = nxt
            if cur == start:
                break
        if len(loop) > 8:
            loops.append([(x - 1, y - 1) for x, y in loop])
    if not loops:
        return []
    return max(loops, key=len)


def resample(loop, n):
    """按弧长把闭合环重采样成 n 个点（起点固定为「最上、最左」那个采样点，保证跨帧对应）"""
    p = np.asarray(loop, dtype=float)
    if np.allclose(p[0], p[-1]):
        p = p[:-1]
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(np.r_[p, p[:1]], axis=0).T))]
    total = d[-1]
    t = np.linspace(0, total, n, endpoint=False)
    xs = np.interp(t, d, np.r_[p[:, 0], p[0, 0]])
    ys = np.interp(t, d, np.r_[p[:, 1], p[0, 1]])
    q = np.c_[xs, ys]
    # 旋转起点到「y 最小、再 x 最小」的点，保证同一部位始终是第 0 个点
    i0 = int(np.lexsort((q[:, 0], q[:, 1]))[0])
    q = np.roll(q, -i0, axis=0)
    # 统一绕向（图像坐标下按面积判正负）
    area = np.sum(q[:, 0] * np.roll(q[:, 1], -1) - np.roll(q[:, 0], -1) * q[:, 1])
    if area < 0:
        q = q[::-1]
    return q


def rasterize(pts, shape):
    """把多边形栅格化（用于算 IoU）"""
    from PIL import ImageDraw
    img = Image.new("1", (shape[1], shape[0]), 0)
    ImageDraw.Draw(img).polygon([tuple(p) for p in pts], fill=1)
    return np.asarray(img, dtype=bool)


def iou_poly(pts, mask):
    r = rasterize(pts, mask.shape)
    return (r & mask).sum() / max((r | mask).sum(), 1)


def catmull_rom(pts, samples_per_seg=6):
    """闭合 Catmull-Rom：把重采样点变成平滑曲线（渲染端也用同一套，保证所见即所得）"""
    p = np.asarray(pts, dtype=float)
    n = len(p)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = p[(i-1) % n], p[i], p[(i+1) % n], p[(i+2) % n]
        for j in range(samples_per_seg):
            t = j / samples_per_seg
            t2, t3 = t*t, t*t*t
            out.append(0.5 * ((2*p1) + (-p0 + p2)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t2 + (-p0 + 3*p1 - 3*p2 + p3)*t3))
    return np.asarray(out)
