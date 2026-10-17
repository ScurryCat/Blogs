/**
 * 异世界短过场的接线测试（`TransitionLayer` + 共享导航协调器）。
 *
 * 媒体解码本身不在这里测（见 `isekai-effect.test.ts` 与浏览器证据）：
 * 这里用替身效果对象验证「真实驱动 → 协调器」的接线契约：
 *  - `TransitionLayer` 把 isekai 的 5 个槽位接到真实效果对象，不再返回「未就绪」；
 *  - 主动进入殿堂 → 只播异世界短版（不串播人群 / Joker），1.5 秒后提交；
 *  - 播放中出现 ≥44px 跳过按钮；点击 / Escape 立即提交，视觉由协调器统一收起；
 *  - 素材未就绪 → 斜切兜底，不进入短版遮罩，也不出现绿幕 / 黑屏。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import {
  NavigationProvider,
  useNavigation,
  type TransitionDebug,
} from "@/features/runtime/navigation/coordinator";
import {
  TransitionLayer,
  createProxyDriver,
  type TransitionHandle,
} from "@/features/runtime/navigation/transition-layer";
import { click, render, resetDocument } from "../helpers/render";
import { mockMatchMedia } from "../helpers/browser";

const fake = vi.hoisted(() => ({
  warmed: false,
  ready: false,
  playing: false,
  warmCalls: 0,
  playCalls: 0,
  stopCalls: 0,
  destroyed: false,
  wait: 1_500,
}));

vi.mock("@/features/runtime/effects/isekai", () => ({
  ISEKAI_WAIT_MS: 1_500,
  IsekaiEffect: class {
    readonly wait = fake.wait;

    constructor(private readonly host: HTMLElement) {}

    state(): string {
      if (fake.ready) return "ready";
      return fake.warmed ? "failed" : "not-warmed";
    }

    ready(): boolean {
      return fake.ready;
    }

    warm(): void {
      fake.warmed = true;
      fake.warmCalls += 1;
    }

    play(): boolean {
      if (!fake.ready) return false;
      fake.playCalls += 1;
      fake.playing = true;
      this.host.classList.add("on");
      return true;
    }

    stop(): void {
      fake.stopCalls += 1;
      fake.playing = false;
      this.host.classList.remove("on");
    }

    destroy(): void {
      fake.destroyed = true;
    }
  },
}));

const pushMock = vi.fn();
const assignMock = vi.fn();
let pathname = "/posts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => pathname,
}));

function resetFake(): void {
  fake.warmed = false;
  fake.ready = false;
  fake.playing = false;
  fake.warmCalls = 0;
  fake.playCalls = 0;
  fake.stopCalls = 0;
  fake.destroyed = false;
}

function Probe({ onReady }: { onReady: (navigation: ReturnType<typeof useNavigation>) => void }) {
  const navigation = useNavigation();
  onReady(navigation);
  return null;
}

interface Harness {
  handle(): TransitionHandle | null;
  navigation(): ReturnType<typeof useNavigation>;
  rerender(nextPathname: string): void;
  unmount(): void;
}

function mount(): Harness {
  let handle: TransitionHandle | null = null;
  let navigation: ReturnType<typeof useNavigation> | null = null;
  const driver = createProxyDriver(() => handle);

  const tree = () => (
    <NavigationProvider
      driver={driver}
      adapter={{ push: pushMock, assign: assignMock, pathname }}
    >
      <TransitionLayer onReady={(next) => (handle = next)} />
      <Probe onReady={(next) => (navigation = next)} />
    </NavigationProvider>
  );

  const view = render(tree());
  return {
    handle: () => handle,
    navigation: () => navigation as unknown as ReturnType<typeof useNavigation>,
    rerender: (nextPathname: string) => {
      pathname = nextPathname;
      act(() => {
        view.root.render(tree());
      });
    },
    unmount: () => view.unmount(),
  };
}

function skipButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".isekai-skip");
  if (!button) throw new Error("跳过按钮未渲染");
  return button;
}

function isekaiHost(): HTMLElement {
  const host = document.querySelector<HTMLElement>(".isekai");
  if (!host) throw new Error("异世界遮罩容器未渲染");
  return host;
}

let restoreMedia: () => void;

beforeEach(() => {
  resetDocument();
  pushMock.mockClear();
  assignMock.mockClear();
  resetFake();
  pathname = "/posts";
  window.history.replaceState({}, "", "/posts");
  restoreMedia = mockMatchMedia({ "(pointer: fine)": true });
  // jsdom 没有 canvas 2d：人群 / Joker 效果会各自退回未就绪（与真实浏览器无关），
  // 这里显式给出 null，避免 jsdom 反复打印 "Not implemented" 噪声。
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => null,
  });
  // 纯 fake timers（不随真实时间自动推进）：本文件的断言依赖「1.5 秒前/后」的精确时刻，
  // 共享工作区里并行构建会让真实时间抖动，自动推进会让 1500ms 提前触发造成假失败。
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreMedia();
});

function flush(ms = 0): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** 预热由空闲回调或首次交互触发；测试里直接派发 pointerdown，模拟真实点击。 */
async function warm(): Promise<void> {
  act(() => {
    window.dispatchEvent(new Event("pointerdown"));
  });
}

