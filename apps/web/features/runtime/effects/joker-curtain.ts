/**
 * 《过场 joker 拉下帷幕》的矢量还原 —— 旧站 `assets/js/curtain.js` 的 TypeScript 迁移。
 *
 * 数据是逐帧矢量轮廓 + 实测时间轴（`curtain-data.json`，由旧站 `curtain-data.js` 逐字节转出），
 * 本文件只负责解码、形变、绘制。顶层导航（`top-nav`）与普通站内跳转（`phone-link`）用它。
 *
 * 迁移保留的行为：
 *  - 逐帧轮廓的相邻帧插值形变（30fps 原片在 60fps 上仍是连续形变）；
 *  - 坐标映射：640×360 等比放进视口，红幕与黑封口铺满整个视口；
 *  - **数据懒加载**：先画页面，`warm()` 时才 `import()` 32 KB 数据；
 *  - 时长由数据自己的 `total` 说了算，调用方不写第二份常量；
 *  - `prefers-reduced-motion: reduce` 时 `play()` 返回 false，调用方直接导航。
 *
 * 差别（所有权层面）：画布建在传入的宿主里，`resize` 监听改由每帧就地校正，
 * 不再注册跨页常驻的全局监听。
 */

import { prefersReducedMotion } from "./crowd";

interface PoseSet {
  f: readonly number[];
  n?: readonly number[];
  d: readonly string[];
}

interface WhiteSet {
  f: readonly number[];
  d: readonly (readonly string[])[];
}

interface CurtainData {
  v: number;
  w: number;
  h: number;
  q: number;
  anchor: number;
  total: number;
  sil: PoseSet;
  sil2: PoseSet;
  wave: PoseSet;
  white: WhiteSet;
  timeline: readonly (readonly number[])[];
}

const CONTENT_BOX = { x: 0, y: 0, w: 640, h: 360 };
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 有符号 36 进制文本 → 数字数组。 */
function decode(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < text.length) {
    let sign = 1;
    if (text[i] === "-") {
      sign = -1;
      i += 1;
    }
    let value = 0;
    let any = false;
    while (i < text.length && text[i] !== ",") {
      value = value * 36 + B36.indexOf(text[i] ?? "");
      i += 1;
      any = true;
    }
    if (any) out.push(sign * value);
    i += 1; // 跳过逗号
  }
  return out;
}

/** delta 串 → 顶点：每 anchor 个点重写一次绝对值，避免纯 delta 的随机游走漂移。 */
function pose(tokens: readonly number[], count: number, q: number, anchor: number): Float32Array {
  const pts = new Float32Array(count * 2);
  let px = 0;
  let py = 0;
  for (let i = 0; i < count; i += 1) {
    const dx = tokens[i * 2] ?? 0;
    const dy = tokens[i * 2 + 1] ?? 0;
    if (i % anchor === 0) {
      px = dx / q;
      py = dy / q;
    } else {
      px += dx / q;
      py += dy / q;
    }
    pts[i * 2] = px;
    pts[i * 2 + 1] = py;
  }
  return pts;
}

interface Decoded {
  sil: Float32Array[];
  silF: readonly number[];
  sil2: Float32Array[];
  sil2F: readonly number[];
  wave: Float32Array[];
  waveF: readonly number[];
  white: { stroke: number; pts: number[]; stroked: boolean }[][];
  whiteF: readonly number[];
}

function prepare(data: CurtainData): Decoded {
  const q = data.q;
  const anchor = data.anchor;
  return {
    sil: data.sil.d.map((entry, index) => pose(decode(entry), data.sil.n?.[index] ?? 192, q, anchor)),
    silF: data.sil.f,
    // 第二块：斗篷被幕切成独立一块的那几帧，只为交叉淡化，不做形变。
    sil2: data.sil2.d.map((entry) => pose(decode(entry), 96, q, anchor)),
    sil2F: data.sil2.f,
    wave: data.wave.d.map((entry) => pose(decode(entry), 96, q, anchor)),
    waveF: data.wave.f,
    white: data.white.d.map((set) =>
      set.map((token) => {
        if (token.startsWith("s")) {
          const colon = token.indexOf(":");
          return {
            stroke: Number(token.slice(1, colon)) / q,
            pts: decode(token.slice(colon + 1)).map((value) => value / q),
            stroked: true,
          };
        }
        return { stroke: 0, pts: Array.from(pose(decode(token.slice(2)), 48, q, anchor)), stroked: false };
      }),
    ),
    whiteF: data.white.f,
  };
}

