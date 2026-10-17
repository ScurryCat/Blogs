/**
 * 存档式手记列表（第三轮任务书 §3.2 / §8.1）的行为测试。
 *
 * 覆盖重点（每条都有可核对的断言）：
 *  - 默认就是存档列表；编号 = 显示顺序，不等于数据库 ID，也不封顶成游戏里的 16 档；
 *  - 选中槽位 → 预览（日期 / 标题 / 摘要 / 心情 / 地点）；「读取手记」进现有正文路由；
 *  - 键盘 ↑ ↓ Home End 选中、Enter 读取、焦点跟着走（清楚焦点由 CSS :focus-visible 负责）；
 *  - 年份筛选后按当前显示顺序重新编号；空列表不出现空存档位；
 *  - 日期按字符串语义渲染（不因时区错一天）；
 *  - 选中位置与年份记忆：从正文返回 / 重新进入时恢复；
 *  - 手机紧凑视图共用同一套业务逻辑，读取入口走宿主 openContent（source=phone-link）；
 *  - 日历定位：槽位 → 日历选中该天。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, advance, click, key, resetDocument } from "@/tests/helpers/render";
import { mockMatchMedia } from "@/tests/helpers/browser";

import { JournalView } from "./journal-view";
import type { JournalHost } from "./host";
import { createMemoryStateAdapter, rememberEntry, rememberYear, lastEntry } from "./state";
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

const LONG_TITLE =
  "在四轩茶屋的雨夜里把一整天没说完的话都写下来，顺手记下咖啡豆与明日计划的长标题";

/** 故意用非 UUID 的 id：编号必须来自显示顺序，不能从数据库 ID 推出来。 */
const ENTRIES: JournalEntrySummary[] = [
  {
    id: "id-a",
    entry_date: "2026-10-09",
    title: "第一篇：公开的一天",
    excerpt: "第一段摘要。",
    mood: "平静",
    location: "四轩茶屋",
    images: [],
  },
  {
    id: "id-b",
    entry_date: "2026-01-05",
    title: LONG_TITLE,
    excerpt: "很长的一段记录。",
    mood: "专注",
    location: "",
    images: [
      {
        media_id: "m-1",
        position: 0,
        alt: "雨天的街道",
        width: 640,
        height: 420,
        variants: [
          { name: "w640.webp", width: 640, height: 420, bytes: 1, url: "/assets/legacy/img/thumb.webp" },
        ],
      },
    ],
  },
  {
    id: "arbitrary-id-without-uuid-shape",
    entry_date: "2025-12-31",
    title: "去年的最后一天",
    excerpt: "",
    mood: "",
    location: "",
    images: [],
  },
];

const CALENDAR: JournalCalendar = {
  months: [{ month: "2026-01", days: { "2026-01-05": 1 } }],
  total_entries: 1,
  timezone: "Asia/Shanghai",
  today: "2026-10-17",
};

interface OpenedRequest {
  destination: string;
  source: string;
}

function stubHost(mode: "site" | "phone" = "site"): {
  host: JournalHost;
  screens: string[];
  opened: OpenedRequest[];
  state: ReturnType<typeof createMemoryStateAdapter>;
} {
  const screens: string[] = [];
  const opened: OpenedRequest[] = [];
  const state = createMemoryStateAdapter();
  return {
    screens,
    opened,
    state,
    host: {
      mode,
      openContent(request) {
        opened.push({ destination: request.destination, source: request.source });
      },
      changeScreen(screen) {
        screens.push(screen);
      },
      state,
      toast: () => undefined,
    },
  };
}

function stubApi(items: JournalEntrySummary[] = ENTRIES, calendar: JournalCalendar = CALENDAR): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/calendar")) return json(calendar);
      return json({ items, next_cursor: null });
    }),
  );
}

let restoreMedia: () => void;

beforeEach(() => {
  resetDocument();
  restoreMedia = mockMatchMedia({ "(pointer: fine)": true });
});

