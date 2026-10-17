/**
 * 主视图的交互测试：导航来源协议、三种反馈、足迹与存储降级。
 *
 * 重点（T04 任务卡与验收 2 / 5 / 6）：
 *  - **打开 App、打字、匹配结果出现都不发导航请求**；
 *  - 只有明确点「进入殿堂」才发 `metaverse-entry`，手机里走 `host.openContent`、
 *    独立页走真实 `SiteLink` + 共享导航协调器（过场由协调器决定，模块不做遮罩）；
 *  - 手机里换屏是 `phone-internal` 语义（`changeScreen`，不遮盖全站）；
 *  - 未找到 / 输入不合法 / 服务不可用是三种不同反馈；
 *  - 足迹重访会**重新读取公开状态**：已撤回的殿堂被移除并说明；
 *  - 存储不可用不阻止导航。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { NavigationRequest, NavigationSource } from "@/features/phone/types";

import { NavigationProvider, useNavigation } from "@/features/runtime/navigation/coordinator";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";
import { mockMatchMedia } from "@/tests/helpers/browser";

// 组件的导航走 Next 的 router；测试里用替身，避免依赖真实的 App Router 运行时
// （与 T02 的导航协调器测试同一套做法）。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/metanav",
  useSearchParams: () => new URLSearchParams("screen=palaces"),
}));

import { createMemoryStateAdapter, recordVisit, type StateAdapter } from "./footprint";
import { MetanavView } from "./metanav-view";
import type { MetanavHost } from "./host";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: `HTTP ${status}`, fields: {} }, request_id: "r" }, status);
}

const PALACE = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "phantom-base",
  title: "怪盗据点工程",
  summary: "把博客改造成怪盗的基地",
  keywords: { name: "ScurryCat", location: "个人博客", cognition: "据点" },
  post_count: 4,
  published_at: "2026-10-01T00:00:00Z",
};

// mock 带上具体函数类型，才能赋给宿主的强类型接口（未特化的 Mock 不行）。
interface HostCalls {
  openContent: Mock<(request: NavigationRequest) => void>;
  changeScreen: Mock<(screen: string, item?: string | null) => void>;
  toast: Mock<(message: string, options?: { tone?: "info" | "error" }) => void>;
}

function phoneHost(state: StateAdapter): { host: MetanavHost; calls: HostCalls } {
  const calls: HostCalls = {
    openContent: vi.fn<(request: NavigationRequest) => void>(),
    changeScreen: vi.fn<(screen: string, item?: string | null) => void>(),
    toast: vi.fn<(message: string, options?: { tone?: "info" | "error" }) => void>(),
  };
  return {
    calls,
    host: {
      mode: "phone",
      openContent: calls.openContent,
      changeScreen: calls.changeScreen,
      state,
      toast: calls.toast,
    },
  };
}

/** 独立页宿主：openContent 接到真实导航协调器的适配器上。 */
function siteHost(
  state: StateAdapter,
  navigation: { navigate: (request: NavigationRequest) => void },
): { host: MetanavHost; calls: HostCalls } {
  const calls: HostCalls = {
    openContent: vi.fn<(request: NavigationRequest) => void>(),
    changeScreen: vi.fn<(screen: string, item?: string | null) => void>(),
    toast: vi.fn<(message: string, options?: { tone?: "info" | "error" }) => void>(),
  };
  return {
    calls,
    host: {
      mode: "site",
      openContent(request) {
        calls.openContent(request);
        navigation.navigate(request);
      },
      changeScreen: calls.changeScreen,
      state,
      toast: calls.toast,
    },
  };
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

describe("已发现殿堂（默认屏幕）", () => {
  it("打开应用只读列表，不发送任何导航请求；卡片显示真实标题与关键词", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ items: [PALACE], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);

    expect(view.container.textContent).toContain("怪盗据点工程");
    expect(view.container.textContent).toContain("ScurryCat");
    expect(view.container.textContent).toContain("4 篇公开文章");
    expect(calls.openContent).not.toHaveBeenCalled();
    expect(calls.changeScreen).not.toHaveBeenCalled();
    view.unmount();
  });

  it("空列表给出空态而不是假卡片；服务故障给出「重新读取」而不是空态", async () => {
    const empty = vi.fn<FetchLike>(async () => jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", empty);
    const { host } = phoneHost(createMemoryStateAdapter());
    const first = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    expect(first.container.textContent).toContain("现在还没有已发布的殿堂");
    first.unmount();

    const broken = vi.fn<FetchLike>(async () => errorResponse("SERVICE_UNAVAILABLE", 503));
    vi.stubGlobal("fetch", broken);
    const second = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    expect(second.container.textContent).toContain("导航暂时不可用");
    expect(second.container.querySelector("button")).toBeTruthy();
    second.unmount();
  });

  it("点「进入殿堂」才发送 metaverse-entry（手机：走宿主）", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ items: [PALACE], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    const button = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("进入殿堂"),
    );
    expect(button).toBeTruthy();

    click(button ?? null);
    // 手机里：进入殿堂走换屏到 palace 屏幕（不跳 canonical 页面，否则手机会被关闭）
    expect(calls.changeScreen).toHaveBeenCalledWith("palace", "phantom-base");
    expect(calls.openContent).not.toHaveBeenCalled();
    view.unmount();
  });

  it("手机里换屏是 phone-internal 语义：只调 changeScreen，不触发全屏过场", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ items: [PALACE], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    const tab = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("认知定位"),
    );
    click(tab ?? null);
    expect(calls.changeScreen).toHaveBeenCalledWith("resolve");
    expect(calls.openContent).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe("独立页：真实 SiteLink 与共享协调器", () => {
  it("点「进入殿堂」经过导航协调器且来源是 metaverse-entry（不是人群、不是 Joker 误用）", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ items: [PALACE], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    const pushMock = vi.fn();
    const assignMock = vi.fn();
    // 闭包里的赋值 TS 控制流分析看不到，因此用对象持有者（避免被收窄成 null）。
    const holder: { nav: ReturnType<typeof useNavigation> | null } = { nav: null };
    const nav = (): ReturnType<typeof useNavigation> | null => holder.nav;

    function Probe({ host }: { host: MetanavHost }) {
      holder.nav = useNavigation();
      return <MetanavView screen="palaces" item={null} host={host} />;
    }

    const state = createMemoryStateAdapter();
    const { host } = siteHost(state, {
      navigate: (request) => nav()?.navigate(request),
    });

    const view = render(
      <NavigationProvider
        driver={{
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
          hasIsekai: () => false,
          isekaiReady: () => false,
          playIsekai: () => false,
          stopIsekai: () => undefined,
          isekaiWait: () => 1_500,
        }}
        adapter={{ push: pushMock, assign: assignMock, pathname: "/apps/metanav" }}
      >
        <Probe host={host} />
      </NavigationProvider>,
    );
    await advance(20);

    const link = [...view.container.querySelectorAll("a")].find((item) =>
      item.textContent?.includes("进入殿堂"),
    ) as HTMLAnchorElement | undefined;
    expect(link?.getAttribute("href")).toBe("/apps/metanav/palaces/phantom-base");

    click(link ?? null);
    // 来源协议：协调器记录到的是 metaverse-entry，且没有用人群。
    expect(nav()?.debug().source).toBe<NavigationSource | null>("metaverse-entry");
    expect(nav()?.debug().kind).not.toBe("crowd");
    expect(nav()?.navigating()).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });
    expect(pushMock).toHaveBeenCalledWith("/apps/metanav/palaces/phantom-base", { replace: false });
    view.unmount();
  });
});