/** 只在关键帧附近存在的元素走一个包络淡入淡出。 */
function envelope(frames: readonly number[], frame: number, pad: number): number {
  if (!frames.length) return 0;
  const first = frames[0] ?? 0;
  const last = frames[frames.length - 1] ?? 0;
  if (frame < first - pad || frame > last + pad) return 0;
  if (frame < first) return (frame - (first - pad)) / pad;
  if (frame > last) return 1 - (frame - last) / pad;
  return 1;
}

/** 相邻两帧顶点数相同，直接线性插值。 */
function blend(a: Float32Array, b: Float32Array, t: number, out: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i += 1) {
    out[i] = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
  }
  return out;
}

/** 顶点表 → Path2D：Catmull-Rom 转三次贝塞尔，闭合。 */
function toPath(pts: Float32Array | number[], step = 1): Path2D {
  const path = new Path2D();
  const n = pts.length / 2;
  if (n < 3) return path;
  const at = (i: number): [number, number] => {
    const index = (((i % n) + n) % n) * 2;
    return [pts[index] ?? 0, pts[index + 1] ?? 0];
  };
  const [x0, y0] = at(0);
  path.moveTo(x0, y0);
  for (let i = 0; i < n; i += step) {
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [xm1, ym1] = at(i - 1);
    const [x3, y3] = at(i + 2);
    path.bezierCurveTo(
      x1 + (x2 - xm1) / 6,
      y1 + (y2 - ym1) / 6,
      x2 - (x3 - x1) / 6,
      y2 - (y3 - y1) / 6,
      x2,
      y2,
    );
  }
  path.closePath();
  return path;
}

/** 源帧号是主时钟（数据里已经压缩过死时间）。 */
function frameAt(timeline: readonly (readonly number[])[], ms: number): number {
  for (const segment of timeline) {
    const [f0 = 0, f1 = 0, m0 = 0, m1 = 0] = segment;
    if (ms <= m1) return f0 + (f1 - f0) * (m1 === m0 ? 1 : (ms - m0) / (m1 - m0));
  }
  const last = timeline[timeline.length - 1];
  return last?.[1] ?? 0;
}

function bracket(frames: readonly number[], frame: number): [number, number, number] {
  const first = frames[0] ?? 0;
  if (frame <= first) return [0, 0, 0];
  for (let i = 1; i < frames.length; i += 1) {
    const current = frames[i] ?? 0;
    if (frame <= current) {
      const previous = frames[i - 1] ?? 0;
      return [i - 1, i, (frame - previous) / (current - previous || 1)];
    }
  }
  const last = frames.length - 1;
  return [last, last, 0];
}

function cssVar(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);

    return value.trim() || fallback;
  } catch {
    return fallback;
  }
}

export class JokerCurtainEffect {
  private data: CurtainData | null = null;
  private poses: Decoded | null = null;
  private loading = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private startedAt = 0;
  private color = { red: "#e5191c", black: "#0a0a0b", paper: "#f4f1ea" };
  private destroyed = false;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  get total(): number {
    return this.data?.total ?? 1180;
  }

  ready(): boolean {
    return Boolean(this.data && this.poses);
  }

  /** 懒加载数据；幂等。失败（离线 / 404）时保持未就绪，调用方降级。 */
  async warm(): Promise<void> {
    if (this.data || this.loading || this.destroyed) return;
    this.loading = true;
    try {
      const loaded = (await import("./curtain-data.json")) as unknown as { default: CurtainData };
      this.data = loaded.default;
      this.poses = prepare(this.data);
    } catch {
      this.data = null;
      this.poses = null;
    } finally {
      this.loading = false;
    }
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth || document.documentElement.clientWidth || 1;
    this.height = window.innerHeight || document.documentElement.clientHeight || 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.scale = Math.min(this.width / CONTENT_BOX.w, this.height / CONTENT_BOX.h);
    this.offsetX = (this.width - CONTENT_BOX.w * this.scale) / 2 - CONTENT_BOX.x * this.scale;
    this.offsetY = (this.height - CONTENT_BOX.h * this.scale) / 2 - CONTENT_BOX.y * this.scale;
  }

  private theme(): void {
    this.color = {
      red: cssVar("--red", "#e5191c"),
      black: cssVar("--black", "#0a0a0b"),
      paper: cssVar("--paper", "#f4f1ea"),
    };
  }

