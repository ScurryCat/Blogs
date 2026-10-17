/**
 * 手记视图的组件行为（验收 1 / 2 的前端部分）。
 *
 * 覆盖：
 *  - 日历**只标记真正公开的记录**：API 给的 `days` 里有什么就画什么，
 *    空日期没有任何装饰，也不显示被隐藏记录的数量；
 *  - 列表渲染存档卡（日期 / 星期 / 心情 / 地点 / 摘要）；
 *  - 读取失败显示明确失败态与重试，不显示「没有记录」（两者不同）；
 *  - `dispose()` 取消未完成请求。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PhoneViewProps } from "@/features/phone/types";
import { render, advance, click, resetDocument } from "@/tests/helpers/render";
import { mockMatchMedia, stubScrollTo } from "@/tests/helpers/browser";

import { activeRequestCount, abortAll } from "./inflight";
import { JournalView } from "./journal-view";
import { createMemoryStateAdapter } from "./state";
import type { JournalHost } from "./host";
import type { JournalCalendar, JournalEntrySummary } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/journal",
  useSearchParams: () => new URLSearchParams(),
}));

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CALENDAR: JournalCalendar = {
  months: [{ month: "2026-10", days: { "2026-10-05": 2, "2026-10-09": 1 } }],
  total_entries: 3,
  timezone: "Asia/Shanghai",
  today: "2026-10-16",
};

const ENTRIES: JournalEntrySummary[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    entry_date: "2026-10-09",
    title: "公开的一天",
    excerpt: "第一段摘要。",
    mood: "平静",
    location: "四轩茶屋",
    images: [],
  },
];

function stubHost(): { host: JournalHost; screens: string[]; opened: string[] } {
  const screens: string[] = [];
  const opened: string[] = [];
  return {
    screens,
    opened,
    host: {
      mode: "site",
      openContent(request) {
        opened.push(request.destination);
      },
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

describe("列表", () => {
  it("渲染存档卡：日期、星期、心情、地点与摘要", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () => json({ items: ENTRIES, next_cursor: null })),
    );
    const { host } = stubHost();
    const view = render(<JournalView screen="list" host={host} />);
    await advance(30);

    const text = view.container.textContent ?? "";
    expect(text).toContain("公开的一天");
    // 存档卡的日期层次：日号 + 年月 + 星期（全部按字符串渲染，不经过本地时区）。
    expect(text).toContain("09");
    expect(text).toContain("2026.10");
    expect(text).toContain("周五");
    expect(text).toContain("平静");
    expect(text).toContain("四轩茶屋");
    expect(text).toContain("第一段摘要。");
    expect(text).toContain("2026 年 10 月 9 日 周五");
    view.unmount();
  });

  it("从存档打开记录再返回，列表滚动位置会恢复（§3.3）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () => json({ items: ENTRIES, next_cursor: null })),
    );
    window.sessionStorage.clear();
    const { host } = stubHost();
    const first = render(<JournalView screen="list" host={host} />);
    await advance(30);

    // 滚到中间后「点开一条记录」：视图卸载，位置写进存储
    Object.defineProperty(window, "scrollY", { configurable: true, value: 520 });
    act(() => {
      first.unmount();
    });
    expect(window.sessionStorage.getItem("journal.save.v1")).toBe("520");

    // 返回列表：重新挂载后读回位置并恢复原位。
    // 恢复是在 ready 翻真之后的**下一帧**（rAF）里做的：第一个 advance 让 loader 就绪，
    // 第二个 advance 才轮到 rAF —— 只等一次会看到「还没恢复」，是测试时序，不是缺陷。
    const scroll = stubScrollTo();
    const second = render(<JournalView screen="list" host={host} />);
    await advance(30);
    await advance(30);
    expect(second.container.textContent ?? "").toContain("公开的一天");
    expect(scroll.calls).toContainEqual({ top: 520 });
    // 恢复成功会消费掉记录
    expect(window.sessionStorage.getItem("journal.save.v1")).toBeNull();
    scroll.restore();
    act(() => {
      second.unmount();
    });
  });

  it("没有记录时是空态，并说明「新建默认草稿 + 仅自己可见」", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null })));
    const { host } = stubHost();
    const view = render(<JournalView screen="list" host={host} />);
    await advance(30);

    const text = view.container.textContent ?? "";
    expect(text).toContain("还没有公开的手记");
    expect(text).toContain("默认是草稿且仅自己可见");
    view.unmount();
  });

  it("读取失败显示失败态与重试，而不是「没有记录」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        json({ error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "r" }, 503),
      ),
    );
    const { host } = stubHost();
    const view = render(<JournalView screen="list" host={host} />);
    await advance(30);

    const text = view.container.textContent ?? "";
    expect(text).toContain("手记暂时不可用");
    expect(text).not.toContain("还没有公开的手记");
    expect(text).toContain("重新读取");
    view.unmount();
  });

  it("点换屏走宿主能力（phone-internal 语义，不自己改 URL）", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null })));
    const { host, screens } = stubHost();
    const view = render(<JournalView screen="list" host={host} />);
    await advance(20);

    const tab = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("日历"),
    );
    click(tab ?? null);
    expect(screens).toEqual(["calendar"]);
    view.unmount();
  });
});

describe("日历", () => {
  it("只给真正有记录的日期标记，空日期没有任何装饰", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        if (String(url).includes("/calendar")) return json(CALENDAR);
        return json({ items: ENTRIES, next_cursor: null });
      }),
    );
    const { host } = stubHost();
    const view = render(<JournalView screen="calendar" host={host} />);
    await advance(40);

    const marked = [...view.container.querySelectorAll("[data-count]")].filter(
      (cell) => Number(cell.getAttribute("data-count")) > 0,
    );
    expect(marked.map((cell) => cell.getAttribute("data-day"))).toEqual([
      "2026-10-05",
      "2026-10-09",
    ]);

    // 网格本身铺满整月（空日期也在，只是**没有任何标记**）；关键是「被隐藏的记录」
    // 不会让某个日期变成有内容的样子 —— 标记只来自 API 给的 days。
    const all = [...view.container.querySelectorAll("[data-day]")].map((cell) =>
      cell.getAttribute("data-day"),
    );
    expect(all).toContain("2026-10-16"); // 网格里有这一天
    const today = view.container.querySelector('[data-day="2026-10-16"]');
    expect(today?.getAttribute("data-count")).toBe("0"); // 但它没有记录标记
    expect(today?.className).toContain("dayToday"); // 只是「今天」的轮廓
    // 空日期是 span（不是按钮），点不动也读不出计数。
    const empty = view.container.querySelector('[data-day="2026-10-01"]');
    expect(empty?.tagName).toBe("SPAN");
    expect(empty?.getAttribute("data-count")).toBe("0");
    view.unmount();
  });

  it("空月份显示明确空态，不显示隐藏数量", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        if (String(url).includes("/calendar")) {
          return json({ months: [], total_entries: 0, timezone: "Asia/Shanghai", today: "2026-10-16" });
        }
        return json({ items: [], next_cursor: null });
      }),
    );
    const { host } = stubHost();
    const view = render(<JournalView screen="calendar" host={host} />);
    await advance(40);

    const text = view.container.textContent ?? "";
    expect(text).toContain("还没有公开的手记");
    expect(text).toContain("没有记录就是没有记录");
    view.unmount();
  });

  it("点某一天只看那一天，再点一次回到全部", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        if (String(url).includes("/calendar")) return json(CALENDAR);
        return json({ items: ENTRIES, next_cursor: null });
      }),
    );
    const { host } = stubHost();
    const view = render(<JournalView screen="calendar" host={host} />);
    await advance(40);

    const day = view.container.querySelector('[data-day="2026-10-09"]');
    click(day);
    await advance(10);
    expect(view.container.textContent ?? "").toContain("只看 2026-10-09");

    const reset = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("显示全部"),
    );
    click(reset ?? null);
    await advance(10);
    expect(view.container.textContent ?? "").not.toContain("只看 2026-10-09");
    view.unmount();
  });

  it("展示时区与「今天」来自 API，界面如实标注（不自己用本地时区猜）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        if (String(url).includes("/calendar")) return json(CALENDAR);
        return json({ items: ENTRIES, next_cursor: null });
      }),
    );
    const { host } = stubHost();
    const view = render(<JournalView screen="calendar" host={host} />);
    await advance(40);
    const text = view.container.textContent ?? "";
    expect(text).toContain("Asia/Shanghai");
    expect(text).toContain("2026-10-16");
    view.unmount();
  });
});

describe("退出清理", () => {
  it("组件卸载即 abort 自己的读取（useLoader 的既有约定）", async () => {
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
    const view = render(<JournalView screen="list" host={host} />);
    await advance(10);
    expect(captured).not.toBeNull();
    expect((captured as AbortSignal | null)?.aborted).toBe(false);

    view.unmount();
    await advance(10);
    expect((captured as AbortSignal | null)?.aborted).toBe(true);
  });

  it("track() 登记的请求由 dispose() 统一取消（事件回调里发起的读取）", async () => {
    const { track, activeRequestCount, abortAll: abortTracked } = await import("./inflight");
    let captured: AbortSignal | null = null;
    const controllerSeen = track((signal) => {
      captured = signal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    // 不 await：这是一个永不 resolve 的慢请求。
    void controllerSeen.catch(() => undefined);
    expect(activeRequestCount()).toBe(1);
    expect((captured as AbortSignal | null)?.aborted).toBe(false);

    abortTracked();
    expect(activeRequestCount()).toBe(0);
    expect((captured as AbortSignal | null)?.aborted).toBe(true);
  });
});

describe("手机应用模块形状", () => {
  it("default 组件收到 PhoneViewProps 就能渲染，screens 是允许的屏幕集合", async () => {
    const { default: JournalPhoneView, screens } = await import("./phone-app");
    expect([...screens]).toEqual(["list", "calendar"]);

    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ items: [], next_cursor: null })));
    const calls = { screens: [] as string[], content: [] as string[] };
    const props: PhoneViewProps = {
      screen: "list",
      item: null,
      mode: "expanded",
      host: {
        openApp: vi.fn(),
        navigateScreen: (next) => calls.screens.push(next),
        back: vi.fn(),
        close: vi.fn(),
        openSiteContent: (request) => calls.content.push(request.destination),
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
    const view = render(<JournalPhoneView {...props} />);
    await advance(30);
    expect(view.container.textContent ?? "").toContain("手记");
    expect(activeRequestCount()).toBe(0);
    view.unmount();
    const { dispose } = await import("./phone-app");
    dispose();
  });
});
