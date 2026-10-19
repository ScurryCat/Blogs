/**
 * 创作台首页 `/admin`（契约 §4.7 / §9.5）。
 *
 * 断言：四项实际任务都在；**没有假统计/占位数据**；空态说明从哪开始；
 * 未登录给登录入口；取数失败如实显示；继续编辑链接按路由约定并保留 returnTo。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, render, resetDocument } from "@/tests/helpers/render";

import { resetOwnerSessionCache } from "./session";
import { WorkspaceHome } from "./workspace-home";
import {
  errorResponse,
  jsonResponse,
  makeWorkDraft,
  stubFetch,
  type FetchStub,
} from "./test-support";
import type { JournalAdminEntry } from "@/features/journal/types";
import type { MomentAdmin } from "@/features/ins/types";

const SESSION_OWNER = {
  authenticated: true,
  user: { id: "owner-1", username: "owner" },
  csrf_token: "csrf-1",
  expires_at: null,
  prelogin: false,
};

function momentAdmin(overrides: Partial<MomentAdmin> = {}): MomentAdmin {
  return {
    id: "moment-1",
    text: "操场上的下午",
    tags: [],
    published_at: "2026-10-18T08:00:00Z",
    images: [],
    status: "published",
    version: 2,
    created_at: "2026-10-18T08:00:00Z",
    updated_at: "2026-10-18T09:00:00Z",
    images_admin: [],
    ...overrides,
  } as MomentAdmin;
}

function journalAdmin(overrides: Partial<JournalAdminEntry> = {}): JournalAdminEntry {
  return {
    id: "entry-1",
    entry_date: "2026-10-17",
    title: "雨天的记录",
    content_md: "正文",
    mood: "平静",
    location: "",
    status: "published",
    visibility: "public",
    post: null,
    images: [],
    published_at: "2026-10-17T12:00:00Z",
    created_at: "2026-10-17T12:00:00Z",
    updated_at: "2026-10-17T13:00:00Z",
    deleted_at: null,
    version: 2,
    public: true,
    shared_media: [],
    ...overrides,
  };
}

let stub: FetchStub | null = null;
let rendered: ReturnType<typeof render> | null = null;

function ownerRoutes(extra: {
  drafts?: unknown;
  moments?: unknown;
  entries?: unknown;
  draftsError?: boolean;
} = {}) {
  return [
    { match: "/auth/owner-status", body: { authenticated: true, user: { id: "owner-1", username: "owner" } } },
    { match: "/auth/session", body: SESSION_OWNER },
    {
      match: "/admin/work-drafts",
      method: "GET",
      respond: () =>
        extra.draftsError
          ? errorResponse(500, "INTERNAL", "草稿服务出错")
          : jsonResponse(extra.drafts ?? { items: [], next_cursor: null }),
    },
    {
      match: "/admin/moments",
      method: "GET",
      respond: () => jsonResponse(extra.moments ?? { items: [], next_cursor: null }),
    },
    {
      match: "/admin/journal/entries",
      method: "GET",
      respond: () => jsonResponse(extra.entries ?? { items: [], next_cursor: null }),
    },
  ];
}

async function renderHome(): Promise<HTMLElement> {
  rendered = render(<WorkspaceHome />);
  await advance(120);
  await advance(120);
  return rendered.container;
}

function textOf(container: HTMLElement): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  resetDocument();
  resetOwnerSessionCache();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  stub?.restore();
  stub = null;
  resetOwnerSessionCache();
  resetDocument();
});

describe("WorkspaceHome", () => {
  it("未登录：只给登录入口，不渲染任何站主入口、不发管理侧读取", async () => {
    stub = stubFetch([{ match: "/auth/owner-status", body: { authenticated: false, user: null } }]);
    const container = await renderHome();

    expect(container.querySelector("[data-workspace-home]")).not.toBeNull();
    expect(container.querySelector("[data-workspace-login-required]")).not.toBeNull();
    expect(container.querySelector("[data-workspace-start]")).toBeNull();
    expect(container.querySelector("[data-workspace-draft-row]")).toBeNull();
    expect(stub.requests.some((request) => request.url.includes("/admin/work-drafts"))).toBe(false);
    expect(stub.requests.some((request) => request.url.includes("/auth/session"))).toBe(false);
    expect(textOf(container)).toContain("需要站主登录");
  });

  it("已登录、无内容：四项区块都在，空态说明从哪开始（无假数据）", async () => {
    stub = stubFetch(ownerRoutes());
    const container = await renderHome();

    expect(container.querySelector("[data-workspace-home]")).not.toBeNull();
    // ① 开始记录：四个动作
    const starts = Array.from(container.querySelectorAll("[data-workspace-start]")).map((element) =>
      element.getAttribute("data-workspace-start"),
    );
    expect(starts).toEqual(["moment", "journal", "anime", "game"]);
    // ② 继续编辑：空态说明自动保存
    expect(container.querySelector("[data-workspace-drafts-empty]")?.textContent).toContain("自动保存");
    // ③ 近期内容：空态说明从哪里开始
    expect(container.querySelector("[data-workspace-recent-empty]")?.textContent).toContain("开始记录");
    // ④ 内容管理：真实已有管理页链接
    const manageLinks = Array.from(container.querySelectorAll("[data-workspace-manage-link]")).map(
      (element) => element.getAttribute("data-workspace-manage-link"),
    );
    expect(manageLinks).toEqual(
      expect.arrayContaining([
        "/admin/albums",
        "/admin/projects",
        "/admin/friends",
        "/admin/palaces",
        "/admin/skills",
        "/admin/exploration",
        "/admin/messages",
      ]),
    );
    // 没有占位内容/假统计
    expect(textOf(container)).not.toContain("暂无通知");
  });

  it("已登录、有数据：继续编辑与近期内容渲染真实数据（编辑+预览）", async () => {
    stub = stubFetch(
      ownerRoutes({
        drafts: {
          items: [
            makeWorkDraft({
              id: "draft-moment",
              content_type: "moment",
              target_id: "moment-1",
              target_version: 2,
              draft_version: 4,
              summary: "未发出的动态文字",
              updated_at: "2026-10-18T10:00:00Z",
            }),
            makeWorkDraft({
              id: "draft-journal",
              content_type: "journal",
              target_id: null,
              draft_version: 1,
              summary: "新手记草稿",
              updated_at: "2026-10-18T11:00:00Z",
            }),
          ],
          next_cursor: null,
        },
        moments: { items: [momentAdmin()], next_cursor: null },
        entries: { items: [journalAdmin()], next_cursor: null },
      }),
    );
    const container = await renderHome();

    const rows = Array.from(container.querySelectorAll("[data-workspace-draft-row]"));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-workspace-draft-row")).toBe("moment");
    expect(rows[0]?.textContent).toContain("未发出的动态文字");
    // 已有正式内容：维持原编辑页路径（编辑页自己复用该内容的工作草稿）。
    expect(rows[0]?.getAttribute("href")).toBe("/admin/moments/moment-1/edit");
    expect(rows[1]?.getAttribute("data-workspace-draft-row")).toBe("journal");
    // R2：尚无正式内容（target_id=null）的草稿必须带 `?draft=` 唯一标识，
    // 否则「继续编辑」只会打开空白新建页，新草稿无法跨设备恢复。
    expect(rows[1]?.getAttribute("href")).toBe("/admin/journal/new?draft=draft-journal");
    expect(rows[0]?.textContent).toContain("最近同步");

    const recentRows = Array.from(container.querySelectorAll("[data-workspace-recent-row]"));
    expect(recentRows).toHaveLength(2);
    expect(recentRows[0]?.getAttribute("data-workspace-recent-row")).toBe("moment");
    expect(recentRows[0]?.textContent).toContain("操场上的下午");
    expect(recentRows[0]?.textContent).toContain("已发布");
    expect(recentRows[1]?.getAttribute("data-workspace-recent-row")).toBe("journal");
    expect(recentRows[1]?.textContent).toContain("雨天的记录");

    const links = Array.from(container.querySelectorAll("[data-workspace-recent-row] a")).map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(links).toEqual(
      expect.arrayContaining(["/admin/moments/moment-1/edit", "/apps/ins/moment-1", "/apps/journal/entry-1"]),
    );
  });

  it("创作台自身带 returnTo 时，继续编辑链接保留来源上下文", async () => {
    window.history.replaceState(null, "", "/admin?returnTo=%2Fapps%2Fins");
    stub = stubFetch(
      ownerRoutes({
        drafts: {
          items: [
            makeWorkDraft({ id: "draft-moment", content_type: "moment", target_id: "moment-1" }),
          ],
          next_cursor: null,
        },
      }),
    );
    const container = await renderHome();
    const row = container.querySelector("[data-workspace-draft-row]");
    expect(row?.getAttribute("href")).toBe(
      "/admin/moments/moment-1/edit?returnTo=%2Fapps%2Fins",
    );
    window.history.replaceState(null, "", "/admin");
  });

  it("R2：尚无 target 的新动态/新手记草稿链接带 ?draft= 且保留 returnTo；已有 target 不带", async () => {
    window.history.replaceState(null, "", "/admin?returnTo=%2Fapps%2Fjournal");
    stub = stubFetch(
      ownerRoutes({
        drafts: {
          items: [
            makeWorkDraft({
              id: "draft-new-moment",
              content_type: "moment",
              target_id: null,
              draft_version: 3,
            }),
            makeWorkDraft({
              id: "draft-new-journal",
              content_type: "journal",
              target_id: null,
              draft_version: 1,
            }),
            makeWorkDraft({
              id: "draft-existing-moment",
              content_type: "moment",
              target_id: "moment-9",
            }),
          ],
          next_cursor: null,
        },
      }),
    );
    const container = await renderHome();
    const hrefs = Array.from(container.querySelectorAll("[data-workspace-draft-row]")).map(
      (element) => element.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "/admin/moments/new?draft=draft-new-moment&returnTo=%2Fapps%2Fjournal",
      "/admin/journal/new?draft=draft-new-journal&returnTo=%2Fapps%2Fjournal",
      "/admin/moments/moment-9/edit?returnTo=%2Fapps%2Fjournal",
    ]);
    window.history.replaceState(null, "", "/admin");
  });

  it("工作草稿读取失败：如实显示原因与重试，不伪装成空列表", async () => {
    stub = stubFetch(ownerRoutes({ draftsError: true }));
    const container = await renderHome();

    const error = container.querySelector("[data-workspace-drafts-error]");
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("草稿服务出错");
    expect(container.querySelector("[data-workspace-drafts-empty]")).toBeNull();
    expect(error?.textContent).toContain("重试");
  });

  it("站主探针失败（服务不可用）：显示错误与重试，不渲染站主入口", async () => {
    stub = stubFetch([{ match: "/auth/owner-status", throws: true }]);
    const container = await renderHome();

    expect(container.querySelector("[data-workspace-session-error]")).not.toBeNull();
    expect(container.querySelector("[data-workspace-start]")).toBeNull();
    expect(textOf(container)).toContain("无法确认站主身份");
  });
});
