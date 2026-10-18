/**
 * 前台 INS 站主快捷入口（P5 第一批 · C3；契约 §4.6 / §9.5）。
 *
 * 断言：
 *  - 匿名访客看不到入口，且**不会**调用 `/auth/session`（只打无副作用探针）；
 *  - 确认站主后才渲染 `data-owner-entry`，链接带 returnTo（含来源页查询串/手机上下文）；
 *  - 手机浮层打开时点击入口：用无 phone 参数的目标地址触发路由，浮层随 URL 卸载；
 *  - 详情页入口指向「编辑当前动态」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => {
  const state = {
    pathname: "/apps/ins",
    search: "",
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  };
  const router = {
    push: (href: string) => state.push(href),
    replace: (href: string) => state.replace(href),
    refresh: () => state.refresh(),
  };
  return Object.assign(state, { router });
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { resetOwnerSessionCache } from "@/features/workspace/session";
import { DetailView } from "./detail-view";
import { FeedView } from "./feed-view";
import { resetFavoriteStoreForTests } from "./favorites";
import { makeApiMoment, stubFetch, type FetchStub } from "./test-support";
import { stubScrollTo } from "@/tests/helpers/browser";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

const MOMENT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_STATUS = { authenticated: true, user: { id: "owner-1", username: "owner" } };
const ANONYMOUS_STATUS = { authenticated: false, user: null };
const SESSION = {
  authenticated: true,
  user: { id: "owner-1", username: "owner" },
  csrf_token: "csrf-token",
  expires_at: null,
  prelogin: false,
};

let stub: FetchStub | null = null;
let scrollStub: { calls: Array<{ top: number }>; restore: () => void } | null = null;

beforeEach(() => {
  resetDocument();
  resetFavoriteStoreForTests();
  resetOwnerSessionCache();
  nav.pathname = "/apps/ins";
  nav.search = "";
  window.history.replaceState(null, "", "/apps/ins");
  nav.push.mockClear();
  nav.replace.mockClear();
  scrollStub = stubScrollTo();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  scrollStub?.restore();
  scrollStub = null;
  resetOwnerSessionCache();
  resetDocument();
});

const OWNER_ROUTES = [
  { match: "/auth/owner-status", body: OWNER_STATUS },
  { match: "/auth/session", body: SESSION },
  { match: "/moments", body: { items: [], next_cursor: null } },
];

function readReturnTo(href: string | null): string | null {
  if (!href) return null;
  const value = new URL(href, "http://localhost").searchParams.get("returnTo");
  return value ? decodeURIComponent(value) : null;
}

describe("INS 列表 · 发布动态入口", () => {
  it("匿名访客看不到入口，也不会调用 /auth/session", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: ANONYMOUS_STATUS },
      { match: "/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(80);

    expect(view.container.querySelector("[data-owner-entry]")).toBeNull();
    expect(stub.requests.filter((request) => request.url.includes("/auth/session"))).toHaveLength(0);
    view.unmount();
  });

  it("确认站主后显示「发布动态」，链接带当前来源（筛选）returnTo", async () => {
    nav.search = "tag=校园";
    stub = stubFetch(OWNER_ROUTES);
    const view = render(<FeedView tag="校园" initial={[]} initialCursor={null} />);
    await advance(120);

    const entry = view.container.querySelector<HTMLAnchorElement>('[data-owner-entry="ins-new"]');
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toBe("发布动态");
    expect(entry?.getAttribute("href")).toContain("/admin/moments/new?returnTo=");
    expect(readReturnTo(entry?.getAttribute("href") ?? null)).toBe("/apps/ins?tag=校园");
    view.unmount();
  });

  it("手机浮层打开时：入口目标地址不含 phone 参数（浮层随路由卸载），returnTo 保留手机上下文", async () => {
    nav.search = "phone=ins&screen=feed";
    window.history.replaceState(null, "", "/apps/ins?phone=ins&screen=feed");
    stub = stubFetch(OWNER_ROUTES);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(120);

    const entry = view.container.querySelector<HTMLAnchorElement>('[data-owner-entry="ins-new"]');
    expect(entry).not.toBeNull();
    const href = entry?.getAttribute("href") ?? "";
    const targetUrl = new URL(href, "http://localhost");
    // 编辑器地址本身不带手机参数 → 点击后 URL 变化，`.pw-wrap` 手机浮层随路由卸载。
    expect(targetUrl.searchParams.has("phone")).toBe(false);
    expect(targetUrl.searchParams.has("screen")).toBe(false);
    // 返回地址保留了手机上下文，返回时可以恢复浮层。
    expect(readReturnTo(href)).toBe("/apps/ins?phone=ins&screen=feed");
    // 点击不改变来源 URL（只是普通站内链接），也不应抛错。
    expect(() => click(entry)).not.toThrow();
    view.unmount();
  });

  it("身份探针失败时不渲染入口（只有确认站主才显示）", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: { weird: true } },
      { match: "/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(120);
    expect(view.container.querySelector("[data-owner-entry]")).toBeNull();
    view.unmount();
  });
});

describe("INS 详情 · 编辑当前动态入口", () => {
  it("确认站主后显示「编辑当前动态」，指向该动态的独立编辑页并带详情页 returnTo", async () => {
    nav.pathname = `/apps/ins/${MOMENT_ID}`;
    nav.search = "";
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS },
      { match: "/auth/session", body: SESSION },
    ]);
    const view = render(
      <DetailView momentId={MOMENT_ID} initial={makeApiMoment() as never} confirmedMissing={false} />,
    );
    await advance(120);

    const entry = view.container.querySelector<HTMLAnchorElement>('[data-owner-entry="ins-edit"]');
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toBe("编辑当前动态");
    expect(entry?.getAttribute("href")).toContain(`/admin/moments/${MOMENT_ID}/edit?returnTo=`);
    expect(readReturnTo(entry?.getAttribute("href") ?? null)).toBe(`/apps/ins/${MOMENT_ID}`);
    view.unmount();
  });
});
