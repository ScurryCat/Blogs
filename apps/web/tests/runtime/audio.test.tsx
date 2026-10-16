/**
 * 音乐服务测试（01 §4、02 §7 的硬性约束）。
 *
 * jsdom **不实现媒体播放**：这里用替身记录 play / pause / load 的调用，
 * 只断言「元素数量、偏好读写、是否尝试播放」这些真实可控的事实，
 * 不断言音频真的响了（那属于真实浏览器 / 人工验证）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactNode } from "react";

import {
  AudioProvider,
  MUSIC_ELEMENT_ATTR,
  useAudioOrDefault,
  useAudioSnapshot,
} from "@/features/runtime/audio/audio-service";
import { advance, click, render, resetDocument } from "../helpers/render";
import { stubMediaPlayback, mockMatchMedia } from "../helpers/browser";

const legacyKey = (name: string) => `pl-app:site:v1:${name}`;

let playback: ReturnType<typeof stubMediaPlayback>;
let restoreMedia: () => void;
/** 每个用例注册一个卸载函数：即使断言失败也要卸载，避免上一个用例的宿主漏到下一个。 */
let cleanups: (() => void)[] = [];

function mount(ui: ReactNode) {
  const view = render(ui);
  cleanups.push(view.unmount);
  return view;
}

function MusicState(): ReactNode {
  const audio = useAudioOrDefault();
  const snapshot = useAudioSnapshot();
  return (
    <div>
      <span data-state>{snapshot.empty ? "empty" : snapshot.unavailable ? "unavailable" : "ready"}</span>
      <span data-title>{snapshot.title}</span>
      <span data-artist>{snapshot.artist}</span>
      {snapshot.empty || snapshot.unavailable ? null : (
        <button type="button" data-play onClick={() => audio.play()}>
          music-play
        </button>
      )}
    </div>
  );
}

function Controls(): ReactNode {
  const audio = useAudioOrDefault();
  return (
    <div>
      <button type="button" data-play onClick={() => audio.play()}>
        play
      </button>
      <button type="button" data-pause onClick={() => audio.pause()}>
        pause
      </button>
      <button type="button" data-vol onClick={() => audio.setVolume(0.25)}>
        vol
      </button>
      <span data-out>{`${audio.getVolume()}|${audio.soundEnabled()}`}</span>
    </div>
  );
}

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

describe("音乐：只有一个 audio 元素", () => {
  it("挂载后全站唯一的音乐元素带标记，且不再新增", async () => {
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    expect(document.querySelectorAll(`audio[${MUSIC_ELEMENT_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll("audio")).toHaveLength(1);

    // 模拟跨页：只换页面内容，不重建外壳。
    for (let index = 0; index < 20; index += 1) {
      await act(async () => {
        view.root.render(
          <AudioProvider>
            <Controls key={index} />
          </AudioProvider>,
        );
      });
    }
    await advance();
    expect(document.querySelectorAll(`audio[${MUSIC_ELEMENT_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    view.unmount();
  });

  it("播放 / 暂停 / 音量都作用于同一个元素", async () => {
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    const element = document.querySelector<HTMLAudioElement>(`audio[${MUSIC_ELEMENT_ATTR}]`)!;
    // 单一来源：沿用旧站同一个静态路径，不把音频再复制一份进 apps/web/public。
    expect(element.getAttribute("src")).toContain("/assets/music/");
    expect(element.getAttribute("src")).not.toContain("/assets/legacy/music/");

    click(view.container.querySelector("[data-play]"));
    await advance();
    expect(playback.play).toHaveBeenCalled();

    click(view.container.querySelector("[data-pause]"));
    await advance();
    expect(playback.pause).toHaveBeenCalled();
    expect(window.localStorage.getItem("pl-music")).toBe("off");

    click(view.container.querySelector("[data-vol]"));
    await advance();
    expect(element.volume).toBeCloseTo(0.25, 5);
    expect(window.localStorage.getItem("pl-vol")).toBe("0.25");
    view.unmount();
  });
});

describe("音乐偏好：版本化 + 旧站键迁移", () => {
  it("读取旧站 pl-vol / pl-track 并迁移到版本化键", async () => {
    window.localStorage.setItem("pl-vol", "0.2");
    window.localStorage.setItem("pl-track", "2");
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    const element = document.querySelector<HTMLAudioElement>(`audio[${MUSIC_ELEMENT_ATTR}]`)!;
    expect(element.volume).toBeCloseTo(0.2, 5);
    expect(element.getAttribute("src")).toContain("hoshi-to-bokura-to");
    // 版本化键写入后，旧键仍保留（旧站仍是正式站点，不能被迁移抹掉记忆）。
    expect(JSON.parse(window.localStorage.getItem(legacyKey("volume")) ?? "null")).toBe("0.2");
    expect(window.localStorage.getItem("pl-vol")).toBe("0.2");
    view.unmount();
  });

  it("用户上次关掉音乐（pl-music=off）时**不会**自动出声", async () => {
    window.localStorage.setItem("pl-music", "off");
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    // 先触发一次用户手势（解锁路径），再确认没有自动播放。
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerdown"));
      window.dispatchEvent(new Event("pl:booted"));
    });
    await advance();
    expect(playback.play).not.toHaveBeenCalled();
    view.unmount();
  });

  it("没有关闭记录时，用户手势后尝试自动播放一次", async () => {
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerdown"));
    });
    await advance();
    expect(playback.play).toHaveBeenCalledTimes(1);

    // 再点一次不会重复自动播放。
    await act(async () => {
      window.dispatchEvent(new Event("pl:booted"));
    });
    await advance();
    expect(playback.play).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("存储不可用（无痕 / 抛异常）时音乐仍然可用，只是记不住", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      const view = mount(
        <AudioProvider>
          <Controls />
        </AudioProvider>,
      );
      await advance();
      expect(document.querySelectorAll(`audio[${MUSIC_ELEMENT_ATTR}]`)).toHaveLength(1);
      click(view.container.querySelector("[data-play]"));
      await advance();
      expect(playback.play).toHaveBeenCalled();
      expect(view.container.querySelector("[data-out]")).not.toBeNull();
      view.unmount();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("取不到音频时不冒充「没有曲子」", () => {
  it("元素报错后进入 unavailable 状态，文案指向真实原因", async () => {
    const view = mount(
      <AudioProvider>
        <MusicState />
      </AudioProvider>,
    );
    await advance();
    const element = document.querySelector<HTMLAudioElement>(`audio[${MUSIC_ELEMENT_ATTR}]`)!;
    await act(async () => {
      element.dispatchEvent(new Event("error"));
    });
    await advance();
    expect(view.container.querySelector("[data-state]")?.textContent).toBe("unavailable");
    expect(view.container.querySelector("[data-title]")?.textContent).toContain("取不到");
    // 取不到音频时播放按钮不可点，不假装能播。
    expect(view.container.querySelector("[data-play]")).toBeNull();
  });
});

describe("音效开关", () => {
  it("pl-sound=off 时默认关闭，且写回旧站键", async () => {
    window.localStorage.setItem("pl-sound", "off");
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    expect(view.container.querySelector("[data-out]")?.textContent).toBe("0.6|false");
    view.unmount();
  });

  it("默认开启并记住选择", async () => {
    const view = mount(
      <AudioProvider>
        <Controls />
      </AudioProvider>,
    );
    await advance();
    expect(view.container.querySelector("[data-out]")?.textContent).toBe("0.6|true");
    view.unmount();
  });
});
