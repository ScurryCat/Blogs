"""生成 assets/js/curtain-data.js：python3 tools/curtain/gen.py <源片帧目录> <输出文件>
   —— 从素材帧提取的矢量形状 + 实测时间轴，供 curtain.js 的 canvas 渲染器使用。

   思路（和 p5-ui-css 复刻对话框同源，但这里要还原「动」的部分）：
     1. 亚像素轮廓：高斯模糊成软场 -> 0.5 等值面上带插值的 marching squares
     2. 按弧长重采样 -> 变密度（细节多的姿势给更多点）
     3. 逐帧存姿势，靠顶点线性插值做形变（morph），而不是靠一条 CSS 缓动假装在动
     4. 时间轴来自实测：每段用源片帧号区间标定，死时间（f21-39 的黑场）压缩
   编码：0.2px 量化 + 沿轮廓 delta + 每 16 点重新绝对定位（防止随机游走漂移），
        有符号 36 进制文本 —— 可读、可 diff、gzip 友好。
"""
import sys, numpy as np
from scipy import ndimage

sys.path.insert(0, ".")
from shape import (masks, biggest, subpixel_contour, resample, iou_poly, catmull_rom)

FRAMES = sys.argv[1] if len(sys.argv) > 1 else "frames"   # 源片帧目录
OUT = sys.argv[2] if len(sys.argv) > 2 else "../assets/js/curtain-data.js"
SIL = [(n, 192) for n in range(5, 21)]      # 统一点数：渲染器可直接插值，IoU 仅比变密度低 0.004
WAVE = [n for n in range(40, 57)]
WHITE = [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 30, 36, 39, 41, 42]
W_N = None        # 白色小块自适应点数：按周长定，小碎块少给点（给多了 Catmull-Rom 会过冲）
W_KEEP = 12       # 每帧最多保留几块（f41 的斩击有 135 个碎块，按面积留前 12 块）
W_MIN = 12        # 小于这个像素数的块丢掉（抗锯齿碎屑）
Q = 5.0           # 量化：value = 像素 × 5  ->  0.2px
ANCHOR = 16       # 每 16 点写一次绝对值

B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def enc(v):
    v = int(round(v))
    if v == 0:
        return "0"
    s = "-" if v < 0 else ""
    v = abs(v)
    out = ""
    while v:
        out = B36[v % 36] + out
        v //= 36
    return s + out


def encode_pose(pts):
    """一条闭合轮廓 -> delta 串（每 ANCHOR 点重新绝对定位）"""
    q = np.round(np.asarray(pts, float) * Q).astype(int)
    toks, prev = [], None
    for i, (x, y) in enumerate(q):
        if i % ANCHOR == 0 or prev is None:
            toks += [enc(x), enc(y)]
        else:
            toks += [enc(x - prev[0]), enc(y - prev[1])]
        prev = (x, y)
    return ",".join(toks)


def stroke_of(comp, max_bins=20):
    """细长条（速度线）用中心线 + 线宽表示，而不是闭合轮廓 —— 
       2px 粗的长条拿轮廓去装，无论多少点都会被重采样抹掉。"""
    ys, xs = np.nonzero(comp)
    pts = np.c_[xs, ys].astype(float)
    c = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    t = (pts - c) @ vt[0]
    nb = int(np.clip(round((t.max() - t.min()) / 6), 3, max_bins))
    edges = np.linspace(t.min(), t.max() + 1e-6, nb + 1)
    line = [pts[(t >= edges[i]) & (t < edges[i + 1])].mean(0)
            for i in range(nb) if ((t >= edges[i]) & (t < edges[i + 1])).any()]
    if len(line) < 2:
        return None
    line = np.asarray(line, float)
    length = np.hypot(*np.diff(line, axis=0).T).sum()
    width = comp.sum() / max(length, 1)
    return line, width


def rasterize_stroke(line, width, shape, ss=4):
    """4× 超采样栅格化：canvas 的 lineWidth 是亚像素的，用整型线宽去量 1-2px 细线
       会得到 1px vs 2px = 100% 的假误差。"""
    from PIL import Image, ImageDraw
    H, W = shape
    img = Image.new("L", (W * ss, H * ss), 0)
    ImageDraw.Draw(img).line([(x * ss, y * ss) for x, y in line], fill=255,
                             width=max(1, int(round(width * ss))), joint="curve")
    small = img.resize((W, H), Image.BOX)
    return np.asarray(small) > 127