describe("认知定位：三种反馈", () => {
  const palaces = { items: [PALACE], next_cursor: null };

  async function mountResolve(host: MetanavHost) {
    const view = render(<MetanavView screen="resolve" item={null} host={host} />);
    await advance(20);
    return view;
  }

  function fill(container: HTMLElement, values: { name?: string; location?: string; cognition?: string }) {
    for (const [field, value] of Object.entries(values)) {
      const input = container.querySelector<HTMLInputElement>(`#metanav-${field}`);
      if (!input || value === undefined) continue;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  }

  function submit(container: HTMLElement) {
    const form = container.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("填不完整就提交：给出字段错误，且不发请求（输入不合法 ≠ 未找到）", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(palaces));
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = await mountResolve(host);
    submit(view.container);
    await advance(10);

    expect(view.container.textContent).toContain("这一项不能为空");
    const resolveCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/nav/resolve"));
    expect(resolveCalls).toHaveLength(0);
    expect(calls.openContent).not.toHaveBeenCalled();
    view.unmount();
  });

  it("found：显示标题与三项认知信息，但**不自动跳转**，要再点「进入殿堂」", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/nav/resolve")) {
        return jsonResponse({ status: "found", matches: [PALACE] });
      }
      return jsonResponse(palaces);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = await mountResolve(host);
    fill(view.container, { name: "ScurryCat", location: "个人博客", cognition: "据点" });
    submit(view.container);
    await advance(30);

    const result = view.container.querySelector('[data-result="found"]');
    expect(result?.textContent).toContain("怪盗据点工程");
    expect(result?.textContent).toContain("个人博客");
    expect(calls.openContent).not.toHaveBeenCalled();

    const enter = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("进入殿堂"),
    );
    click(enter ?? null);
    // 手机里：进入殿堂走换屏（「不自动跳转」这条不变量仍然成立，只是入口改成换屏）
    expect(calls.changeScreen.mock.calls[0]).toEqual(["palace", "phantom-base"]);
    expect(calls.openContent).not.toHaveBeenCalled();
    view.unmount();
  });

  it("ambiguous：列出全部候选（不随机挑一个）", async () => {
    const other = { ...PALACE, id: "22222222-2222-2222-2222-222222222222", slug: "other", title: "另一座殿堂" };
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/nav/resolve")) {
        return jsonResponse({ status: "ambiguous", matches: [PALACE, other] });
      }
      return jsonResponse(palaces);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = await mountResolve(host);
    fill(view.container, { name: "A", location: "B", cognition: "C" });
    submit(view.container);
    await advance(30);

    const result = view.container.querySelector('[data-result="ambiguous"]');
    expect(result?.textContent).toContain("2 座殿堂");
    expect(result?.textContent).toContain("另一座殿堂");
    expect(calls.openContent).not.toHaveBeenCalled();
    view.unmount();
  });

  it("not_found：是 200 业务结果，保留输入并给出建议；与「服务不可用」文案不同", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/nav/resolve")) {
        return jsonResponse({ status: "not_found", matches: [] });
      }
      return jsonResponse(palaces);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host } = phoneHost(createMemoryStateAdapter());

    const view = await mountResolve(host);
    fill(view.container, { name: "不存在", location: "也不存在", cognition: "还是没有" });
    submit(view.container);
    await advance(30);

    expect(view.container.querySelector('[data-result="not_found"]')).toBeTruthy();
    const input = view.container.querySelector<HTMLInputElement>("#metanav-name");
    expect(input?.value).toBe("不存在");
    expect(view.container.textContent).toContain("怪盗据点工程"); // 建议
    view.unmount();
  });

  it("服务故障：显示「导航暂时不可用」，不是「没有找到」", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/nav/resolve")) return errorResponse("SERVICE_UNAVAILABLE", 503);
      return jsonResponse(palaces);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host } = phoneHost(createMemoryStateAdapter());

    const view = await mountResolve(host);
    fill(view.container, { name: "A", location: "B", cognition: "C" });
    submit(view.container);
    await advance(30);

    const result = view.container.querySelector('[data-result="unavailable"]');
    expect(result?.textContent).toContain("导航暂时不可用");
    expect(view.container.querySelector('[data-result="not_found"]')).toBeNull();
    view.unmount();
  });
});

