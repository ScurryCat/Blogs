/**
 * 前台手记站主入口（P5 · C4；契约 §4.6 / §9.5）。
 *
 * 钉住三条不能退让的规则：
 *  - 匿名访客**完全不渲染**入口（隐藏入口不是授权，但也不能默认可看）；
 *  - 入口链接带 `returnTo=<来源路径+查询串>`，日历选中日期作为独立 `date=` 追加；
 *  - 点击时先去掉手机上下文参数（phone/screen/item），避免编辑器被浮层遮挡；
 *    returnTo 里**保留**手机上下文，返回时能恢复。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";
import { resetOwnerSessionCache } from "@/features/workspace/session";

import {
  JournalOwnerEditEntry,
  JournalOwnerNewEntry,
  OwnerEntryLink,
  buildOwnerEntryHref,
  currentReturnTo,
} from "./owner-entry";

const navState = vi.hoisted(() => ({
  pathname: "/apps/journal",
}));

// 入口刻意不用 useSearchParams（静态预渲染页面不能依赖 Suspense 边界），
// 它用 usePathname + 挂载后读 window.location.search；单测据此设置真实 URL。
vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/** 把 jsdom 的当前地址设成某个站内 URL（模拟来源页 + 手机上下文）。 */
function setLocation(path: string): void {
  window.history.replaceState(null, "", path);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SESSION = {
  authenticated: true,
  user: { id: "11111111-1111-1111-1111-111111111111", username: "owner" },
  csrf_token: "csrf-token",
  expires_at: null,
  prelogin: false,
};

/** 站主：先探针 `authenticated:true`，再读完整会话拿 CSRF。 */
function stubOwnerFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/auth/owner-status")) {
        return json({ authenticated: true, user: SESSION.user });
      }
      return json(SESSION);
    }),
  );
}

function stubAnonymousFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("/auth/owner-status")) {
        return json({ authenticated: false, user: null });
      }
      throw new Error(`匿名访客不应请求 ${String(url)}`);
    }),
  );
}

beforeEach(() => {
  resetDocument();
  resetOwnerSessionCache();
  navState.pathname = "/apps/journal";
  window.history.replaceState(null, "", "/apps/journal");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetOwnerSessionCache();
});

describe("纯函数", () => {
  it("带 returnTo 编码进链接；日历日期作为独立参数追加", () => {
    expect(buildOwnerEntryHref("/admin/journal/new", null)).toBe("/admin/journal/new");
    expect(buildOwnerEntryHref("/admin/journal/new", "/apps/journal?screen=list")).toBe(
      "/admin/journal/new?returnTo=%2Fapps%2Fjournal%3Fscreen%3Dlist",
    );
    expect(
      buildOwnerEntryHref("/admin/journal/new", "/apps/journal?phone=journal", "2026-10-05"),
    ).toBe(
      "/admin/journal/new?returnTo=%2Fapps%2Fjournal%3Fphone%3Djournal&date=2026-10-05",
    );
  });

  it("currentReturnTo 只接受白名单站内路径", () => {
    expect(currentReturnTo("/apps/journal", "screen=calendar")).toBe(
      "/apps/journal?screen=calendar",
    );
    expect(currentReturnTo("/", "phone=journal&screen=list")).toBe("/?phone=journal&screen=list");
    expect(currentReturnTo("/apps/journal/abc", "")).toBe("/apps/journal/abc");
    expect(currentReturnTo("/admin", "")).toBeNull();
    expect(currentReturnTo("https://evil.example", "")).toBeNull();
    expect(currentReturnTo("//evil.example", "")).toBeNull();
    // 查询串里的内容只是被编码进 returnTo 的普通参数，不是导航目标；
    // 真正的导航目标仍然是白名单里的 /apps/journal（上面的前缀检查在切分查询串之前完成）。
    expect(currentReturnTo("/apps/journal", "next=//evil.example")).toBe(
      "/apps/journal?next=//evil.example",
    );
  });
});