def white_shapes(n):
    m = masks(n, FRAMES)["white"]
    lab, k = ndimage.label(m)
    if k == 0:
        return []
    sizes = ndimage.sum(m, lab, range(1, k + 1))
    out = []
    for i in np.argsort(sizes)[::-1]:
        if sizes[i] < W_MIN or len(out) >= W_KEEP:
            break
        comp = ndimage.binary_fill_holes(lab == i + 1)
        ys, xs = np.nonzero(comp)
        fill = comp.sum() / max((xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1), 1)
        st = stroke_of(comp)
        thin = st is not None and st[1] < 5.5 and fill < .28
        if thin:                                   # 细长条 -> 描边
            line, width = st
            iou = (rasterize_stroke(line, width, comp.shape) & comp).sum() / \
                  max((rasterize_stroke(line, width, comp.shape) | comp).sum(), 1)
            out.append(("s", line, width, iou))
        else:                                      # 成块的 -> 填充轮廓
            raw = subpixel_contour(comp, 0.6)
            if len(raw) < 12:
                continue
            q = resample(raw, int(np.clip(round(len(raw) / 4), 8, 96)))
            thick = 2.0 * comp.sum() / max(len(raw), 1)      # 等效厚度，供报告分桶
            out.append(("p", q, thick, iou_poly(catmull_rom(q, 4), comp)))
    return out


def report(name, ious):
    a = np.asarray(ious)
    print(f"  {name}: IoU min {a.min():.4f} / 均 {a.mean():.4f} / 最差 {np.argmin(a)}")


# ---------- 剪影 ----------
#   第二连通块：f6/f8 上斗篷被蓝幕切成独立一块（最大 10199px），只取最大块会漏掉它；
#   闭运算糊上反而让对原掩膜的 IoU 下降（0.862 -> 0.846），所以单独存一条轮廓。
SIL2_MIN = 500
sil_f, sil_d, sil_n, sil_iou = [], [], [], []
sil2_f, sil2_d = [], []
for n, N in SIL:
    dk = masks(n, FRAMES)["dark"]
    lab, k = ndimage.label(dk)
    sizes = ndimage.sum(dk, lab, range(1, k + 1)) if k else np.array([0])
    order = np.argsort(sizes)[::-1]
    m = ndimage.binary_fill_holes(lab == int(order[0]) + 1)
    q = resample(subpixel_contour(m, 0.75), N)
    sil_f.append(n); sil_d.append(encode_pose(q)); sil_n.append(N)
    sil_iou.append(iou_poly(catmull_rom(q, 4), m))
    if k > 1 and sizes[order[1]] >= SIL2_MIN:
        m2 = ndimage.binary_fill_holes(lab == int(order[1]) + 1)
        q2 = resample(subpixel_contour(m2, 0.75), 96)
        sil2_f.append(n); sil2_d.append(encode_pose(q2))
report("剪影", sil_iou)
print(f"  剪影第二块 {len(sil2_f)} 帧: {sil2_f}")

# ---------- 波浪 ----------
wv_f, wv_d, wv_iou = [], [], []
for n in WAVE:
    m = masks(n, FRAMES)["blue"]
    if m.mean() < .005:          # 面积 <0.5% 的碎屑不值得存，靠淡出处理
        continue
    lab, k = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, k + 1))
    m = ndimage.binary_fill_holes(lab == int(np.argmax(sizes)) + 1)
    q = resample(subpixel_contour(m, 0.75), 96)
    wv_f.append(n); wv_d.append(encode_pose(q)); wv_iou.append(iou_poly(catmull_rom(q, 4), m))
report("波浪", wv_iou)

# ---------- 白色（手套 / 匕首 / 斩击）----------
wh = []
wh_iou = []
for n in WHITE:
    shapes = white_shapes(n)
    if not shapes:
        continue
    enc_shapes = []
    for kind, pts, width, iou in shapes:
        if kind == "s":
            enc_shapes.append("s%d:" % int(round(width * Q)) + ",".join(
                enc(v) for p in pts for v in (p[0] * Q, p[1] * Q)))   # 描边点少，直接绝对值
        else:
            enc_shapes.append("p:" + encode_pose(pts))
        wh_iou.append((iou, width))
    wh.append((n, enc_shapes))
fat = [i for i, w in wh_iou if w >= 3.0]
thin = [i for i, w in wh_iou if w < 3.0]
report("白色·成块(≥3px宽)", fat)
if thin:
    print(f"  白色·细线(<3px宽): {len(thin)} 条，IoU {min(thin):.2f}~{max(thin):.2f} "
          f"—— 1-2px 抗锯齿线的度量噪声地板，靠目视验收")

