/**
 * 勒布朗近况（验收 5：**一个应用 API 失败不得让音乐或整页消失**）。
 *
 * 这是本包最关键的组件级用例之一。它用「按 URL 分别失败」的 fetch 桩证明：
 *  - 手记 API 挂了 → 手记块降级，但放课后块、音乐块与整页仍在；
 *  - 放课后 API 挂了 → 同理；
 *  - **全部 API 都挂** → 音乐控制与页头仍然渲染（音乐读的是根布局的 `<audio>`，
 *    不经过任何 API 请求）；
 *  - 音乐**不自动播放**：渲染不会调用 `play()`。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SiteRuntime } from "@/features/runtime/site-runtime";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";
import { mockMatchMedia, stubMediaPlayback } from "@/tests/helpers/browser";

import { LeblancView, CURRENT_STATUS } from "./leblanc-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/leblanc",
  useSearchParams: () => new URLSearchParams(),
}));

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FAILURE = () =>
  json(
    {
      error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} },
      request_id: "r",
    },
    503,
  );

const JOURNAL_ENTRY = {
  id: "11111111-1111-1111-1111-111111111111",
  entry_date: "2026-10-09",
  title: "最近写的一篇",
  excerpt: "第一段摘要。",
  mood: "平静",
  location: "四轩茶屋",
  images: [],
};

const ANIME = {
  id: "a1",
  kind: "anime",
  title: "正在看的番",
  progress: "watching",
  progress_label: "在看",
  rating: null,
  notes: "",
  notes_have_spoilers: false,
  cover: null,
  anime: {
    season: null,
    episodes_watched: 6,
    total_episodes: null,
    last_watched_on: null,
    airing: null,
    episodes_label: "看到第 6 集",
    completion_ratio: null,
  },
  game: null,
  review: null,
  updated_at: "2026-10-16T00:00:00Z",
};

const GAME = {
  ...ANIME,
  id: "g1",
  kind: "game",
  title: "正在玩的游戏",
  progress: "playing",
  progress_label: "在玩",
  anime: null,
  game: {
    platform: "PC",
    started_on: null,
    completed_on: null,
    playtime_minutes: null,
    playtime_label: "未记录时长",
    all_achievements: null,
  },
};

/** 按 URL 决定成功还是失败：可以只让某一个应用挂掉。 */
function routingFetch(options: { journal?: boolean; leisure?: boolean }): FetchLike {
  return async (url) => {
    const target = String(url);
    if (target.includes("/journal/")) {
      if (options.journal === false) return FAILURE();
      if (target.includes("/calendar")) {
        return json({
          months: [{ month: "2026-10", days: { "2026-10-09": 1 } }],
          total_entries: 1,
          timezone: "Asia/Shanghai",
          today: "2026-10-16",
        });
      }
      return json({ items: [JOURNAL_ENTRY], next_cursor: null });
    }
    if (target.includes("/leisure/")) {
      if (options.leisure === false) return FAILURE();
      return json({
        items: target.includes("kind=game") ? [GAME] : [ANIME],
        next_cursor: null,
      });
    }
    return json({ items: [], next_cursor: null });
  };
}

let restoreMedia: () => void;
let playback: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };

beforeEach(() => {
  resetDocument();
  restoreMedia = mockMatchMedia({ "(pointer: fine)": true });
  playback = stubMediaPlayback();
});

afterEach(() => {
  restoreMedia();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("正常读取", () => {
  it("四块都渲染：近况、最近手记、正在追、正在玩、音乐", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(routingFetch({})));
    const view = render(<LeblancView />);
    await advance(40);

    const text = view.container.textContent ?? "";
    expect(text).toContain(CURRENT_STATUS);
    expect(text).toContain("最近写的一篇");
    expect(text).toContain("正在看的番");
    expect(text).toContain("正在玩的游戏");
    expect(view.container.querySelector('[data-leblanc-block="music"]')).not.toBeNull();
    // 普通中文链接始终存在（不要求点中装饰小物件）。
    const links = [...view.container.querySelectorAll("a")].map((a) => a.textContent ?? "");
    expect(links.join("")).toContain("看全部手记");
    expect(links.join("")).toContain("去留言");
    view.unmount();
  });
});

