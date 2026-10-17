/**
 * 异世界短过场效果模块（`effects/isekai.ts`）的单元测试。
 *
 * jsdom 不实现媒体解码与 canvas 像素读取，这里用**可控替身**驱动状态机：
 *  - `stubMediaPlayback()` 提供 play / pause / load；
 *  - canvas 的 `getImageData` 返回我们构造的 RGBA 数据，用来验证「alpha 是否真的被解码」；
 *  - `loadeddata` / `error` 事件由测试手动派发，模拟素材加载的两种结局。
 *
 * 不在这里假装浏览器真的播放了 —— 真实播放证据由 N5 的 Playwright 检查给出。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ISEKAI_MEDIA_SRC,
  ISEKAI_WAIT_MS,
  IsekaiEffect,
  frameHasAlpha,
} from "@/features/runtime/effects/isekai";
import { mockMatchMedia, stubMediaPlayback } from "../helpers/browser";

/** 生成一帧画布像素：`transparentRatio` 比例的像素 alpha=0，其余不透明。 */
function makeFrame(transparentRatio: number): Uint8ClampedArray {
  const pixels = 64 * 36;
  const data = new Uint8ClampedArray(pixels * 4);
  const transparent = Math.round(pixels * transparentRatio);
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4;
    data[offset] = 72;
    data[offset + 1] = 255;
    data[offset + 2] = 0;
    data[offset + 3] = i < transparent ? 0 : 255;
  }
  return data;
}

let frame: Uint8ClampedArray;
const drawImage = vi.fn();
const getImageData = vi.fn();

function installCanvas(): void {
  getImageData.mockImplementation(() => ({ data: frame }));
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => ({ drawImage, getImageData }),
  });
}

let host: HTMLDivElement;
let restoreMedia: () => void;
let media: ReturnType<typeof stubMediaPlayback>;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  frame = makeFrame(0.88);
  drawImage.mockClear();
  getImageData.mockClear();
  installCanvas();
  restoreMedia = mockMatchMedia({ "(pointer: fine)": true });
  media = stubMediaPlayback();
});

afterEach(() => {
  restoreMedia();
  vi.restoreAllMocks();
});

function loaded(scope: HTMLElement): HTMLVideoElement {
  const video = scope.querySelector("video");
  if (!video) throw new Error("video 未创建");
  video.dispatchEvent(new Event("loadeddata"));
  return video;
}

describe("frameHasAlpha（纯函数）", () => {
  it("首帧出现大量透明像素 = alpha 被解码", () => {
    expect(frameHasAlpha(makeFrame(0.88))).toBe(true);
    expect(frameHasAlpha(makeFrame(0.51))).toBe(true);
  });

  it("整帧不透明（浏览器忽略 alpha）= 视为不支持", () => {
    expect(frameHasAlpha(makeFrame(0))).toBe(false);
    expect(frameHasAlpha(makeFrame(0.3))).toBe(false);
  });

  it("空数据不 crashing", () => {
    expect(frameHasAlpha(new Uint8ClampedArray(0))).toBe(false);
  });
});

describe("IsekaiEffect 状态机", () => {
  it("warm() 懒加载唯一一个静音视频，不阻塞页面", () => {
    const effect = new IsekaiEffect(host);
    expect(effect.state()).toBe("not-warmed");
    expect(media.load).not.toHaveBeenCalled();

    effect.warm();
    expect(effect.state()).toBe("warming");
    const videos = host.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const video = videos[0] as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(ISEKAI_MEDIA_SRC);
    expect(video.muted).toBe(true);
    expect(video.getAttribute("playsinline")).toBe("");
    expect(media.load).toHaveBeenCalledTimes(1);

    // 幂等：重复预热不再建第二个 video。
    effect.warm();
    expect(host.querySelectorAll("video")).toHaveLength(1);
  });

  it("首帧 alpha 校验通过 → ready，wait 为 1.5 秒", () => {
    const effect = new IsekaiEffect(host);
    effect.warm();
    loaded(host);
    expect(effect.state()).toBe("ready");
    expect(effect.ready()).toBe(true);
    expect(effect.wait).toBe(ISEKAI_WAIT_MS);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("浏览器忽略 alpha（整帧不透明）→ alpha-unsupported，play() 返回 false", () => {
    frame = makeFrame(0);
    const effect = new IsekaiEffect(host);
    effect.warm();
    loaded(host);
    expect(effect.state()).toBe("alpha-unsupported");
    expect(effect.ready()).toBe(false);
    expect(effect.play()).toBe(false);
    expect(host.classList.contains("on")).toBe(false);
  });

  it("加载失败 → failed，永不黑屏（不进入遮屏态）", () => {
    const effect = new IsekaiEffect(host);
    effect.warm();
    const video = host.querySelector("video");
    video?.dispatchEvent(new Event("error"));
    expect(effect.state()).toBe("failed");
    expect(effect.play()).toBe(false);
    expect(host.classList.contains("on")).toBe(false);
  });

  it("play() 加 on 类并从头播放，stop() 收起并暂停", () => {
    const effect = new IsekaiEffect(host);
    effect.warm();
    loaded(host);
    expect(effect.play()).toBe(true);
    expect(host.classList.contains("on")).toBe(true);
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(effect.isPlaying()).toBe(true);

    effect.stop();
    expect(host.classList.contains("on")).toBe(false);
    expect(media.pause).toHaveBeenCalled();
    expect(effect.isPlaying()).toBe(false);
  });

  it("播放被拒时保留红底衬降级（不抛错、不黑屏），状态记 failed", async () => {
    media.play.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));
    const effect = new IsekaiEffect(host);
    effect.warm();
    loaded(host);
    expect(effect.play()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(effect.state()).toBe("failed");
    // 不 remove on：纯红底衬继续遮屏到协调器统一退场。
    expect(host.classList.contains("on")).toBe(true);
  });

  it("destroy() 移除视频元素", () => {
    const effect = new IsekaiEffect(host);
    effect.warm();
    loaded(host);
    effect.play();
    effect.destroy();
    expect(host.querySelector("video")).toBeNull();
    expect(host.classList.contains("on")).toBe(false);
  });
});

describe("IsekaiEffect 降级判定", () => {
  it("减少动态效果 → 不预热、不播放", () => {
    restoreMedia();
    restoreMedia = mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    const effect = new IsekaiEffect(host);
    effect.warm();
    expect(effect.state()).toBe("reduced-motion");
    expect(host.querySelector("video")).toBeNull();
    expect(effect.play()).toBe(false);
  });

  it("省流量 / 2G → slow-connection，不下载素材", () => {
    const connection = { saveData: true, effectiveType: "3g" };
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: connection,
    });
    try {
      const effect = new IsekaiEffect(host);
      effect.warm();
      expect(effect.state()).toBe("slow-connection");
      expect(host.querySelector("video")).toBeNull();
    } finally {
      Reflect.deleteProperty(navigator as Navigator & { connection?: unknown }, "connection");
    }
  });
});