describe("普通搜索与印象空间", () => {
  it("搜索结果点殿堂用 metaverse-entry、点文章用 phone-link", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        items: [
          {
            kind: "palace",
            id: PALACE.id,
            slug: PALACE.slug,
            title: PALACE.title,
            excerpt: PALACE.summary,
            href: "/apps/metanav/palaces/phantom-base",
          },
          {
            kind: "post",
            id: "33333333-3333-3333-3333-333333333333",
            slug: "css-p5-menu",
            title: "用纯 CSS 复刻 P5 的斜切菜单",
            excerpt: "",
            href: "/posts/css-p5-menu",
          },
        ],
        next_cursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(createMemoryStateAdapter());

    const view = render(<MetanavView screen="search" item={null} host={host} />);
    await advance(20);
    const form = view.container.querySelector("form");
    const input = view.container.querySelector<HTMLInputElement>("#metanav-q");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "斜切");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await advance(30);

    const links = [...view.container.querySelectorAll("button")].filter((item) =>
      item.textContent?.includes("用纯 CSS 复刻") || item.textContent?.includes("怪盗据点工程"),
    );
    expect(links).toHaveLength(2);
    click(links[1] ?? null); // 文章
    click(links[0] ?? null); // 殿堂
    expect(calls.openContent.mock.calls[0]?.[0]).toEqual({
      destination: "/posts/css-p5-menu",
      source: "phone-link",
    });
    expect(calls.openContent.mock.calls[1]?.[0]).toEqual({
      destination: "/apps/metanav/palaces/phantom-base",
      source: "metaverse-entry",
    });
    view.unmount();
  });

  it("印象空间：分类有普通中文解释，空分类给出空态（不编造文章）", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host } = phoneHost(createMemoryStateAdapter());

    const view = render(<MetanavView screen="mugen" item={null} host={host} />);
    await advance(20);
    expect(view.container.textContent).toContain("技术");
    expect(view.container.textContent).toContain("实现、可访问性与踩过的坑");

    const startButton = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("沿这条路径深入"),
    );
    click(startButton ?? null);
    await advance(30);
    expect(view.container.textContent).toContain("这个分类下还没有公开文章");
    view.unmount();
  });
});

