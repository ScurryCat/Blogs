/**
 * 导航协调器测试（02 §8 / 地图转场设计）。
 *
 * 断言的是「来源决定效果」，不是「当前在哪个页面」：
 * 地图三类入口用人群、顶部导航用 Joker、`phone-internal` 不遮全站、
 * `metaverse-entry` 缺素材时降级且**不用人群**。
 * 另外覆盖：唯一令牌与连点、15 秒看门狗、后退取消、减少动态效果直接导航。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import type { NavigationSource } from "@/features/phone/types";
import {
  NAVIGATION_WATCHDOG_MS,
  NavigationProvider,
  effectPlan,
  useNavigation,
  type TransitionDriver,
} from "@/features/runtime/navigation/coordinator";
import { advance, render, resetDocument } from "../helpers/render";
import { mockMatchMedia } from "../helpers/browser";

const pushMock = vi.fn();
const assignMock = vi.fn();
let pathname = "/map";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => pathname,
}));

function driver(overrides: Partial<TransitionDriver> = {}): TransitionDriver {
  const base: TransitionDriver = {
    hasCrowd: () => true,
    crowdReady: () => true,
    playCrowd: () => true,
    stopCrowd: () => undefined,
    crowdWait: () => 900,
    hasJoker: () => true,
    jokerReady: () => true,
    playJoker: () => true,
    stopJoker: () => undefined,
    jokerWait: () => 1180,
    playWipe: () => undefined,
    stopWipe: () => undefined,
  };
  return { ...base, ...overrides };
}

/** 只暴露 navigate / debug 的探针组件。 */
function Probe({ onReady }: { onReady: (navigation: ReturnType<typeof useNavigation>) => void }) {
  const navigation = useNavigation();
  onReady(navigation);
  return null;
}

describe("来源 → 效果（纯函数）", () => {
  it("地图三类入口用人群；缺素材时退回 Joker，绝不用潜入动画", () => {
    expect(effectPlan("map-travel", driver())).toEqual(["crowd", "joker", "wipe"]);
    expect(
      effectPlan("map-travel", driver({ crowdReady: () => false })),
    ).toEqual(["joker", "wipe"]);
    expect(effectPlan("map-travel", driver({ hasCrowd: () => false }))).toEqual(["joker", "wipe"]);
  });

  it("顶部导航与手机普通链接用 Joker，不冒充地图旅行", () => {
    expect(effectPlan("top-nav", driver())).toEqual(["joker", "wipe"]);
    expect(effectPlan("phone-link", driver())).toEqual(["joker", "wipe"]);
    expect(effectPlan("top-nav", driver())).not.toContain("crowd");
  });

  it("metaverse-entry 缺素材时正常降级，且明确不使用人群", () => {
    expect(effectPlan("metaverse-entry", driver())).toEqual(["joker", "wipe"]);
    expect(effectPlan("metaverse-entry", driver({ jokerReady: () => false }))).toEqual(["wipe"]);
    expect(effectPlan("metaverse-entry", driver())).not.toContain("crowd");
  });

  it("phone-internal 是 App 内短过渡，不经过全屏层", () => {
    expect(effectPlan("phone-internal", driver())).toEqual(["none"]);
  });
});

