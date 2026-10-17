/**
 * 迷你播放器（v2 任务书 §3.2）。
 *
 * jsdom 不实现媒体播放，这里只断言**可控的事实**：结构、状态文案、
 * 控件是否按快照禁用、拖动/键盘操作是否真的调到音频服务。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { AudioProvider } from "@/features/runtime/audio/audio-service";
import { MiniPlayer } from "@/features/runtime/audio/mini-player";
import { advance, click, render, resetDocument } from "../helpers/render";
import { stubMediaPlayback, mockMatchMedia } from "../helpers/browser";

let playback: ReturnType<typeof stubMediaPlayback>;
let restoreMedia: () => void;
let cleanups: (() => void)[] = [];

function mount(ui: ReactNode) {
  const view = render(ui);
  cleanups.push(view.unmount);
  return view;
}

function mountPlayer() {
  return mount(
    <AudioProvider>
      <MiniPlayer />
    </AudioProvider>,
  );
}

const bar = (view: ReturnType<typeof render>) => view.container.querySelector("[data-mini-player]");

beforeEach(() => {
  resetDocument();
  cleanups = [];
  playback = stubMediaPlayback();
  restoreMedia = mockMatchMedia();
});

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
  restoreMedia();
  vi.restoreAllMocks();
});

describe("迷你播放器：收起态", () => {
  it("显示曲名、播放状态与基础控制，默认不展开", async () => {
    const view = mountPlayer();
    await advance();
    expect(bar(view)?.getAttribute("data-state")).toBe("ready");
    expect(view.container.querySelector(".mini-title")?.textContent).toContain("Beneath the Mask");
    expect(view.container.querySelector(".mini-state")?.textContent).toBe("已暂停");
    expect(view.container.querySelector(".mini-panel")).toBeNull();
    // 三个基础控制都在
    for (const label of ["上一首", "播放", "下一首"]) {
      expect(view.container.querySelector(`.mini-btn[aria-label="${label}"]`)).not.toBeNull();
    }
    view.unmount();
  });

  it("点信息区展开面板：曲目、进度、音量、收起按钮都在", async () => {
    const view = mountPlayer();
    await advance();
    click(view.container.querySelector(".mini-open"));
    await advance();
    expect(view.container.querySelector(".mini-panel")).not.toBeNull();
    expect(view.container.querySelectorAll(".mini-item").length).toBeGreaterThan(0);
    expect(view.container.querySelector('input[aria-label="播放进度"]')).not.toBeNull();
    expect(view.container.querySelector('input[aria-label="音量"]')).not.toBeNull();
    expect(view.container.querySelector(".mini-collapse")).not.toBeNull();
    view.unmount();
  });

  it("收起按钮把面板关掉", async () => {
    const view = mountPlayer();
    await advance();
    click(view.container.querySelector(".mini-open"));
    await advance();
    click(view.container.querySelector(".mini-collapse"));
    await advance();
    expect(view.container.querySelector(".mini-panel")).toBeNull();
    view.unmount();
  });
});

describe("迷你播放器：控件真的作用到音频服务", () => {
  it("播放 / 暂停按钮调用同一个 audio 元素", async () => {
    const view = mountPlayer();
    await advance();
    click(view.container.querySelector('.mini-btn[aria-label="播放"]'));
    await advance();
    expect(playback.play).toHaveBeenCalled();
    view.unmount();
  });

  it("音量滑杆改 audio.volume", async () => {
    const view = mountPlayer();
    await advance();
    click(view.container.querySelector(".mini-open"));
    await advance();
    const element = document.querySelector<HTMLAudioElement>(`audio[${"data-pl-music"}]`)!;
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="音量"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "30");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await advance();
    expect(element.volume).toBeCloseTo(0.3, 5);
    view.unmount();
  });

  it("进度滑杆在**还没有时长**时禁用（不显示能拖但无效的控件）", async () => {
    const view = mountPlayer();
    await advance();
    click(view.container.querySelector(".mini-open"));
    await advance();
    const progress = view.container.querySelector<HTMLInputElement>('input[aria-label="播放进度"]')!;
    expect(progress.disabled).toBe(true);
    expect(view.container.querySelector(".mini-slider-v")?.textContent).toContain("--:--");
    view.unmount();
  });
});
