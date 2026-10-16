/**
 * 放课后视图的组件行为（验收 3）。
 *
 *  - 两个页签共用同一组端点（只换 `kind`），不建两套接口；
 *  - 总数未知时**不画进度条**、不显示百分比，只显示「看到第 6 集」；
 *  - 未评分显示「未评分」；
 *  - 剧透短评默认折叠，点了才展开；
 *  - 空结果不虚构条目，也不出现任何第三方同步字样；
 *  - `dispose()` 取消未完成请求。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";
import { mockMatchMedia } from "@/tests/helpers/browser";
import type { PhoneViewProps } from "@/features/phone/types";

import { abortAll, activeRequestCount, track } from "./inflight";
import { LeisureView } from "./leisure-view";
import { createMemoryStateAdapter } from "./state";
import type { LeisureHost } from "./host";
import type { LeisureEntry } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/leisure",
  useSearchParams: () => new URLSearchParams(),
}));

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function animeEntry(overrides: Partial<LeisureEntry> = {}): LeisureEntry {
  return {
    id: "a1",
    kind: "anime",
    title: "某部正在看的番",
    progress: "watching",
    progress_label: "在看",
    rating: null,
    notes: "",
    notes_have_spoilers: false,
    cover: null,
    anime: {
      season: "2026 春",
      episodes_watched: 6,
      total_episodes: null,
      last_watched_on: null,
      airing: true,
      episodes_label: "看到第 6 集",
      completion_ratio: null,
    },
    game: null,
    review: null,
    updated_at: "2026-10-16T00:00:00Z",
    ...overrides,
  };
}

function stubHost(): { host: LeisureHost; screens: string[] } {
  const screens: string[] = [];
  return {
    screens,
    host: {
      mode: "site",
      openContent: () => undefined,
      changeScreen(screen) {
        screens.push(screen);
      },
      state: createMemoryStateAdapter(),
      toast: () => undefined,
    },
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

describe("追番页签", () => {
  it("总数未知：显示「看到第 6 集」，不画进度条、不显示百分比", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () => json({ items: [animeEntry()], next_cursor: null })),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);

    const text = view.container.textContent ?? "";
    expect(text).toContain("看到第 6 集");
    expect(text).toContain("总集数还不确定，因此不显示完成率。");
    expect(text).not.toContain("%");
    // 进度条只在有完成率时渲染。
    expect(view.container.querySelector('[role="img"]')).toBeNull();
    expect(text).toContain("未评分");
    view.unmount();
  });

  it("总数已知：画进度条并显示百分比", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        json({
          items: [
            animeEntry({
              anime: {
                season: null,
                episodes_watched: 6,
                total_episodes: 12,
                last_watched_on: null,
                airing: null,
                episodes_label: "看到第 6 / 12 集",
                completion_ratio: 0.5,
              },
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);

    expect(view.container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "已看 50%",
    );
    expect(view.container.textContent ?? "").toContain("看到第 6 / 12 集");
    view.unmount();
  });

  it("剧透短评默认折叠，点了才展开", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        json({
          items: [animeEntry({ notes: "结局其实是……", notes_have_spoilers: true })],
          next_cursor: null,
        }),
      ),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);

    expect(view.container.textContent ?? "").toContain("含剧透，默认折叠");
    expect(view.container.textContent ?? "").not.toContain("结局其实是……");

    const toggle = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("展开剧透"),
    );
    click(toggle ?? null);
    expect(view.container.textContent ?? "").toContain("结局其实是……");
    view.unmount();
  });

  it("请求只带 kind=anime；界面明确声明「手动维护、不同步第三方」", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/leisure/entries?kind=anime&limit=30");
    // 文案里**说明**「不同步第三方」是正确的（读者需要知道这一点）；
    // 被禁止的是捏造同步状态 —— 那属于「功能上没有」的断言，在后端用例里验证。
    const text = view.container.textContent ?? "";
    expect(text).toContain("不同步任何第三方账号");
    expect(text).toContain("首版不支持");
    view.unmount();
  });

  it("封面上没有任何「同步状态 / 在线中」之类的装饰", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () => json({ items: [animeEntry()], next_cursor: null })),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);
    const text = view.container.textContent ?? "";
    for (const fake of ["在线", "刚刚同步", "已同步", "最后同步", "更新于"]) {
      expect(text).not.toContain(fake);
    }
    view.unmount();
  });

  it("空结果显示正常空态，不虚构条目", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null })));
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);
    expect(view.container.textContent ?? "").toContain("这个页签还没有已发布的记录");
    view.unmount();
  });

  it("游戏页签换 kind，共用同一组端点", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host } = stubHost();
    const view = render(<LeisureView screen="game" host={host} />);
    await advance(30);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/leisure/entries?kind=game&limit=30");
    view.unmount();
  });

  it("读取失败显示失败态与重试，不显示空态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        json(
          { error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "r" },
          503,
        ),
      ),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(30);
    const text = view.container.textContent ?? "";
    expect(text).toContain("放课后暂时不可用");
    expect(text).not.toContain("这个页签还没有已发布的记录");
    view.unmount();
  });

  it("换页签走宿主能力，不自己改 URL", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null })));
    const { host, screens } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(20);
    const tab = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("游戏"),
    );
    click(tab ?? null);
    expect(screens).toEqual(["game"]);
    view.unmount();
  });
});

describe("游戏页签的展示", () => {
  it("通关与全成就分开显示，谁也不推导谁", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        json({
          items: [
            animeEntry({
              id: "g1",
              kind: "game",
              title: "通关了但没全成就",
              progress: "cleared",
              progress_label: "通关",
              anime: null,
              game: {
                platform: "PC",
                started_on: "2026-08-01",
                completed_on: "2026-09-01",
                playtime_minutes: null,
                playtime_label: "未记录时长",
                all_achievements: false,
              },
            }),
          ],
          next_cursor: null,
        }),
      ),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="game" host={host} />);
    await advance(30);
    const text = view.container.textContent ?? "";
    expect(text).toContain("通关");
    expect(text).toContain("通关 2026-09-01");
    expect(text).toContain("还没全成就");
    expect(text).toContain("未记录时长");
    view.unmount();
  });
});

describe("退出清理", () => {
  it("组件卸载即 abort 自己的读取", async () => {
    let captured: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>((_url, init) => {
        captured = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );
    const { host } = stubHost();
    const view = render(<LeisureView screen="anime" host={host} />);
    await advance(10);
    view.unmount();
    await advance(10);
    expect((captured as AbortSignal | null)?.aborted).toBe(true);
  });

  it("dispose() 取消 track() 登记的请求", async () => {
    let captured: AbortSignal | null = null;
    void track((signal) => {
      captured = signal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }).catch(() => undefined);
    expect(activeRequestCount()).toBe(1);

    const { dispose } = await import("./phone-app");
    dispose();
    expect(activeRequestCount()).toBe(0);
    expect((captured as AbortSignal | null)?.aborted).toBe(true);
  });
});

describe("手机应用模块形状", () => {
  it("screens 是允许的屏幕集合；default 组件能渲染", async () => {
    const { default: LeisurePhoneView, screens } = await import("./phone-app");
    expect([...screens]).toEqual(["anime", "game"]);

    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null })));
    const props: PhoneViewProps = {
      screen: "anime",
      item: null,
      mode: "expanded",
      host: {
        openApp: vi.fn(),
        navigateScreen: vi.fn(),
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
        state: createMemoryStateAdapter(),
      },
    };
    const view = render(<LeisurePhoneView {...props} />);
    await advance(30);
    expect(view.container.textContent ?? "").toContain("放课后");
    view.unmount();
  });
});