# ---------- 时间轴（源片帧号 -> 输出毫秒）----------
#   实测分段：1-3 黑 / 4 红幕铺满 / 5-20 剪影膨胀吞幕 / 21-39 黑场手套（死时间，压缩）
#             / 40-42 斩击 / 43-56 波浪涨缩 / 57-61 收黑
TL = [(1, 3, 0, 60), (4, 4, 60, 110), (5, 20, 110, 640),
      (21, 39, 640, 760), (40, 42, 760, 890), (43, 56, 890, 1150), (57, 61, 1150, 1180)]
TOTAL = TL[-1][3]

js = f"""/* =====================================================================
   PHANTOM LOG · curtain-data.js —— 《过场joker拉下帷幕》的矢量还原（由 tools/curtain/gen.py 生成，勿手改）
   ---------------------------------------------------------------------
   素材：BaiduNetdisk/过场joker拉下帷幕.mp4（640×360 h264 29.97fps 61 帧 2.04s）

   这里存的不是逐帧位图，而是**逐帧的矢量轮廓**：每帧一条闭合轮廓，渲染时对相邻
   帧的顶点做插值（形变），因此 30fps 的原片在 60fps 上是连续形变而不是跳帧。
   与上一版（单姿势 + CSS 位移）的区别：姿势真的在变 —— 实测拿帧 7 的姿势去拟合
   其他帧，等比缩放+平移的最优 IoU 只有 0.38~0.78，所以单姿势那条路走不通。

   精度（与源帧掩膜的 IoU，量化前）：
     剪影 {len(sil_iou)} 帧   min {min(sil_iou):.4f} / 均 {np.mean(sil_iou):.4f}
     波浪 {len(wv_iou)} 帧   min {min(wv_iou):.4f} / 均 {np.mean(wv_iou):.4f}
     白色成块 {len([1 for _, w in wh_iou if w >= 3])} 块  min {min([i for i, w in wh_iou if w >= 3]):.4f} / 均 {np.mean([i for i, w in wh_iou if w >= 3]):.4f}
     白色细线 {len([1 for _, w in wh_iou if w < 3])} 条（1-2px 抗锯齿线，IoU 落在度量噪声地板，改由目视验收）

   编码：坐标 = 像素 × {Q:g}（0.2px 量化）；沿轮廓走 delta；每 {ANCHOR} 点重新写绝对值
   （纯 delta 会随机游走漂移）；有符号 36 进制、逗号分隔 —— 可读、可 diff、gzip 友好。
   总时长 {TOTAL} ms，时间轴把源片帧号映射到输出毫秒，死时间（21-39 帧的黑场）压缩过。
   ===================================================================== */
window.PL_CURTAIN = {{
  v: 2, w: 640, h: 360, q: {Q:g}, anchor: {ANCHOR},
  total: {TOTAL},
  /* 剪影：逐帧姿势 + 每帧点数（细节多的前几帧给更多点） */
  sil: {{
    f: [{",".join(str(x) for x in sil_f)}],
    n: [{",".join(str(x) for x in sil_n)}],
    d: [
{chr(10).join('      "' + d + '",' for d in sil_d)}
    ]
  }},
  /* 剪影的第二块（斗篷被蓝幕切开的那部分，只在少数帧存在），渲染时交叉淡化 */
  sil2: {{
    f: [{",".join(str(x) for x in sil2_f)}],
    d: [
{chr(10).join('      "' + d + '",' for d in sil2_d)}
    ]
  }},
  /* 红幕波浪：左下那块涨起再缩没的幕布 */
  wave: {{
    f: [{",".join(str(x) for x in wv_f)}],
    d: [
{chr(10).join('      "' + d + '",' for d in wv_d)}
    ]
  }},
  /* 白色块：手套、匕首速度线、结尾的斩击（每帧最多 {W_KEEP} 块，点数按周长自适应） */
  white: {{
    f: [{",".join(str(f) for f, _ in wh)}],
    d: [
{chr(10).join('      [' + ",".join('"' + d + '"' for d in ds) + '],' for _, ds in wh)}
    ]
  }},
  /* [源起始帧, 源结束帧, 输出起ms, 输出止ms] */
  timeline: [{",".join("[" + ",".join(str(v) for v in seg) + "]" for seg in TL)}]
}};
"""
open(OUT, "w").write(js)
print(f"\n写出 curtain-data.js: {len(js)} 字节（{TOTAL} ms 总时长）")
for k, v in [("剪影", sil_d), ("波浪", wv_d)]:
    print(f"  {k} 编码后 {sum(len(x) for x in v)} 字符 / {len(v)} 帧")
print(f"  白色 {sum(len(x) for _, ds in wh for x in ds)} 字符")
