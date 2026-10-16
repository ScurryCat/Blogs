/**
 * 地图「出发」的人群过场 —— 旧站 `assets/js/crowd.js` 的 TypeScript 迁移。
 *
 * 迁移要点（`2026-10-16-map-travel-transition-design.md`）：
 *  - 原版人物纹理、黑底白灰剪影、三层固定方向 / 尺寸 / 透明度 / 速度，几何与编排逐值保留；
 *  - 位置只由经过的毫秒数决定：刷新率、丢帧与重播不会改变编排；
 *  - `warm()` / `ready()` / `play()` / `stop()` 接口保留；转场时长由本组件提供（`wait`），
 *    调用方不再维护第二份时间常量；
 *  - 图未就绪 / 加载失败 → `play()` 返回 false，调用方退回帷幕，**不等待素材**；
 *  - 减少动态效果时直接返回 false，不播放、不延时。
 *
 * 与旧实现的两点差别（都是所有权层面的，不改视觉）：
 *  1. 画布建在传入的宿主元素里，不再 `document.body.appendChild`（React 持有 DOM）；
 *  2. **不再注册全局 `resize` 监听**：由 `resize()` 在每帧按内尺寸变化就地重算
 *     （旧站那个监听是常驻的、跨页不清理的全局监听之一）。
 */

/** 只有裁掉透明留白；目标宽高按 alpha 边界比例计算，原始 PNG 不修改。 */
const SPRITES: readonly (readonly [string, number, number, number, number])[] = [
  ["crowd000_000.pac_0_risultato.png", 108, 316, 306, 708],
  ["crowd000_000.pac_1_risultato.png", 88, 487, 335, 536],
  ["crowd000_000.pac_2_risultato.png", 72, 378, 284, 646],
  ["crowd000_000.pac_3_risultato.png", 116, 424, 278, 599],
  ["crowd001_000.pac_0_risultato.png", 76, 306, 360, 717],
  ["crowd001_000.pac_1_risultato.png", 106, 440, 290, 584],
  ["crowd001_000.pac_2_risultato.png", 77, 400, 336, 624],
  ["crowd001_000.pac_3_risultato.png", 60, 320, 393, 703],
  ["crowd003_000.pac_0_risultato.png", 123, 308, 267, 715],
  ["crowd003_000.pac_1_risultato.png", 100, 388, 312, 635],
  ["crowd003_000.pac_2_risultato.png", 53, 327, 406, 696],
  ["crowd003_000.pac_3_risultato.png", 88, 402, 333, 621],
];

const SPRITE_DIR = "/assets/legacy/img/crowd/original/";

interface LayerSpec {
  alpha: number;
  height: number;
  width: number;
  phoneHeight: number;
  phoneWidth: number;
  baseline: number;
  speed: number;
  direction: 1 | -1;
  count: number;
  phoneCount: number;
  phase: number;
}

const LAYERS: readonly LayerSpec[] = [
  { alpha: 0.3, height: 0.58, width: 0.18, phoneHeight: 0.4, phoneWidth: 0.28, baseline: 0.72, speed: 62, direction: 1, count: 8, phoneCount: 4, phase: 0.08 },
  { alpha: 0.6, height: 0.82, width: 0.26, phoneHeight: 0.58, phoneWidth: 0.38, baseline: 0.9, speed: 145, direction: -1, count: 7, phoneCount: 4, phase: 0.39 },
  { alpha: 1, height: 1.06, width: 0.36, phoneHeight: 0.78, phoneWidth: 0.48, baseline: 1.1, speed: 310, direction: 1, count: 6, phoneCount: 3, phase: 0.67 },
];

const MAX_RATIO = Math.max(...SPRITES.map((sprite) => sprite[4] / sprite[3]));
/** 目标约一秒；调用方（脚手架）读这个值，不自己再写一遍。 */
export const CROWD_WAIT_MS = 900;

interface SpriteEntry {
  image: HTMLImageElement;
  decoded: boolean;
}

interface Person {
  index: number;
  height: number;
  phase: number;
  bob: number;
}

interface Lane extends LayerSpec {
  height: number;
  margin: number;
  span: number;
  baseline: number;
  people: Person[];
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 省流量 / 2G 时跳过需要下载素材的人群过场（3G 不再算慢，与旧站结论一致）。 */
export function isCheapConnection(): boolean {
  try {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    return !(connection && (connection.saveData || /^(slow-)?2g$/.test(connection.effectiveType ?? "")));
  } catch {
    return true;
  }
}

const wrap = (value: number, span: number) => ((value % span) + span) % span;

/** 预热状态：把「有意跳过」和「加载失败」分开，排查时不会互相冒充。 */
export type CrowdWarmState =
  | "not-warmed"
  | "warming"
  | "ready"
  | "failed"
  | "reduced-motion"
  | "slow-connection";

export class CrowdEffect {
  readonly wait = CROWD_WAIT_MS;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly images: SpriteEntry[] = [];
  private lanes: Lane[] = [];
  private raf = 0;
  private warmState: CrowdWarmState = "not-warmed";
  private active = false;
  private start = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private destroyed = false;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  /**
   * 预热所选人物图；幂等。加载失败只把该张标记为未就绪，不重试、不阻塞。
   *
   * 减少动态效果时**有意不预热**（这 700 KB 下载了也永远不会播）：
   * 此时 `warmState` 是 `reduced-motion`，与「加载失败」（`failed`）区分开。
   */
  warm(): void {
    if (this.destroyed || this.images.length) return;
    if (prefersReducedMotion()) {
      this.warmState = "reduced-motion";
      return;
    }
    this.warmState = "warming";
    for (const sprite of SPRITES) {
      const image = new Image();
      const entry: SpriteEntry = { image, decoded: false };
      this.images.push(entry);
      image.decoding = "async";
      image.onload = () => {
        const decoded = image.decode ? image.decode() : Promise.resolve();
        decoded.then(
          () => {
            entry.decoded = image.naturalWidth > 0;
          },
          () => {
            entry.decoded = false;
          },
        );
      };
      image.onerror = () => {
        entry.decoded = false;
      };
      image.src = SPRITE_DIR + sprite[0];
    }
  }

