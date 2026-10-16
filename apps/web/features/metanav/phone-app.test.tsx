/**
 * 手机内置应用模块的形状与退出清理（02 §4 / SHARED-CONTRACTS §4）。
 *
 * T00 需要这份形状来登记 manifest；`dispose` 必须真的取消未完成请求，
 * 否则「退出应用后晚到的响应写回状态」这条会被违反。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";
import { mockMatchMedia } from "@/tests/helpers/browser";
import type { NavigationRequest, PhoneHost, PhoneViewProps } from "@/features/phone/types";

import { createMemoryStateAdapter } from "./footprint";
import { activeRequestCount, abortAll } from "./inflight";
import MetanavPhoneView, { dispose, screens } from "./phone-app";
import { METANAV_SCREENS } from "./host";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/metanav",
  useSearchParams: () => new URLSearchParams(),
}));

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface HostCalls {
  openContent: Mock<(request: NavigationRequest) => void>;
  changeScreen: Mock<(screen: string, item?: string | null) => void>;
}

function stubHost(calls: HostCalls): PhoneHost {
  return {
    openApp: vi.fn(),
    navigateScreen: calls.changeScreen,
    back: vi.fn(),
    close: vi.fn(),
    openSiteContent: calls.openContent,
    toast: vi.fn(),
    audio: {
      isPlaying: () => false,
      play: () => undefined,
      pause: () => undefined,
      setVolume: () => undefined,
      getVolume: () => 1,
    },
    state: createMemoryStateAdapter(),
  };
}

let restoreMedia: () => void;

beforeEach(() => {
  resetDocument();
  restoreMedia = mockMatchMedia({ "(pointer: fine)": true });
});

afterEach(() => {
  abortAll();
  restoreMedia();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("模块形状", () => {
  it("screens 是完全部允许的屏幕集合（宿主用它回退非法 screen）", () => {
    expect(screens).toEqual(METANAV_SCREENS);
    expect([...screens]).toEqual(["palaces", "resolve", "search", "mugen"]);
  });

  it("默认导出是可渲染的组件：收到 PhoneViewProps 就能渲染出视图", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const calls: HostCalls = {
      openContent: vi.fn<(request: NavigationRequest) => void>(),
      changeScreen: vi.fn<(screen: string, item?: string | null) => void>(),
    };
    const props: PhoneViewProps = {
      screen: "palaces",
      item: null,
      mode: "expanded",
      host: stubHost(calls),
    };

    const view = render(<MetanavPhoneView {...props} />);
    await advance(20);
    expect(view.container.textContent).toContain("已发现殿堂");
    view.unmount();
  });
});

describe("退出清理", () => {
  it("dispose() 取消未完成的定位请求，晚到的响应不写回状态", async () => {
    let captured: AbortSignal | null = null;
    const fetchMock = vi.fn<FetchLike>((url, init) => {
      if (String(url).includes("/nav/resolve")) {
        captured = init?.signal ?? null;
        // 永不 resolve：模拟慢服务；只有 abort 能结束它。
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const calls: HostCalls = {
      openContent: vi.fn<(request: NavigationRequest) => void>(),
      changeScreen: vi.fn<(screen: string, item?: string | null) => void>(),
    };
    const view = render(
      <MetanavPhoneView
        screen="resolve"
        item={null}
        mode="expanded"
        host={stubHost(calls)}
      />,
    );
    await advance(20);

    const form = view.container.querySelector("form");
    for (const [field, value] of [
      ["name", "A"],
      ["location", "B"],
      ["cognition", "C"],
    ] as const) {
      const input = view.container.querySelector<HTMLInputElement>(`#metanav-${field}`);
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await advance(10);

    expect(activeRequestCount()).toBe(1);
    expect(captured).not.toBeNull();
    expect((captured as AbortSignal | null)?.aborted).toBe(false);

    dispose();
    expect(activeRequestCount()).toBe(0);
    expect((captured as AbortSignal | null)?.aborted).toBe(true);

    // 卸载后一切照旧：没有未处理拒绝，也没有回到「已找到」状态。
    view.unmount();
    await advance(10);
    expect(view.container.textContent ?? "").not.toContain("进入殿堂");
  });

  it("点「进入殿堂」用宿主能力并发送 metaverse-entry（不是自己播动画）", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              slug: "phantom-base",
              title: "怪盗据点工程",
              summary: "把博客改造成怪盗的基地",
              keywords: { name: "ScurryCat", location: "个人博客", cognition: "据点" },
              post_count: 4,
              published_at: "2026-10-01T00:00:00Z",
            },
          ],
          next_cursor: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const calls: HostCalls = {
      openContent: vi.fn<(request: NavigationRequest) => void>(),
      changeScreen: vi.fn<(screen: string, item?: string | null) => void>(),
    };
    const view = render(
      <MetanavPhoneView screen="palaces" item={null} mode="expanded" host={stubHost(calls)} />,
    );
    await advance(20);
    const button = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("进入殿堂"),
    );
    click(button ?? null);
    expect(calls.openContent).toHaveBeenCalledWith({
      destination: "/apps/metanav/palaces/phantom-base",
      source: "metaverse-entry",
    });
    view.unmount();
  });
});
