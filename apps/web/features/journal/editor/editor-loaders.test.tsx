/**
 * 手记编辑页装载器（P5 · C4；契约 §4.5 / §9.4 / §9.5）。
 *
 * 覆盖「页面级」而非组件级的约定：
 *  - `/admin/journal/new?date=YYYY-MM-DD&returnTo=…&entry=…`：日期默认 / `?date=` 生效、
 *    returnTo 传给工作草稿引擎（返回来源时用）、entry 入口 id 传给 useWorkDraft；
 *  - 匿名访客只看到「需要站主登录」，不渲染编辑器；
 *  - `/admin/journal/[id]/edit`：读出正式手记 + 图片媒体详情后才渲染编辑器；
 *  - 站点时区今天来自 `GET /journal/calendar`（不是本机猜的）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JournalAdminEntry } from "../types";
import { render, advance, resetDocument } from "@/tests/helpers/render";
import { resetOwnerSessionCache } from "@/features/workspace/session";

import { JournalEditEditor, JournalNewEditor } from "./editor-loaders";

const mockUseWorkDraft = vi.hoisted(() => vi.fn());
const mockCommitWorkDraft = vi.hoisted(() => vi.fn());

vi.mock("@/features/workspace/use-work-draft", () => ({
  useWorkDraft: mockUseWorkDraft,
}));

vi.mock("@/features/workspace/api", () => ({
  commitWorkDraft: mockCommitWorkDraft,
}));

const navState = vi.hoisted(() => ({
  pathname: "/admin/journal/new",
  search: "",
}));

const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
}));

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

const CALENDAR = {
  months: [{ month: "2026-10", days: {} }],
  total_entries: 0,
  timezone: "Asia/Shanghai",
  today: "2026-10-18",
};

const EDIT_ENTRY: JournalAdminEntry = {
  id: "e1",
  entry_date: "2026-10-09",
  title: "已公开的一天",
  content_md: "正文。",
  mood: "平静",
  location: "四轩茶屋",
  status: "published",
  visibility: "public",
  post: null,
  images: [
    {
      media_id: "33333333-3333-3333-3333-333333333333",
      position: 0,
      alt: "街景",
      width: 1200,
      height: 800,
      still_public: false,
    },
  ],
  published_at: "2026-10-09T00:00:00Z",
  created_at: "2026-10-09T00:00:00Z",
  updated_at: "2026-10-10T00:00:00Z",
  deleted_at: null,
  version: 5,
  public: true,
  shared_media: [],
};

const MEDIA = {
  id: "33333333-3333-3333-3333-333333333333",
  mime_type: "image/webp",
  bytes: 1234,
  width: 1200,
  height: 800,
  sha256: "abc",
  status: "ready",
  created_at: "2026-10-18T00:00:00Z",
  variants: [
    {
      name: "w320.webp",
      width: 320,
      height: 213,
      bytes: 100,
      url: "/api/v1/media/33333333/w320.webp",
    },
  ],
  original_url: "/api/v1/media/33333333/original",
};

function stubOwnerFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchLike>(async (url) => {
      const target = String(url);
      if (target.includes("/auth/owner-status")) {
        return json({ authenticated: true, user: SESSION.user });
      }
      if (target.includes("/auth/session")) return json(SESSION);
      if (target.includes("/journal/calendar")) return json(CALENDAR);
      if (target.includes("/admin/media/")) return json(MEDIA);
      if (target.includes("/admin/journal/entries/e1")) return json(EDIT_ENTRY);
      return json({ items: [], next_cursor: null });
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

function draftStub() {
  return {
    id: "draft-1",
    content_type: "journal",
    target_id: null,
    target_version: null,
    draft_version: 1,
    status: "active",
    summary: "",
    data: {},
    images: [],
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
  };
}

function workStub() {
  const saved = draftStub();
  return {
    draft: saved,
    state: "idle",
    syncMessage: "",
    recoveryNotice: null,
    update: vi.fn(),
    saveNow: vi.fn(async () => saved),
    discard: vi.fn(async () => undefined),
    resolveConflict: vi.fn(async () => undefined),
    lastSyncedAt: null,
    localCopy: null,
    adoptLocalCopy: vi.fn(),
    discardLocalCopy: vi.fn(),
    authExpired: false,
  };
}

function lastWorkOptions(): Record<string, unknown> {
  const calls = mockUseWorkDraft.mock.calls as [Record<string, unknown>][];
  return calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  resetDocument();
  resetOwnerSessionCache();
  mockUseWorkDraft.mockReset();
  mockCommitWorkDraft.mockReset();
  mockUseWorkDraft.mockReturnValue(workStub());
  navState.pathname = "/admin/journal/new";
  navState.search = "";
  mockRouter.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetOwnerSessionCache();
});

describe("新建页：日期默认与 ?date=", () => {
  it("没有 ?date= 时用站点时区今天（API 的 today）", async () => {
    stubOwnerFetch();
    const view = render(<JournalNewEditor />);
    await advance(60);
    const date = view.container.querySelector<HTMLInputElement>('[data-editor-field="date"]');
    expect(date?.value).toBe("2026-10-18");
    expect(view.container.textContent ?? "").toContain("站点时区");
    view.unmount();
  });

  it("?date=2026-10-05 时使用日历选中的那一天，并说明来源", async () => {
    stubOwnerFetch();
    navState.search = "date=2026-10-05";
    const view = render(<JournalNewEditor />);
    await advance(60);
    const date = view.container.querySelector<HTMLInputElement>('[data-editor-field="date"]');
    expect(date?.value).toBe("2026-10-05");
    expect(view.container.textContent ?? "").toContain("日历");
    view.unmount();
  });

  it("?date= 非法时回退到今天，并明确说明", async () => {
    stubOwnerFetch();
    navState.search = "date=2026-13-40";
    const view = render(<JournalNewEditor />);
    await advance(60);
    const date = view.container.querySelector<HTMLInputElement>('[data-editor-field="date"]');
    expect(date?.value).toBe("2026-10-18");
    expect(view.container.textContent ?? "").toContain("不是有效日期");
    view.unmount();
  });

  it("returnTo 与 entry 入口 id 都传给工作草稿引擎（返回来源 + 刷新恢复）", async () => {
    stubOwnerFetch();
    navState.search = `date=2026-10-05&returnTo=${encodeURIComponent(
      "/apps/journal?screen=calendar&phone=journal",
    )}`;
    const view = render(<JournalNewEditor />);
    await advance(60);

    const options = lastWorkOptions();
    expect(options.contentType).toBe("journal");
    expect(options.targetId).toBeNull();
    expect(options.returnTo).toBe("/apps/journal?screen=calendar&phone=journal");
    expect(typeof options.entryId).toBe("string");
    expect((options.entryId as string).length).toBeGreaterThan(8);
    // URL 里写入 entry 参数（useEntryId 的 router.replace；这里只断言确实调用了 replace）
    expect(mockRouter.replace).toHaveBeenCalled();
    view.unmount();
  });

  it("匿名访客只看到登录提示，不挂载编辑器", async () => {
    stubAnonymousFetch();
    const view = render(<JournalNewEditor />);
    await advance(40);
    expect(view.container.textContent ?? "").toContain("需要站主登录");
    expect(view.container.querySelector('[data-editor="journal"]')).toBeNull();
    view.unmount();
  });
});

describe("编辑页", () => {
  it("先读出正式手记与图片详情，再渲染编辑器（已公开 → 只有更新按钮）", async () => {
    stubOwnerFetch();
    navState.pathname = "/admin/journal/e1/edit";
    const view = render(<JournalEditEditor entryId="e1" />);
    await advance(100);

    expect(view.container.querySelector('[data-editor="journal"]')).not.toBeNull();
    const title = view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]');
    expect(title?.value).toBe("已公开的一天");
    expect(view.container.querySelector('[data-editor-submit-action="update"]')?.textContent).toBe(
      "更新正式内容",
    );
    // 图片：真实补取的媒体详情 + 替代文本都显示出来
    const imageRow = view.container.querySelector("[data-journal-image]");
    expect(imageRow?.getAttribute("data-journal-image")).toBe(MEDIA.id);
    expect(imageRow?.textContent ?? "").toContain("街景");

    const options = lastWorkOptions();
    expect(options.targetId).toBe("e1");
    view.unmount();
  });

  it("读不到时区分 404 与可重试失败（不把服务故障说成不存在）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        const target = String(url);
        if (target.includes("/auth/owner-status")) {
          return json({ authenticated: true, user: SESSION.user });
        }
        if (target.includes("/auth/session")) return json(SESSION);
        if (target.includes("/journal/calendar")) return json(CALENDAR);
        if (target.includes("/admin/journal/entries/missing")) {
          return json(
            { error: { code: "NOT_FOUND", message: "不存在", fields: {} }, request_id: "r" },
            404,
          );
        }
        return json({ items: [], next_cursor: null });
      }),
    );
    navState.pathname = "/admin/journal/missing/edit";
    const view = render(<JournalEditEditor entryId="missing" />);
    await advance(100);
    const text = view.container.textContent ?? "";
    expect(text).toContain("不存在");
    expect(text).toContain("回到手记列表");
    // 404 不给「重新读取」按钮（重试也不会变成存在）
    expect(text).not.toContain("重新读取");
    view.unmount();
  });
});