afterEach(() => {
  restoreMedia();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function slots(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-journal-slot]")];
}

async function mountList(
  options: {
    mode?: "site" | "phone";
    state?: ReturnType<typeof createMemoryStateAdapter>;
    screen?: string | null;
  } = {},
): Promise<{
  container: HTMLElement;
  root: ReturnType<typeof render>["root"];
  unmount: () => void;
  host: JournalHost;
  screens: string[];
  opened: OpenedRequest[];
}> {
  const { host, screens, opened } = stubHost(options.mode ?? "site");
  if (options.state) host.state = options.state;
  const view = render(<JournalView screen={options.screen ?? "list"} host={host} />);
  await advance(40);
  return { ...view, host, screens, opened };
}

describe("存档列表", () => {
  it("默认呈现存档列表；编号按显示顺序生成，与数据库 ID 无关", async () => {
    stubApi();
    const view = await mountList();

    const all = slots(view.container);
    expect(all).toHaveLength(3);
    expect(all.map((slot) => slot.getAttribute("data-slot-number"))).toEqual(["01", "02", "03"]);
    // 编号只由位置决定：DOM 里不出现数据库 ID 作为可见编号。
    expect(all[0]?.textContent).toContain("No.01");
    expect(all[1]?.textContent).toContain("No.02");
    expect(all[2]?.textContent).toContain("No.03");
    expect(all[0]?.getAttribute("data-slot-id")).toBe("id-a");
    // 列表行同时突出日期、标题、摘要（验收 §8.1）。
    expect(all[0]?.textContent).toContain("2026.10");
    expect(all[0]?.textContent).toContain("第一篇：公开的一天");
    expect(all[0]?.textContent).toContain("第一段摘要。");
    // 不是游戏里的固定 16 档：真实记录数就够。
    expect(slots(view.container).length).toBe(3);
    view.unmount();
  });

  it("默认选中第一篇并显示预览：完整日期语义、标题、摘要与「读取手记」入口", async () => {
    stubApi();
    const view = await mountList();

    const preview = view.container.querySelector<HTMLElement>("[data-journal-preview]");
    expect(preview).not.toBeNull();
    const text = preview?.textContent ?? "";
    expect(text).toContain("第一篇：公开的一天");
    expect(text).toContain("第一段摘要。");
    expect(text).toContain("心情：平静");
    expect(text).toContain("地点：四轩茶屋");
    expect(text).toContain("无配图");
    // 日期是 YYYY-MM-DD 的日历日期字符串 → 不经过本地时区换算出错一天。
    expect(text).toContain("2026 年 10 月 9 日 周五");
    expect(view.container.textContent ?? "").not.toContain("2026 年 10 月 8 日");

    const first = slots(view.container)[0];
    expect(first?.getAttribute("aria-selected")).toBe("true");
    expect(first?.getAttribute("tabindex")).toBe("0");
    // 读取入口保留真实 href（新标签页 / 复制链接可用），并明确是「读取」不是发布。
    const read = [...(preview?.querySelectorAll("a") ?? [])].find((node) =>
      node.textContent?.includes("读取手记"),
    );
    expect(read?.getAttribute("href")).toBe("/apps/journal/id-a");
    view.unmount();
  });

  it("点选其他槽位：选中态、预览与读取目标一起切换", async () => {
    stubApi();
    const view = await mountList();

    const second = slots(view.container)[1];
    click(second ?? null);
    await advance(10);

    expect(second?.getAttribute("aria-selected")).toBe("true");
    expect(slots(view.container)[0]?.getAttribute("aria-selected")).toBe("false");
    const preview = view.container.querySelector<HTMLElement>("[data-journal-preview]");
    expect(preview?.textContent).toContain(LONG_TITLE);
    // 长标题不截断成假信息：完整文本在 DOM 里。
    expect(preview?.textContent).toContain("很长的一段记录。");
    expect(preview?.textContent).toContain("心情：专注");
    expect(preview?.textContent).toContain("1 张图");
    const read = [...(preview?.querySelectorAll("a") ?? [])].find((node) =>
      node.textContent?.includes("读取手记"),
    );
    expect(read?.getAttribute("href")).toBe("/apps/journal/id-b");
    view.unmount();
  });

  it("键盘：↑ ↓ Home End 改变选中并把焦点放到槽位上，Enter 读取", async () => {
    stubApi();
    const view = await mountList();
    const list = view.container.querySelector<HTMLElement>('[role="listbox"]');
    expect(list).not.toBeNull();

    key(list as HTMLElement, "ArrowDown");
    await advance(10);
    expect(slots(view.container)[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(slots(view.container)[1]);

    key(list as HTMLElement, "End");
    await advance(10);
    expect(slots(view.container)[2]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(slots(view.container)[2]);

    key(list as HTMLElement, "ArrowUp");
    await advance(10);
    expect(slots(view.container)[1]?.getAttribute("aria-selected")).toBe("true");

    key(list as HTMLElement, "Home");
    await advance(10);
    expect(slots(view.container)[0]?.getAttribute("aria-selected")).toBe("true");

    // Enter 直接读取当前选中项（访客操作只有「读取」，没有发布 / 编辑）。
    key(list as HTMLElement, "ArrowUp"); // 已在第一篇，保持不越界
    await advance(10);
    key(list as HTMLElement, "Enter");
    await advance(10);
    expect(view.opened).toEqual([{ destination: "/apps/journal/id-a", source: "top-nav" }]);
    view.unmount();
  });

  it("年份筛选按显示顺序重新编号，标题里写明共几篇", async () => {
    stubApi();
    const view = await mountList();
    const select = view.container.querySelector<HTMLSelectElement>("#journal-year");
    expect(select).not.toBeNull();
    expect(select?.textContent).toContain("全部");
    expect(view.container.textContent ?? "").toContain("共 3 篇");

    const control = select as HTMLSelectElement;
    control.value = "2026";
    act(() => {
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await advance(10);

    const filtered = slots(view.container);
    expect(filtered).toHaveLength(2);
    // 编号只是「当前显示顺序」，所以筛选后从 01 重新开始。
    expect(filtered.map((slot) => slot.getAttribute("data-slot-number"))).toEqual(["01", "02"]);
    expect(filtered.map((slot) => slot.getAttribute("data-slot-id"))).toEqual(["id-a", "id-b"]);
    view.unmount();
  });

  it("没有公开记录时是真实空态：不生成空存档位，也不出现 NONE / 等级等假数据", async () => {
    stubApi([]);
    const view = await mountList();

    expect(slots(view.container)).toHaveLength(0);
    const text = view.container.textContent ?? "";
    expect(text).toContain("还没有公开的手记");
    expect(text).toContain("默认是草稿且仅自己可见");
    expect(text).not.toMatch(/\bNONE\b/);
    expect(text).not.toContain("Lv");
    expect(text).not.toContain("游玩时长");
    view.unmount();
  });

  it("日期按字符串渲染：周末/跨年日期不会因本地时区错一天", async () => {
    stubApi([
      {
        id: "new-year",
        entry_date: "2026-01-01",
        title: "元旦",
        excerpt: "跨年的记录。",
        mood: "",
        location: "",
        images: [],
      },
    ]);
    const view = await mountList();
    const text = view.container.textContent ?? "";
    // 2026-01-01 是周四；无论本机在哪个时区，按日历日期渲染都必须一致。
    expect(text).toContain("2026.01");
    expect(text).toContain("周四");
    expect(text).toContain("2026 年 1 月 1 日 周四");
    expect(text).not.toContain("2025 年 12 月 31 日");
    view.unmount();
  });

  it("读取失败显示失败态与重试，而不是「没有记录」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        json({ error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "r" }, 503),
      ),
    );
    const view = render(<JournalView screen="list" host={stubHost().host} />);
    await advance(30);
    const text = view.container.textContent ?? "";
    expect(text).toContain("手记暂时不可用");
    expect(text).not.toContain("还没有公开的手记");
    expect(text).toContain("重新读取");
    expect(slots(view.container)).toHaveLength(0);
    view.unmount();
  });
});

describe("返回位置与记忆", () => {
  it("从正文返回时恢复上次选中的槽位（按手记 ID，不按显示编号）", async () => {
    stubApi();
    const state = createMemoryStateAdapter();
    rememberEntry(state, "arbitrary-id-without-uuid-shape");
    const view = await mountList({ state });

    const all = slots(view.container);
    expect(all[2]?.getAttribute("aria-selected")).toBe("true");
    expect(all[0]?.getAttribute("aria-selected")).toBe("false");
    const preview = view.container.querySelector<HTMLElement>("[data-journal-preview]");
    expect(preview?.textContent).toContain("去年的最后一天");
    view.unmount();
  });

  it("记忆里的那篇已不再公开时，回退到当前第一篇（不制造幽灵存档）", async () => {
    stubApi();
    const state = createMemoryStateAdapter();
    rememberEntry(state, "already-retracted");
    const view = await mountList({ state });

    expect(slots(view.container)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(view.container.querySelector("[data-journal-preview]")?.textContent).toContain(
      "第一篇：公开的一天",
    );
    view.unmount();
  });

  it("键盘读取会记住当前槽位；年份筛选也会记住", async () => {
    stubApi();
    const view = await mountList();
    const list = view.container.querySelector<HTMLElement>('[role="listbox"]');
    key(list as HTMLElement, "ArrowDown");
    await advance(10);
    key(list as HTMLElement, "Enter");
    await advance(10);
    expect(lastEntry(view.host.state)).toBe("id-b");

    const select = view.container.querySelector<HTMLSelectElement>("#journal-year") as HTMLSelectElement;
    select.value = "2025";
    act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await advance(10);
    expect(view.host.state.get("journal", "year", "")).toBe("2025");
    view.unmount();
  });

  it("初始年份从记忆恢复（例如上次看到 2025 年，回来仍是 2025）", async () => {
    stubApi();
    const state = createMemoryStateAdapter();
    rememberYear(state, "2025");
    const view = await mountList({ state });
    const select = view.container.querySelector<HTMLSelectElement>("#journal-year");
    expect(select?.value).toBe("2025");
    expect(slots(view.container)).toHaveLength(1);
    expect(slots(view.container)[0]?.textContent).toContain("去年的最后一天");
    view.unmount();
  });
});

describe("手机紧凑视图与日历定位", () => {
  it("手机宿主模式复用同一份列表逻辑；读取走 openContent（source=phone-link）", async () => {
    stubApi();
    const view = await mountList({ mode: "phone" });

    const preview = view.container.querySelector<HTMLElement>("[data-journal-preview]");
    const read = [...(preview?.querySelectorAll("button") ?? [])].find((node) =>
      node.textContent?.includes("读取手记"),
    );
    expect(read).toBeDefined();
    expect(read?.tagName).toBe("BUTTON"); // 手机内不自己造链接跳转，交给宿主
    click(read ?? null);
    await advance(10);
    expect(view.opened).toEqual([{ destination: "/apps/journal/id-a", source: "phone-link" }]);
    view.unmount();
  });

  it("「在日历中定位」切到日历并只显示那一天", async () => {
    stubApi();
    const view = await mountList();

    const locate = [...view.container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("在日历中定位"),
    );
    click(locate ?? null);
    await advance(10);
    expect(view.screens).toEqual(["calendar"]);

    // 宿主换屏后由**同一个** JournalView 实例渲染日历；选中日期保留（返回位置）。
    act(() => {
      view.root.render(<JournalView screen="calendar" host={view.host} />);
    });
    await advance(40);
    expect(view.container.textContent ?? "").toContain("只看 2026-10-09");
    view.unmount();
  });

  it("日历自身保留：切换按钮仍在，只标记真实有记录的日期", async () => {
    stubApi();
    const { container } = await mountList({ screen: "calendar" });
    expect(container.textContent ?? "").toContain("日历只用来定位日期");
    const marked = [...container.querySelectorAll("[data-count]")].filter(
      (cell) => Number(cell.getAttribute("data-count")) > 0,
    );
    expect(marked.map((cell) => cell.getAttribute("data-day"))).toEqual(["2026-01-05"]);
  });
});