  ready(): boolean {
    const ok =
      this.images.length === SPRITES.length &&
      this.images.every((entry) => entry.decoded && entry.image.complete && entry.image.naturalWidth > 0);
    if (ok) this.warmState = "ready";
    else if (this.images.some((entry) => entry.image.complete && entry.image.naturalWidth === 0)) {
      this.warmState = "failed";
    }
    return ok;
  }

  /** 预热状态（调试与验收用）：跳过的原因不会被误读成加载失败。 */
  state(): CrowdWarmState {
    return this.warmState;
  }

  /**
   * 由调用方登记「有意跳过」的原因（例如省流量 / 2G）。
   * 减少动效的判定留在 `warm()` 内部，避免两处判据漂移。
   */
  markSkipped(reason: Extract<CrowdWarmState, "slow-connection">): void {
    if (this.warmState === "not-warmed") this.warmState = reason;
  }

  private resize(): void {
    if (!this.ctx) return;
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const phone = this.width < 720;
    this.lanes = LAYERS.map((layer, depth) => {
      const laneHeight = phone
        ? this.height * layer.phoneHeight
        : Math.min(this.height * layer.height, (this.width * layer.width) / MAX_RATIO);
      const margin = (phone ? this.width * layer.phoneWidth : laneHeight * MAX_RATIO) + 24;
      const span = this.width + margin * 2;
      const count = phone ? layer.phoneCount : layer.count;
      return {
        ...layer,
        height: laneHeight,
        margin,
        span,
        baseline: this.height * (phone ? 1.04 : layer.baseline),
        speed: layer.speed * Math.max(0.65, this.width / 1280),
        people: Array.from({ length: count }, (_, index) => {
          const spriteIndex = (depth * 4 + index) % SPRITES.length;
          const sprite = SPRITES[spriteIndex]!;
          // 窄屏逐人限宽：瘦长人物不再被最宽纹理一起压矮；三层都在底边裁切。
          const personHeight = phone
            ? Math.min(laneHeight, (this.width * layer.phoneWidth * sprite[4]) / sprite[3])
            : laneHeight;
          return {
            index: spriteIndex,
            height: personHeight,
            phase: (index / count + layer.phase) % 1,
            bob: index * 1.7 + depth,
          };
        }),
      };
    });
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (window.innerWidth !== this.width || window.innerHeight !== this.height || Math.min(window.devicePixelRatio || 1, 2) !== this.dpr) {
      this.resize();
    }
    const elapsed = Math.max(0, now - this.start) / 1000;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width, this.height);
    for (const lane of this.lanes) {
      ctx.globalAlpha = lane.alpha;
      for (const person of lane.people) {
        const sprite = SPRITES[person.index];
        const entry = this.images[person.index];
        if (!sprite || !entry) continue;
        const [, sx, sy, sw, sh] = sprite;
        const personWidth = (person.height * sw) / sh;
        const x =
          wrap(person.phase * lane.span + lane.direction * lane.speed * elapsed, lane.span) - lane.margin;
        const y = lane.baseline - person.height + Math.sin(elapsed * 2.4 + person.bob) * 3;
        // 右行层有意镜像，左行层沿用原纹理；不随帧或随机数切换人物。
        ctx.save();
        ctx.translate(x + (lane.direction > 0 ? personWidth : 0), y);
        if (lane.direction > 0) ctx.scale(-1, 1);
        ctx.drawImage(entry.image, sx, sy, sw, sh, 0, 0, personWidth, person.height);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private frame = (now: number): void => {
    if (!this.active) return;
    this.draw(now);
    this.raf = window.requestAnimationFrame(this.frame);
  };

  /** 返回是否真的开始播放；未就绪 / 被减动效 / 缺 canvas 时返回 false 由调用方降级。 */
  play(): boolean {
    if (prefersReducedMotion() || !this.ready() || this.destroyed || !this.ctx) return false;
    if (this.active) return true;
    this.resize();
    this.start = performance.now();
    this.active = true;
    this.draw(this.start); // 第一帧就铺满黑底，不等下一次 rAF。
    this.host.classList.add("on");
    this.raf = window.requestAnimationFrame(this.frame);
    return true;
  }

  stop(): void {
    this.active = false;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.host.classList.remove("on");
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.canvas.remove();
  }
}