describe("一个应用失败不影响其它块（验收 5）", () => {
  it("手记 API 挂掉：手记块降级，放课后与音乐仍在", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(routingFetch({ journal: false })));
    const view = render(<LeblancView />);
    await advance(40);

    const text = view.container.textContent ?? "";
    expect(text).toContain("手记现在读不到，其它内容不受影响。");
    expect(text).not.toContain("最近写的一篇");
    // 其它块照常
    expect(text).toContain("正在看的番");
    expect(text).toContain("正在玩的游戏");
    expect(view.container.querySelector('[data-leblanc-block="music"]')).not.toBeNull();
    expect(text).toContain(CURRENT_STATUS);
    view.unmount();
  });

  it("放课后 API 挂掉：两个娱乐块降级，手记与音乐仍在", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(routingFetch({ leisure: false })));
    const view = render(<LeblancView />);
    await advance(40);

    const text = view.container.textContent ?? "";
    expect(text).toContain("正在追的记录读不到，其它内容不受影响。");
    expect(text).toContain("正在玩的记录读不到，其它内容不受影响。");
    expect(text).toContain("最近写的一篇");
    expect(view.container.querySelector('[data-leblanc-block="music"]')).not.toBeNull();
    view.unmount();
  });

  it("**全部 API 都挂**：整页与音乐控制仍然存在（音乐不经过 API）", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => FAILURE()));
    const view = render(<LeblancView />);
    await advance(40);

    const text = view.container.textContent ?? "";
    // 页头与近况文案（静态、真实内容）仍在 —— 整页没有消失。
    expect(text).toContain(CURRENT_STATUS);
    expect(text).toContain("勒布朗");
    // 音乐块仍在，并且有可用的控制。
    const music = view.container.querySelector('[data-leblanc-block="music"]');
    expect(music).not.toBeNull();
    expect(music?.querySelector("[data-music-toggle]")).not.toBeNull();
    // 普通链接仍在（导航不依赖 API）。
    expect(text).toContain("看全部手记");
    view.unmount();
  });

  it("网络层直接失败（连不上）也走同一条降级路径", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () => {
        throw new TypeError("network down");
      }),
    );
    const view = render(<LeblancView />);
    // 读取失败会**退避重试一次**（200ms）后才给出失败态：等足够久再断言，
    // 否则读到的是「正在读取…」而不是降级文案（这不是缺陷，是共享客户端的既有约定）。
    await advance(400);
    const text = view.container.textContent ?? "";
    expect(text).toContain("手记现在读不到");
    expect(view.container.querySelector('[data-leblanc-block="music"]')).not.toBeNull();
    view.unmount();
  });
});

describe("音乐：不自动出声、不新建第二个播放器、API 全挂也在（硬规则 + 验收 5）", () => {
  /**
   * 这一组把视图放进**真实的 `SiteRuntime`**：根布局里那个唯一的音乐 `<audio>`
   * 就是由它渲染的。因此在 API 全部失败的情况下，我们可以在真实环境下断言
   * 「音乐元素仍在、数量仍是 1、没有被自动播放」——这正是验收 5 的原话。
   */
  it("API 全部失败时音乐元素仍在且只有一个，且没有被自动播放", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => FAILURE()));
    const view = render(
      <SiteRuntime>
        <LeblancView />
      </SiteRuntime>,
    );
    await advance(400);

    const music = view.container.querySelectorAll("audio[data-pl-music]");
    expect(music).toHaveLength(1);
    expect(view.container.querySelectorAll("audio")).toHaveLength(1);
    expect(playback.play).not.toHaveBeenCalled();

    // 勒布朗的音乐块与整页仍在。
    expect(view.container.textContent ?? "").toContain(CURRENT_STATUS);
    expect(view.container.querySelector("[data-music-toggle]")).not.toBeNull();
    view.unmount();
  });

  it("点「播放」才调用 play()（不是渲染时自动播）", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(routingFetch({})));
    const view = render(
      <SiteRuntime>
        <LeblancView />
      </SiteRuntime>,
    );
    await advance(60);
    expect(playback.play).not.toHaveBeenCalled();

    const toggle = view.container.querySelector<HTMLButtonElement>("[data-music-toggle]");
    click(toggle);
    await advance(20);
    expect(playback.play).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