describe("本机足迹", () => {
  it("展示已有足迹；重访先读公开状态，已不可读时移除入口并说明", async () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: "gone", title: "已被撤回的殿堂", at: "2026-10-16T10:00:00.000Z" });
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/palaces/gone")) return errorResponse("NOT_FOUND", 404);
      return jsonResponse({ items: [], next_cursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(state);

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    const entry = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("已被撤回的殿堂"),
    );
    expect(entry).toBeTruthy();

    click(entry ?? null);
    await advance(30);
    expect(view.container.textContent).toContain("现在已经不可读了");
    // 已不可读 → 不进入任何视图（换屏与站点跳转都不该发生）
    expect(calls.openContent).not.toHaveBeenCalled();
    expect(calls.changeScreen).not.toHaveBeenCalled();
    // 过期入口从足迹里消失（提示文案里仍会提到标题，因此断言按钮而不是整段文本）。
    const remaining = [...view.container.querySelectorAll("button")].filter((item) =>
      item.textContent?.includes("已被撤回的殿堂"),
    );
    expect(remaining.length).toBe(0);
    view.unmount();
  });

  it("重访可读的殿堂：记录一次并换成 palace 屏幕（手机内）", async () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: PALACE.slug, title: PALACE.title, at: "2026-10-16T10:00:00.000Z" });
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes(`/palaces/${PALACE.slug}`)) return jsonResponse(PALACE);
      return jsonResponse({ items: [], next_cursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(state);

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    const entry = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("怪盗据点工程"),
    );
    click(entry ?? null);
    await advance(30);

    // 手机里：重访也走换屏（记录足迹的逻辑不变）
    expect(calls.changeScreen.mock.calls[0]).toEqual(["palace", "phantom-base"]);
    expect(calls.openContent).not.toHaveBeenCalled();
    view.unmount();
  });

  it("清除足迹后列表为空", async () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: "a", title: "甲" });
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { host } = phoneHost(state);

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    const clear = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("清除足迹"),
    );
    click(clear ?? null);
    await advance(10);
    expect(view.container.textContent).toContain("本机访问足迹已清除");
    expect(view.container.textContent).toContain("还没有访问记录");
    view.unmount();
  });

  it("存储不可用：仍然能进入殿堂，但要说明这次不会被记住", async () => {
    const failing: StateAdapter = {
      get: (_appId, _key, fallback) => fallback,
      set: () => ({ persisted: false }),
      clear: () => undefined,
    };
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes(`/palaces/${PALACE.slug}`)) return jsonResponse(PALACE);
      return jsonResponse({ items: [PALACE], next_cursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { host, calls } = phoneHost(failing);

    const view = render(<MetanavView screen="palaces" item={null} host={host} />);
    await advance(20);
    const button = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("进入殿堂"),
    );
    click(button ?? null);
    // 存储不可用不影响进入：仍然换成 palace 屏幕（只是这次不会被记住）
    expect(calls.changeScreen).toHaveBeenCalledWith("palace", "phantom-base");
    view.unmount();
  });
});
