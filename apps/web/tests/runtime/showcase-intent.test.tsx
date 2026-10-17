/**
 * 「主动跨入作品殿堂」的共享契约测试（第三轮任务书 §6.1 / §6.2）。
 *
 * 这里只钉契约，不测具体媒体资产（短版素材与播放由 N5 负责）：
 *  - 边界判定：殿堂内部、旧照片深链、palaces 路径都不产生意图；
 *  - 效果优先级：减少动效 → 直接提交；明确意图 → 异世界短版；否则来源规则；
 *  - 一次导航只播一套主效果（意图优先时**不串播**人群 / Joker）；
 *  - 手机目标 App / screen / item 提交也能结束过场（pathname 没变）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import type { NavigationSource } from "@/features/phone/types";
import {
  ISEKAI_MAX_MS,
  ISEKAI_MIN_MS,
  ISEKAI_WAIT_MS,
  NavigationProvider,
  effectPlan,
  useNavigation,
  waitForEffect,
  type TransitionDriver,
} from "@/features/runtime/navigation/coordinator";
import {
  isInsideShowcase,
  isShowcasePath,
  showcaseEntryIntent,
} from "@/features/runtime/navigation/showcase-boundary";
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
    hasIsekai: () => true,
    isekaiReady: () => true,
    playIsekai: () => true,
    stopIsekai: () => undefined,
    isekaiWait: () => ISEKAI_WAIT_MS,
  };
  return { ...base, ...overrides };
}

function Probe({ onReady }: { onReady: (navigation: ReturnType<typeof useNavigation>) => void }) {
  const navigation = useNavigation();
  onReady(navigation);
  return null;
}

describe("殿堂边界判定", () => {
  it("只有 /showcase 内容边界算殿堂", () => {
    expect(isShowcasePath("/showcase")).toBe(true);
    expect(isShowcasePath("/showcase/projects/abc")).toBe(true);
    expect(isShowcasePath("/showcase/")).toBe(true);
  });

  it("旧照片深链、其他内容路径都不算殿堂", () => {
    expect(isShowcasePath("/showcase/photos")).toBe(false);
    expect(isShowcasePath("/showcase/photos?album=x")).toBe(false);
    expect(isShowcasePath("/showcase/photos/album")).toBe(false);
    expect(isShowcasePath("/posts")).toBe(false);
    expect(isShowcasePath("/apps/metanav/palaces/abc")).toBe(false);
    expect(isShowcasePath("/showcaseish")).toBe(false);
  });

  it("殿堂内部（页面或手机应用）不再产生进入意图", () => {
    expect(isInsideShowcase("/showcase/projects/a")).toBe(true);
    expect(isInsideShowcase("/", "showcase")).toBe(true);
    expect(isInsideShowcase("/", "home")).toBe(false);

    expect(
      showcaseEntryIntent("/showcase", { pathname: "/showcase/projects/a" }),
    ).toBeNull();
    expect(showcaseEntryIntent("/showcase", { pathname: "/", phoneApp: "showcase" })).toBeNull();
  });

  it("殿堂外进入殿堂产生唯一意图，不改目的地", () => {
    expect(showcaseEntryIntent("/showcase", { pathname: "/" })).toBe("enter-showcase");
    expect(
      showcaseEntryIntent("/showcase/projects/abc?tab=1", { pathname: "/posts" }),
    ).toBe("enter-showcase");
    // 不产生意图的目的地。
    expect(showcaseEntryIntent("/showcase/photos", { pathname: "/" })).toBeNull();
    expect(showcaseEntryIntent("/gallery", { pathname: "/" })).toBeNull();
    expect(showcaseEntryIntent("https://example.com/showcase", { pathname: "/" })).toBeNull();
  });
});

describe("效果优先级（纯函数）", () => {
  it("明确进入殿堂 → 异世界短版优先，不串播人群 / Joker", () => {
    const plan = effectPlan("top-nav", driver(), "enter-showcase");
    expect(plan).toEqual(["isekai", "wipe"]);
    expect(plan).not.toContain("crowd");
    expect(plan).not.toContain("joker");
    // 意图优先于来源规则：地图来源也不播人群。
    expect(effectPlan("map-travel", driver(), "enter-showcase")).toEqual(["isekai", "wipe"]);
  });

  it("短版素材缺失 / 未就绪 → 斜切兜底，仍然不用人群与 Joker", () => {
    expect(effectPlan("top-nav", driver({ hasIsekai: () => false }), "enter-showcase")).toEqual([
      "wipe",
    ]);
    expect(effectPlan("top-nav", driver({ isekaiReady: () => false }), "enter-showcase")).toEqual([
      "wipe",
    ]);
  });

  it("没有意图时完全沿用既有来源规则", () => {
    expect(effectPlan("map-travel", driver())).toEqual(["crowd", "joker", "wipe"]);
    expect(effectPlan("phone-internal", driver())).toEqual(["none"]);
  });

  it("短版时长夹在 1–2 秒：默认 1.5 秒", () => {
    expect(waitForEffect("isekai", driver())).toBe(ISEKAI_WAIT_MS);
    expect(waitForEffect("isekai", driver({ isekaiWait: () => 9_000 }))).toBe(ISEKAI_MAX_MS);
    expect(waitForEffect("isekai", driver({ isekaiWait: () => 200 }))).toBe(ISEKAI_MIN_MS);
    expect(waitForEffect("isekai", driver({ isekaiWait: () => 0 }))).toBe(ISEKAI_WAIT_MS);
  });
});

describe("协调器：意图与手机完成信号", () => {
  let restoreMedia: () => void;

  beforeEach(() => {
    resetDocument();
    pushMock.mockClear();
    assignMock.mockClear();
    pathname = "/map";
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

  it("主动进入殿堂：1.5 秒后提交路由，期间只播异世界短版", async () => {
    const playIsekai = vi.fn(() => true);
    const playCrowd = vi.fn(() => true);
    const playJoker = vi.fn(() => true);
    const { view, navigation } = await mount(
      driver({ playIsekai, playCrowd, playJoker }),
    );

    act(() =>
      navigation.navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    expect(playIsekai).toHaveBeenCalledTimes(1);
    expect(playCrowd).not.toHaveBeenCalled();
    expect(playJoker).not.toHaveBeenCalled();
    expect(navigation.debug().kind).toBe("isekai");
    expect(navigation.debug().intent).toBe("enter-showcase");

    expect(pushMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(ISEKAI_WAIT_MS - 10);
    });
    expect(pushMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    view.unmount();
  });

  it("短版未就绪：斜切兜底后照常进入，不黑屏、不等待整段视频", async () => {
    const playIsekai = vi.fn(() => false);
    const playWipe = vi.fn();
    const { view, navigation } = await mount(
      driver({ playIsekai, playWipe, isekaiReady: () => false }),
    );
    act(() =>
      navigation.navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    expect(playIsekai).not.toHaveBeenCalled();
    expect(playWipe).toHaveBeenCalled();
    expect(navigation.debug().kind).toBe("wipe");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    view.unmount();
  });

  it("减少动态效果：不播短版，直接提交", async () => {
    restoreMedia();
    restoreMedia = mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    const playIsekai = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playIsekai }));
    act(() =>
      navigation.navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    expect(playIsekai).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    expect(navigation.debug().navigating).toBe(false);
    view.unmount();
  });

  it("殿堂外进入作品详情时自动判定边界（外部入口不需要逐条标注来源）", async () => {
    const playIsekai = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playIsekai }));
    act(() => navigation.navigate({ destination: "/showcase/projects/abc", source: "phone-link" }));
    expect(navigation.debug().intent).toBe("enter-showcase");
    expect(playIsekai).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("已在殿堂内部切换内容：不重播过场，按来源规则处理", async () => {
    pathname = "/showcase/projects/a";
    window.history.replaceState({}, "", "/showcase/projects/a");
    const playIsekai = vi.fn(() => true);
    const playJoker = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playIsekai, playJoker }));
    act(() =>
      navigation.navigate({
        destination: "/showcase/projects/b",
        source: "top-nav",
      }),
    );
    expect(navigation.debug().intent).toBeNull();
    expect(playIsekai).not.toHaveBeenCalled();
    expect(playJoker).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("手机目标提交完成也能结束过场（pathname 没变）", async () => {
    const stopIsekai = vi.fn();
    const { view, navigation } = await mount(driver({ stopIsekai }));
    act(() =>
      navigation.navigate({
        destination: "/map?phone=showcase",
        source: "phone-internal",
        intent: "enter-showcase",
      }),
    );
    expect(navigation.debug().navigating).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(ISEKAI_WAIT_MS + 20);
    });
    expect(pushMock).toHaveBeenCalledWith("/map?phone=showcase", { replace: false });

    // 错误的手机目标不能结束（防止晚到回调误清新任务）。
    act(() => navigation.commitPhoneTarget({ phone: "ins", screen: null, item: null }));
    expect(navigation.debug().navigating).toBe(true);

    // 期望目标提交 → 结束。
    act(() => navigation.commitPhoneTarget({ phone: "showcase", screen: null, item: null }));
    expect(navigation.debug().navigating).toBe(false);
    view.unmount();
  });

  it("跳过：立即提交目标地址，不等满 1.5 秒；视觉在完成信号后收起", async () => {
    const playIsekai = vi.fn(() => true);
    const stopIsekai = vi.fn();
    const { view, navigation } = await mount(driver({ playIsekai, stopIsekai }));
    act(() =>
      navigation.navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    expect(pushMock).not.toHaveBeenCalled();

    act(() => navigation.skip());
    expect(pushMock).toHaveBeenCalledWith("/showcase", { replace: false });
    expect(stopIsekai).toHaveBeenCalled();

    // 完成信号（pathname 提交）到达后才收尾，遮罩不在页面切换前先撤。
    pathname = "/showcase";
    await act(async () => {
      view.root.render(
        <NavigationProvider
          driver={driver()}
          adapter={{ push: pushMock, assign: assignMock, pathname }}
        >
          <Probe onReady={() => undefined} />
        </NavigationProvider>,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(navigation.debug().navigating).toBe(false);
    view.unmount();
  });

  it("没有进行中的导航时，跳过是 no-op", async () => {
    const { view, navigation } = await mount();
    act(() => navigation.skip());
    expect(pushMock).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("只改查询串的提交也能结束过场（不依赖 usePathname 变化）", async () => {
    const pushAndCommit = vi.fn((destination: string) => {
      window.history.replaceState({}, "", destination);
    });
    let navigation: ReturnType<typeof useNavigation> | null = null;
    const view = render(
      <NavigationProvider
        driver={driver({ isekaiReady: () => false })}
        adapter={{ push: pushAndCommit, assign: assignMock, pathname }}
      >
        <Probe
          onReady={(value) => {
            navigation = value;
          }}
        />
      </NavigationProvider>,
    );
    await advance(0);
    act(() =>
      (navigation as unknown as ReturnType<typeof useNavigation>).navigate({
        destination: "/map?view=albums",
        source: "top-nav",
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(1_300);
    });
    expect(pushAndCommit).toHaveBeenCalledWith("/map?view=albums", { replace: false });
    expect(
      (navigation as unknown as ReturnType<typeof useNavigation>).debug().navigating,
    ).toBe(false);
    view.unmount();
  });

  it("连点不重复播放：第二次点击被忽略", async () => {
    const playIsekai = vi.fn(() => true);
    const { view, navigation } = await mount(driver({ playIsekai }));
    act(() =>
      navigation.navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    act(() =>
      navigation.navigate({
        destination: "/showcase/projects/x",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    expect(playIsekai).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("后退取消收起短版遮罩，不继续提交", async () => {
    const stopIsekai = vi.fn();
    const { view, navigation } = await mount(driver({ stopIsekai }));
    act(() =>
      navigation.navigate({
        destination: "/showcase",
        source: "top-nav",
        intent: "enter-showcase",
      }),
    );
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(navigation.debug().navigating).toBe(false);
    expect(stopIsekai).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(pushMock).not.toHaveBeenCalled();
    view.unmount();
  });
});

const sources: NavigationSource[] = ["top-nav", "map-travel", "phone-link", "metaverse-entry"];
it.each(sources)("未标注意图的来源 %s 不因目的地是殿堂而改播短版（由调用方声明边界）", (source) => {
  // 纯函数层面：没有意图参数时来源规则原样返回。
  const plan = effectPlan(source, driver());
  expect(plan).not.toContain("isekai");
});