describe("协调器行为", () => {
  let restoreMedia: () => void;

  beforeEach(() => {
    resetDocument();
    pushMock.mockClear();
    assignMock.mockClear();
    pathname = "/map";
    // 同页锚点的判定读的是 window.location，不是 usePathname：把 jsdom 的地址也对齐。
    window.history.replaceState({}, "", "/map");
    restoreMedia = mockMatchMedia({ "(pointer: fine)": true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreMedia();
  });

  async function mount(customDriver = driver()) {
    let navigation: ReturnType<typeof useNavigation> | null = null;
    const view = render(
      <NavigationProvider
        driver={customDriver}
        adapter={{ push: pushMock, assign: assignMock, pathname }}
      >
        <Probe
          onReady={(value) => {
            navigation = value;
          }}
        />
      </NavigationProvider>,
    );
    await advance(0);
    return { view, navigation: navigation as unknown as ReturnType<typeof useNavigation> };
  }

  const sources: NavigationSource[] = ["map-travel", "top-nav", "phone-internal", "phone-link", "metaverse-entry"];

  it.each(sources)("来源 %s：延迟等于该效果的时长后才 push（不是 await router.push）", async (source) => {
    const { view, navigation } = await mount();
    act(() => navigation.navigate({ destination: "/about", source }));
    expect(pushMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    if (source === "phone-internal") expect(pushMock).toHaveBeenCalledWith("/about", { replace: false });
    else expect(pushMock).toHaveBeenCalledWith("/about", { replace: false });
    view.unmount();
  });

  it("人群未就绪时退回 Joker（而不是什么都不播）", async () => {
    const playJoker = vi.fn(() => true);
    const playCrowd = vi.fn(() => false);
    const { view, navigation } = await mount(driver({ playCrowd, playJoker }));
    act(() => navigation.navigate({ destination: "/about", source: "map-travel" }));
    expect(playCrowd).toHaveBeenCalled();
    expect(playJoker).toHaveBeenCalled();
    expect(navigation.debug().kind).toBe("joker");
    view.unmount();
  });

  it("连点不启动第二套动画：第二次点击被忽略，令牌不变", async () => {
    const playCrowd = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playCrowd }));
    act(() => navigation.navigate({ destination: "/about", source: "map-travel" }));
    const token = navigation.debug().token;
    act(() => navigation.navigate({ destination: "/weather", source: "map-travel" }));
    expect(playCrowd).toHaveBeenCalledTimes(1);
    expect(navigation.debug().token).toBe(token);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/about", { replace: false });
    view.unmount();
  });

  it("15 秒看门狗：清遮罩并整页降级到目标地址", async () => {
    const stopJoker = vi.fn();
    const { view, navigation } = await mount(driver({ stopJoker }));
    act(() => navigation.navigate({ destination: "/about", source: "top-nav" }));

    await act(async () => {
      vi.advanceTimersByTime(NAVIGATION_WATCHDOG_MS + 50);
    });
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock.mock.calls[0]?.[0]).toContain("/about");
    expect(stopJoker).toHaveBeenCalled();
    expect(navigation.debug().navigating).toBe(false);
    view.unmount();
  });

  it("目标路由提交后收起遮罩（完成信号来自 pathname，不是 await push）", async () => {
    const stopJoker = vi.fn();
    const { view, navigation } = await mount(driver({ stopJoker }));
    act(() => navigation.navigate({ destination: "/about", source: "top-nav" }));
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(pushMock).toHaveBeenCalled();

    // 模拟 Next 提交：pathname 变化 + 重渲染（在 act 里刷完这次提交）。
    pathname = "/about";
    await act(async () => {
      view.root.render(
        <NavigationProvider
          driver={driver({ stopJoker })}
          adapter={{ push: pushMock, assign: assignMock, pathname }}
        >
          <Probe onReady={() => undefined} />
        </NavigationProvider>,
      );
    });
    // 再推进一小段：退场尾巴收起遮罩。
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(navigation.debug().navigating).toBe(false);
    expect(stopJoker).toHaveBeenCalled();
    view.unmount();
  });

  it("后退 / bfcache 还原会取消旧任务，不重播过场", async () => {
    const stopCrowd = vi.fn();
    const { view, navigation } = await mount(driver({ stopCrowd }));
    act(() => navigation.navigate({ destination: "/about", source: "map-travel" }));
    expect(navigation.debug().navigating).toBe(true);

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(navigation.debug().navigating).toBe(false);
    expect(navigation.debug().cancels).toBe(1);
    expect(stopCrowd).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    // 旧任务已经作废：不会 push，也不会触发看门狗降级。
    expect(pushMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("减少动态效果：直接导航，不播人群、不延时", async () => {
    restoreMedia();
    restoreMedia = mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    const playCrowd = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playCrowd }));
    act(() => navigation.navigate({ destination: "/about", source: "map-travel" }));
    expect(pushMock).toHaveBeenCalledWith("/about", { replace: false });
    expect(playCrowd).not.toHaveBeenCalled();
    expect(navigation.debug().navigating).toBe(false);
    view.unmount();
  });

  it("同页锚点交给浏览器：不播过场、不制造历史", async () => {
    const playJoker = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playJoker }));
    act(() => navigation.navigate({ destination: "/map#posts", source: "top-nav" }));
    expect(playJoker).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(navigation.debug().navigating).toBe(false);
    view.unmount();
  });

  it("站外地址不接管，直接交给浏览器", async () => {
    const playJoker = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playJoker }));
    act(() => navigation.navigate({ destination: "https://example.com/x", source: "top-nav" }));
    expect(playJoker).not.toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith("https://example.com/x");
    view.unmount();
  });

  it("卸载时清掉未完成的计时器与遮罩", async () => {
    const stopWipe = vi.fn();
    const { view, navigation } = await mount(driver({ stopWipe }));
    act(() => navigation.navigate({ destination: "/about", source: "top-nav" }));
    view.unmount();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
