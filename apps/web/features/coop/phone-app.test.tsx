/**
 * 手机内置应用模块的形状与退出清理（02 §4 / SHARED-CONTRACTS §4）。
 *
 * T00 需要这份形状来登记 manifest；`dispose` 必须真的取消未完成请求，
 * 否则「退出应用后晚到的响应写回状态」这条会被违反。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { PhoneHost, PhoneViewProps } from "@/features/phone/types";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { activeRequestCount, abortAll } from "./inflight";
import CoopPhoneView, { COOP_SCREENS, dispose, screens } from "./phone-app";
import { linkSummary, stubFetch } from "./test-support";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/coop",
  useSearchParams: () => new URLSearchParams(),
}));

function stubHost(): { host: PhoneHost; navigateScreen: Mock<(screen: string, item?: string | null) => void> } {
  const navigateScreen = vi.fn<(screen: string, item?: string | null) => void>();
  const host: PhoneHost = {
    openApp: vi.fn(),
    navigateScreen,
    back: vi.fn(),
    close: vi.fn(),
    openSiteContent: vi.fn(),
    toast: vi.fn(),
    audio: {
      isPlaying: () => false,
      play: () => undefined,
      pause: () => undefined,
      setVolume: () => undefined,
      getVolume: () => 1,
    },
    state: {
      get: <T,>(_appId: string, _key: string, fallback: T) => fallback,
      set: () => ({ persisted: true }),
      clear: () => undefined,
    },
  };
  return { host, navigateScreen };
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  abortAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("模块形状", () => {
  it("screens 是完全允许的屏幕集合", () => {
    expect([...screens]).toEqual(["links"]);
    expect(screens).toBe(COOP_SCREENS);
  });

  it("默认导出是可渲染的组件：收到 PhoneViewProps 就能渲染出视图", async () => {
    stubFetch({ links: [linkSummary({ name: "手机里的站点" })] });
    const { host } = stubHost();
    const props: PhoneViewProps = { screen: "links", item: null, mode: "expanded", host };

    const view = render(<CoopPhoneView {...props} />);
    await advance(20);

    expect(view.container.querySelector("[data-coop-view='phone']")).not.toBeNull();
    expect(view.container.textContent).toContain("手机里的站点");
    view.unmount();
  });

  it("展开一条友链走 host.navigateScreen（phone-internal，不遮盖全站）", async () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    stubFetch({
      links: [linkSummary({ id, has_story: true })],
      detail: { ...linkSummary({ id, has_story: true }), story: "故事" },
    });
    const { host, navigateScreen } = stubHost();
    const view = render(
      <CoopPhoneView screen="links" item={null} mode="expanded" host={host} />,
    );
    await advance(20);

    const toggle = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("展开相识故事"),
    );
    click(toggle ?? null);
    expect(navigateScreen).toHaveBeenCalledWith("links", id);
    view.unmount();
  });

  it("非法 screen 不会让应用崩掉（宿主回退桌面之外仍能渲染列表）", async () => {
    stubFetch({ links: [] });
    const { host } = stubHost();
    const view = render(
      <CoopPhoneView screen="unknown-screen" item={null} mode="compact" host={host} />,
    );
    await advance(20);

    expect(view.container.querySelector("[data-coop-view='phone']")).not.toBeNull();
    view.unmount();
  });
});

describe("退出清理", () => {
  it("dispose() 取消未完成的列表请求，晚到的响应不写回状态", async () => {
    let captured: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        captured = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );
    const { host } = stubHost();
    const view = render(<CoopPhoneView screen="links" item={null} mode="expanded" host={host} />);
    await advance(20);

    expect(activeRequestCount()).toBeGreaterThan(0);
    expect(captured).not.toBeNull();

    dispose();
    expect(activeRequestCount()).toBe(0);
    expect((captured as AbortSignal | null)?.aborted).toBe(true);

    view.unmount();
    await advance(10);
    expect(view.container.querySelector("[data-coop-state='ready']")).toBeNull();
  });
});
