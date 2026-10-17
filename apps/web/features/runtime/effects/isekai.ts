/**
 * 「我的殿堂」异世界短过场 —— 绿幕墨迹素材的 VP9+alpha 短版（第三轮任务书 §6.3）。
 *
 * 素材与旧站同一份出处：参考资料库里的《过场进入异世界》/《异世界转场》绿幕视频。
 * 旧站 `assets/js/core.js` 已用同一素材、同一套参数做过 0.75 秒的 `dive.webm`：
 *
 *   ffmpeg -ss 3.2 -t 0.75 -i 过场进入异世界.mp4 \
 *     -vf "chromakey=0x48ff00:0.20:0.06,despill=type=green,fps=30,scale=960:540,format=yuva420p" \
 *     -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 36 -row-mt 1 -an assets/clip/dive.webm
 *
 * 本轮沿用同一配方，只改输入（7.21 重置版素材）、时间范围（1.5 秒短版）与尺寸（1280×720）：
 *
 *   ffmpeg -ss 1.25 -t 1.5 -i 异世界转场.mp4 \
 *     -vf "chromakey=0x14ff0b:0.20:0.06,despill=type=green,fps=30,scale=1280:720,format=yuva420p" \
 *     -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 36 -row-mt 1 -an public/assets/clip/isekai-showcase.webm
 *
 * 行为约定（与 `crowd.ts` / `joker-curtain.ts` 一致，调用方据此降级）：
 *  - 页面级懒加载：`warm()` 才下载约 242 KB 的短版，`play()` 不做网络等待；
 *  - 素材未就绪 / 加载失败 / 浏览器不解码 alpha → `ready()` false，`play()` false，
 *    协调器按优先级退回 CSS 斜切兜底，不黑屏、不阻塞导航；
 *  - 视频**无声**（编码时 `-an`，元素也 muted），不暂停、不重建背景音乐服务；
 *  - 减少动态效果 / 省流量或 2G → 不预热也不播放，直接走斜切兜底；
 *  - 播放被浏览器拒绝（罕见）时保留不透明红底衬作为「红闪」降级，绝不出现绿幕穿帮。
 */

import { isCheapConnection, prefersReducedMotion } from "./crowd";

/** 短版素材（1280×720 / 30fps / VP9+yuva420p / 1.5 秒 / 无声 / 约 242 KB）。 */
export const ISEKAI_MEDIA_SRC = "/assets/clip/isekai-showcase.webm";

/** 短版时长；与协调器 `ISEKAI_WAIT_MS` 的目标一致，协调器仍会夹到 1–2 秒区间。 */
export const ISEKAI_WAIT_MS = 1_500;

/** 预热状态：把「有意跳过」「解码失败」「alpha 不被支持」分开，排查时不互相冒充。 */
export type IsekaiWarmState =
  | "not-warmed"
  | "warming"
  | "ready"
  | "failed"
  | "alpha-unsupported"
  | "reduced-motion"
  | "slow-connection";

/**
 * 判断一帧画布像素里是否真的有透明区域。
 *
 * 短版首帧有约 88% 的绿幕区域（编码时抠成 alpha=0）；如果浏览器忽略 VP9 alpha，
 * 同一帧会整屏不透明（绿幕）。因此「出现大量透明像素」就是 alpha 被解码的实证，
 * 也是把「不支持 alpha 的浏览器」挡在播放之前的唯一可靠办法 —— 不能只看
 * `canPlayType("video/webm")`，它不承诺 alpha 通道。
 */
export function frameHasAlpha(data: Uint8ClampedArray): boolean {
  let transparent = 0;
  let total = 0;
  for (let i = 3; i < data.length; i += 4) {
    total += 1;
    if ((data[i] ?? 255) < 32) transparent += 1;
  }
  return total > 0 && transparent / total > 0.5;
}

export class IsekaiEffect {
  /** 短版时长（毫秒）；由协调器 `waitForEffect` 读取并夹到 1–2 秒。 */
  readonly wait = ISEKAI_WAIT_MS;

  private readonly host: HTMLElement;
  private video: HTMLVideoElement | null = null;
  private warmState: IsekaiWarmState = "not-warmed";
  private playing = false;
  private destroyed = false;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  state(): IsekaiWarmState {
    return this.warmState;
  }

  ready(): boolean {
    return !this.destroyed && this.warmState === "ready";
  }

  /** 懒加载短版素材；幂等，重复调用不会建第二个 video。 */
  warm(): void {
    if (this.destroyed || this.warmState !== "not-warmed") return;
    if (prefersReducedMotion()) {
      this.warmState = "reduced-motion";
      return;
    }
    if (!isCheapConnection()) {
      this.warmState = "slow-connection";
      return;
    }
    this.warmState = "warming";
    const video = document.createElement("video");
    video.className = "isekai-video";
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.src = ISEKAI_MEDIA_SRC;
    video.addEventListener("loadeddata", this.onLoadedData, { once: true });
    video.addEventListener("error", this.onError);
    this.video = video;
    this.host.appendChild(video);
    video.load();
  }

  /** 返回是否真的开始播放；未就绪 / 被减动效时返回 false 由调用方退回斜切。 */
  play(): boolean {
    if (prefersReducedMotion() || !this.ready()) return false;
    const video = this.video;
    if (!video) return false;
    try {
      video.currentTime = 0;
    } catch {
      // 个别浏览器在可播放前赋值 currentTime 会抛 InvalidStateError；播放仍可继续。
    }
    this.host.classList.add("on");
    this.playing = true;
    try {
      const started = video.play();
      if (started && typeof started.catch === "function") {
        started.catch(() => this.degradeToRedFlash());
      }
    } catch {
      this.degradeToRedFlash();
    }
    return true;
  }

  stop(): void {
    this.playing = false;
    this.host.classList.remove("on");
    const video = this.video;
    if (!video) return;
    try {
      video.pause();
    } catch {
      // pause() 在极端状态（已卸载 / 解码器已释放）可能抛错，不影响退场。
    }
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    const video = this.video;
    this.video = null;
    if (!video) return;
    video.removeEventListener("loadeddata", this.onLoadedData);
    video.removeEventListener("error", this.onError);
    video.remove();
  }

  /** 首帧读回画布验证 alpha 通道；失败（忽略 alpha / 画布不可用）时返回 false。 */
  private verifyAlpha(): boolean {
    const video = this.video;
    if (!video) return false;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 36;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return frameHasAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch {
      // drawImage 在首帧未解码 / 画布被禁用时会抛错：按「不可播放」处理，退回斜切。
      return false;
    }
  }

  private onLoadedData = (): void => {
    if (this.destroyed || this.warmState !== "warming") return;
    this.warmState = this.verifyAlpha() ? "ready" : "alpha-unsupported";
  };

  private onError = (): void => {
    if (this.destroyed) return;
    this.warmState = "failed";
  };

  /**
   * 播放被拒时的降级：保留不透明红底衬当「红闪」，绝不暴露绿幕。
   * 协调器的等待时长已经确定，这里只改画面，不改导航时机。
   */
  private degradeToRedFlash(): void {
    if (this.destroyed) return;
    this.playing = false;
    this.warmState = "failed";
    try {
      this.video?.pause();
    } catch {
      // 同上，仅尽力而为。
    }
  }

  /** 调试探针用：当前是否处于播放态。 */
  isPlaying(): boolean {
    return this.playing;
  }
}