describe("入口渲染条件", () => {
  it("匿名访客：一个入口都不渲染，也不留下占位", async () => {
    stubAnonymousFetch();
    const view = render(
      <div>
        <JournalOwnerNewEntry />
        <JournalOwnerEditEntry entryId="e1" />
      </div>,
    );
    await advance(30);
    expect(view.container.querySelector("[data-owner-entry]")).toBeNull();
    expect(view.container.textContent ?? "").not.toContain("写手记");
    // 匿名分支绝不请求 /auth/session（不建立预登录会话）
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/auth/session")),
    ).toBe(false);
    view.unmount();
  });

  it("站主：列表入口带 returnTo（保留手机上下文）", async () => {
    stubOwnerFetch();
    setLocation("/apps/journal?phone=journal&screen=list");
    const view = render(<JournalOwnerNewEntry />);
    await advance(30);

    const link = view.container.querySelector<HTMLAnchorElement>("[data-owner-entry]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("data-owner-entry")).toBe("journal-new");
    const href = link?.getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(params.get("returnTo")).toBe("/apps/journal?phone=journal&screen=list");
    expect(params.get("date")).toBeNull();
    expect(view.container.textContent).toContain("写手记");
    view.unmount();
  });

  it("日历选中日期：date= 独立参数", async () => {
    stubOwnerFetch();
    const view = render(<JournalOwnerNewEntry date="2026-10-05" />);
    await advance(30);

    const href = view.container
      .querySelector<HTMLAnchorElement>("[data-owner-entry]")
      ?.getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(params.get("date")).toBe("2026-10-05");
    expect(params.get("returnTo")).toBe("/apps/journal");
    view.unmount();
  });

  it("正文入口：编辑当前手记，指向 /admin/journal/{id}/edit", async () => {
    stubOwnerFetch();
    setLocation("/apps/journal/e%201");
    const view = render(<JournalOwnerEditEntry entryId="e 1" />);
    await advance(30);

    const link = view.container.querySelector<HTMLAnchorElement>("[data-owner-entry]");
    expect(link?.getAttribute("data-owner-entry")).toBe("journal-edit");
    expect(link?.getAttribute("href")).toContain("/admin/journal/e%201/edit");
    view.unmount();
  });

  it("当前页面不在 returnTo 白名单时，入口仍然可用但不带 returnTo", async () => {
    stubOwnerFetch();
    setLocation("/admin/somewhere");
    const view = render(<JournalOwnerNewEntry />);
    await advance(30);
    const href = view.container
      .querySelector<HTMLAnchorElement>("[data-owner-entry]")
      ?.getAttribute("href");
    expect(href).toBe("/admin/journal/new");
    view.unmount();
  });
});

describe("点击时关闭手机浮层", () => {
  it("点击入口会去掉 URL 里的 phone/screen/item 参数（returnTo 仍保留它们）", async () => {
    stubOwnerFetch();
    setLocation("/?phone=journal&screen=calendar");
    const view = render(<JournalOwnerNewEntry />);
    await advance(30);

    const link = view.container.querySelector<HTMLAnchorElement>("[data-owner-entry]");
    const href = link?.getAttribute("href") ?? "";
    // 手机浮层通常开在首页（`/?phone=…`）：returnTo 如实保存当前地址（含三元组）。
    expect(new URLSearchParams(href.split("?")[1] ?? "").get("returnTo")).toBe(
      "/?phone=journal&screen=calendar",
    );

    click(link);
    // 点击之后当前页 URL 不再带手机参数（浮层收起）
    expect(window.location.search).toBe("");
    view.unmount();
  });

  it("没有手机参数时点击不改 URL", async () => {
    stubOwnerFetch();
    setLocation("/apps/journal?screen=list");
    const view = render(
      <OwnerEntryLink entry="journal-new" href="/admin/journal/new" label="写手记" />,
    );
    await advance(30);
    click(view.container.querySelector("[data-owner-entry]"));
    expect(window.location.search).toBe("?screen=list");
    view.unmount();
  });
});
