/**
 * INS 独立编辑页容器（P5 第一批 · C3；契约 §4.6 / §9.4 / §9.5）。
 *
 * 覆盖：站主入口/登录态门禁（匿名不调 /auth/session）、returnTo 读取与传递、
 * `?entry=` 稳定入口 id、编辑已有内容时的工作草稿种子。
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
  // useRouter 必须返回**稳定对象**（真实 Next 的 useRouter 也是稳定的）：
  // 否则 useEntryId 的 effect 依赖每次渲染都变，测试里会反复写 entry 造成死循环。
  const router = {
    push: (href: string) => {
      state.push(href);
      try {
        window.history.replaceState(null, "", href);
      } catch {
        // jsdom 对跨源/非法地址会抛错；测试只关心调用参数。
      }
    },
    replace: (href: string) => {
      state.replace(href);
      try {
        window.history.replaceState(null, "", href);
      } catch {
        // 同上。
      }
    },
    refresh: () => state.refresh(),
  };
  return Object.assign(state, { router });
});

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { MomentEditorPage } from "./moment-editor-page";
import { resetOwnerSessionCache } from "@/features/workspace/session";
import { stubFetch, type FetchStub } from "@/features/ins/test-support";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

const MOMENT_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RETURN_TO = "/apps/ins?phone=ins&screen=feed&tag=校园";
const RETURN_QUERY = `returnTo=${encodeURIComponent(RETURN_TO)}`;

const OWNER_STATUS = { authenticated: true, user: { id: "owner-1", username: "owner" } };
const ANONYMOUS_STATUS = { authenticated: false, user: null };
const SESSION = {
  authenticated: true,
  user: { id: "owner-1", username: "owner" },
  csrf_token: "csrf-token",
  expires_at: null,
  prelogin: false,
};

const DRAFT = {
  id: DRAFT_ID,
  content_type: "moment",
  target_id: MOMENT_ID,
  target_version: 2,
  draft_version: 1,
  status: "active",
  summary: "",
  data: { text: "工作草稿文字", tags: [], album_links: [] },
  images: [],
  created_at: "2026-10-18T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z",
};

const MOMENT = {
  id: MOMENT_ID,
  text: "正式内容",
  tags: [],
  published_at: null,
  images: [],
  status: "draft",
  version: 2,
  created_at: "2026-10-18T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z",
  images_admin: [{ media_id: MEDIA_ID, position: 0, alt: "旧图" }],
  album_links: [],
};

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
  resetOwnerSessionCache();
  nav.search = "";
  window.history.replaceState(null, "", "/");
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.refresh.mockClear();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetOwnerSessionCache();
  resetDocument();
});

describe("MomentEditorPage · 新建", () => {
  it("站主确认后渲染编辑器；returnTo 传给 EditorShell，entry 写回 URL", async () => {
    nav.search = RETURN_QUERY;
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS },
      { match: "/auth/session", body: SESSION },
    ]);
    const view = render(<MomentEditorPage targetId={null} />);
    await advance(120);

    expect(view.container.querySelector("[data-editor='moment']")).not.toBeNull();
    // 入口 id 写回 URL（replace，不产生新历史），且只增 entry 参数。
    const entryWrite = nav.replace.mock.calls.find((call) => String(call[0]).includes("entry="));
    expect(entryWrite).toBeDefined();

    click(view.container.querySelector("[data-editor-return]"));
    expect(nav.replace).toHaveBeenCalledWith(RETURN_TO);
    view.unmount();
  });

  it("匿名访客：只渲染登录入口、绝不调 /auth/session；登录链接带 returnTo", async () => {
    nav.search = RETURN_QUERY;
    stub = stubFetch([{ match: "/auth/owner-status", body: ANONYMOUS_STATUS }]);
    const view = render(<MomentEditorPage targetId={null} />);
    await advance(120);

    expect(view.container.textContent).toContain("需要站主登录");
    expect(view.container.querySelector("[data-editor='moment']")).toBeNull();
    expect(stub.requests.filter((request) => request.url.includes("/auth/session"))).toHaveLength(0);

    const login = [...view.container.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("去登录"),
    );
    expect(login?.getAttribute("href")).toBe(
      `/admin/login?returnTo=${encodeURIComponent(RETURN_TO)}`,
    );
    view.unmount();
  });
});

describe("MomentEditorPage · 编辑已有", () => {
  it("读取正式内容后交给编辑器；工作草稿作为可继续编辑的种子", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS },
      { match: "/auth/session", body: SESSION },
      { match: "/admin/work-drafts", method: "POST", body: { draft: DRAFT, reused: true } },
      { match: "/admin/moments/", body: MOMENT },
    ]);
    const view = render(<MomentEditorPage targetId={MOMENT_ID} />);
    await advance(200);

    expect(view.container.textContent).toContain("编辑动态");
    const textarea = view.container.querySelector<HTMLTextAreaElement>("[data-editor-field='text']");
    expect(textarea?.value).toBe("工作草稿文字");
    expect(view.container.querySelector("[data-editor-status]")?.getAttribute("data-editor-status")).toBe(
      "draft",
    );
    view.unmount();
  });

  it("非 UUID 的 id：明确提示，不请求正式内容", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS },
      { match: "/auth/session", body: SESSION },
    ]);
    const view = render(<MomentEditorPage targetId="not-a-uuid" />);
    await advance(80);
    expect(view.container.textContent).toContain("动态编号不合法");
    expect(stub.requests.filter((request) => request.url.includes("/admin/moments/"))).toHaveLength(0);
    view.unmount();
  });
});