  private draw(framePosition: number): void {
    const ctx = this.ctx;
    const poses = this.poses;
    const data = this.data;
    if (!ctx || !poses || !data) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.color.black; // 1 黑底：这一层就是「遮盖」
    ctx.fillRect(0, 0, this.width, this.height);

    if (framePosition < 24) {
      // 2 红幕：源片 f4 那一帧整片铺满，因此这里是一块铺满视口的纯色。
      ctx.fillStyle = this.color.red;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    if (framePosition > 8.5) {
      // 3 黑封口：补信箱边与剪影没盖住的缝，必须在视口坐标里铺满。
      ctx.globalAlpha = Math.min(1, Math.max(0, (framePosition - 8.5) / 1.5));
      ctx.fillStyle = this.color.black;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // 4 剪影
    const [i0, i1, t] = bracket(poses.silF, framePosition);
    const a = poses.sil[i0];
    const b = poses.sil[i1];
    if (a) {
      const tmp = new Float32Array(a.length);
      const silhouette = i0 === i1 || !b ? a : blend(a, b, t, tmp);
      ctx.fillStyle = this.color.black;
      ctx.fill(toPath(silhouette, 1));
    }

    // 4b 第二块（斗篷被切开的帧）：交叉淡化，不形变。
    if (poses.sil2F.length) {
      const alpha = envelope(poses.sil2F, framePosition, 1.5);
      if (alpha > 0.01) {
        const [m0, m1, u] = bracket(poses.sil2F, framePosition);
        ctx.fillStyle = this.color.black;
        const first = poses.sil2[m0];
        const second = poses.sil2[m1];
        if (m0 === m1 || !second) {
          if (first) {
            ctx.globalAlpha = alpha;
            ctx.fill(toPath(first, 1));
          }
        } else if (first) {
          ctx.globalAlpha = alpha * (1 - u);
          ctx.fill(toPath(first, 1));
          ctx.globalAlpha = alpha * u;
          ctx.fill(toPath(second, 1));
        }
        ctx.globalAlpha = 1;
      }
    }

    // 5 波浪（结尾左下涨起又缩没的幕布）
    const waveFirst = poses.waveF[0] ?? 0;
    const waveLast = poses.waveF[poses.waveF.length - 1] ?? 0;
    if (framePosition >= waveFirst - 2 && framePosition <= waveLast + 2) {
      const [j0, j1, u] = bracket(poses.waveF, framePosition);
      const w0 = poses.wave[j0];
      const w1 = poses.wave[j1];
      if (w0) {
        const wave = j0 === j1 || !w1 ? w0 : blend(w0, w1, u, new Float32Array(w0.length));
        ctx.fillStyle = this.color.red;
        ctx.fill(toPath(wave, 1));
      }
    }

    // 6 白色块：手套 / 速度线 / 结尾斩击；数量与点数逐帧不同，用关键帧交叉淡化。
    const whiteAlpha = envelope(poses.whiteF, framePosition, 1.5);
    if (whiteAlpha > 0.01) {
      const [k0, k1, v] = bracket(poses.whiteF, framePosition);
      ctx.fillStyle = this.color.paper;
      ctx.strokeStyle = this.color.paper;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const paint = (set: Decoded["white"][number] | undefined, alpha: number) => {
        if (!set || alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        for (const shape of set) {
          if (shape.stroked) {
            ctx.lineWidth = shape.stroke;
            ctx.beginPath();
            ctx.moveTo(shape.pts[0] ?? 0, shape.pts[1] ?? 0);
            for (let i = 2; i < shape.pts.length; i += 2) {
              ctx.lineTo(shape.pts[i] ?? 0, shape.pts[i + 1] ?? 0);
            }
            ctx.stroke();
          } else {
            ctx.fill(toPath(shape.pts, 1));
          }
        }
        ctx.globalAlpha = 1;
      };
      if (k0 === k1) paint(poses.white[k0], whiteAlpha);
      else {
        paint(poses.white[k0], whiteAlpha * (1 - v));
        paint(poses.white[k1], whiteAlpha * v);
      }
    }
  }

  private tick = (now: number): void => {
    const data = this.data;
    if (!data) return;
    if (window.innerWidth && (window.innerWidth !== this.width || window.innerHeight !== this.height)) {
      this.resize();
    }
    const ms = now - this.startedAt;
    this.draw(frameAt(data.timeline, Math.min(ms, data.total)));
    if (ms < data.total + 60) this.raf = window.requestAnimationFrame(this.tick);
    else this.raf = 0;
  };

  /** 返回是否真的开始播放：未就绪 / 被减动效 / 缺 canvas 时返回 false。 */
  play(): boolean {
    if (prefersReducedMotion() || !this.ready() || this.destroyed || !this.ctx) return false;
    this.resize();
    this.theme();
    this.startedAt = performance.now();
    this.host.classList.add("on");
    if (!this.raf) this.raf = window.requestAnimationFrame(this.tick);
    return true;
  }

  stop(): void {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.host.classList.remove("on");
  }

  /** 调试 / 截图验收：把画面定格在某个输出毫秒。 */
  seek(ms: number): boolean {
    if (!this.ready() || !this.data) return false;
    this.resize();
    this.theme();
    this.host.classList.add("on");
    this.draw(frameAt(this.data.timeline, ms));
    return true;
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.canvas.remove();
  }
}