describe("TransitionLayer 的异世界驱动接线", () => {
  it("替身预热后驱动报告就绪；短版时长来自效果对象（1.5 秒）", async () => {
    fake.ready = true;
    const harness = mount();
    await warm();
    const handle = harness.handle();
    expect(handle).not.toBeNull();
    expect(fake.warmCalls).toBe(1);
    expect(handle?.driver.hasIsekai()).toBe(true);
    expect(handle?.driver.isekaiReady()).toBe(true);
    expect(handle?.driver.isekaiWait()).toBe(1_500);
    expect(handle?.debug().isekai).toMatchObject({ created: true, ready: true, playing: false });
    harness.unmount();
  });

  it("主动进入殿堂：只播异世界短版，1.5 秒后才提交，播放中出现跳过按钮", async () => {
    fake.ready = true;
    const harness = mount();
    await warm();
    act(() =>
      harness.navigation().navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );

    const debug = harness.navigation().debug() as TransitionDebug;
    expect(debug.kind).toBe("isekai");
    expect(debug.intent).toBe("enter-showcase");
    expect(fake.playCalls).toBe(1);
    expect(isekaiHost().classList.contains("on")).toBe(true);
    expect(skipButton().classList.contains("is-on")).toBe(true);
    expect(skipButton().textContent).toContain("跳过");
    // 跳过按钮是容器外的可访问控件：不是 aria-hidden 装饰层的一部分。
    expect(skipButton().getAttribute("aria-label")).toBe("跳过殿堂过场");

    expect(pushMock).not.toHaveBeenCalled();
    flush(1_490);
    expect(pushMock).not.toHaveBeenCalled();
    flush(20);
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    harness.unmount();
  });

  it("播放失败 / 未就绪 → 斜切兜底，不进入短版遮罩", async () => {
    fake.ready = false;
    const harness = mount();
    await warm();
    act(() =>
      harness.navigation().navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );

    expect(harness.navigation().debug().kind).toBe("wipe");
    expect(document.querySelector(".wipe")?.classList.contains("go")).toBe(true);
    expect(isekaiHost().classList.contains("on")).toBe(false);
    expect(skipButton().classList.contains("is-on")).toBe(false);
    flush(460);
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    harness.unmount();
  });

  it("点击跳过：立即提交目标，短版遮罩由协调器统一收起", async () => {
    fake.ready = true;
    const harness = mount();
    await warm();
    act(() =>
      harness.navigation().navigate({
        destination: "/showcase/projects/abc",
        source: "phone-link",
        intent: "enter-showcase",
      }),
    );
    expect(pushMock).not.toHaveBeenCalled();

    click(skipButton());
    expect(pushMock).toHaveBeenCalledWith("/showcase/projects/abc", { replace: false });
    expect(harness.navigation().navigating()).toBe(true); // 等完成信号收尾
    expect(isekaiHost().classList.contains("on")).toBe(false);
    expect(skipButton().classList.contains("is-on")).toBe(false);

    // 完成信号（pathname 变化）→ 统一退场。
    harness.rerender("/showcase/projects/abc");
    flush(200);
    expect(harness.navigation().navigating()).toBe(false);
    expect(isekaiHost().classList.contains("on")).toBe(false);
    harness.unmount();
  });

  it("Escape 跳过：只跳过一次场，不把 Escape 透传给下层容器", async () => {
    fake.ready = true;
    const harness = mount();
    await warm();
    act(() =>
      harness.navigation().navigate({
        destination: "/showcase",
        source: "map-travel",
        intent: "enter-showcase",
      }),
    );
    const received: KeyboardEvent[] = [];
    const onKey = (event: Event) => received.push(event as KeyboardEvent);
    window.addEventListener("keydown", onKey);
    try {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
    } finally {
      window.removeEventListener("keydown", onKey);
    }
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    expect(received).toHaveLength(0); // 捕获阶段已 stopImmediatePropagation
    expect(skipButton().classList.contains("is-on")).toBe(false);
    harness.unmount();
  });

  it("没有进入殿堂意图时，异世界槽位不参与（普通入口仍走既有来源规则）", async () => {
    fake.ready = true;
    const harness = mount();
    await warm();
    act(() =>
      harness.navigation().navigate({ destination: "/posts/hello", source: "top-nav" }),
    );
    expect(harness.navigation().debug().intent).toBeNull();
    expect(fake.playCalls).toBe(0);
    expect(isekaiHost().classList.contains("on")).toBe(false);
    expect(skipButton().classList.contains("is-on")).toBe(false);
    // 普通站内跳转沿既有来源规则（jsdom 没有 canvas 2d，Joker 帷幕会再退到斜切），
    // 但无论如何都不该落到异世界短版。
    expect(harness.navigation().debug().kind).not.toBe("isekai");
    harness.unmount();
  });

  it("殿堂内部切换内容不重播短版（边界判定在协调器，驱动只响应播放调用）", async () => {
    fake.ready = true;
    pathname = "/showcase/projects/a";
    window.history.replaceState({}, "", "/showcase/projects/a");
    const harness = mount();
    await warm();
    act(() =>
      harness.navigation().navigate({
        destination: "/showcase/projects/b",
        source: "top-nav",
      }),
    );
    expect(harness.navigation().debug().intent).toBeNull();
    expect(fake.playCalls).toBe(0);
    harness.unmount();
  });
});
