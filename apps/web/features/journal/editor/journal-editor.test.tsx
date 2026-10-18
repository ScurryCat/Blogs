/**
 * 手记独立编辑页的组件行为（P5 · C4；设计书 §2.4 / 契约 §4.5 / §9.5）。
 *
 * 这里用替身替换 C2 的 `useWorkDraft`（它自己的自动保存/冲突/本机副本由
 * `features/workspace/use-work-draft.test.tsx` 覆盖），专注钉住手记的业务语义：
 *  - 新建默认草稿 + 私密（status=draft / visibility=private），界面上「保存」≠「公开」；
 *  - 公开是独立动作：先过发布门槛（缺标题/正文时集中列出阻塞原因且**不发请求**）；
 *  - 编辑已公开手记：只有「更新正式内容」；打字只写工作副本（update），提交才改正式内容；
 *  - 失败保留输入、不显示成功；412 给出可行动说明；
 *  - Markdown 预览、图片选择器接入、关联文章、日期 ?date= 初值；
 *  - C5 e2e 依赖的 data-editor-* / data-sync-state 钩子稳定存在。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PickedImage } from "@/features/media-picker";
import { ApiClientError } from "@/lib/api/client";
import { render, advance, click, resetDocument } from "@/tests/helpers/render";

import { JournalEditor } from "./journal-editor";
import type { JournalAdminEntry } from "../types";
import type { PostOption } from "./model";

const mockUseWorkDraft = vi.hoisted(() => vi.fn());
const mockCommitWorkDraft = vi.hoisted(() => vi.fn());
const mockGetWorkDraft = vi.hoisted(() => vi.fn());

vi.mock("@/features/workspace/use-work-draft", () => ({
  useWorkDraft: mockUseWorkDraft,
}));

vi.mock("@/features/workspace/api", () => ({
  commitWorkDraft: mockCommitWorkDraft,
  getWorkDraft: mockGetWorkDraft,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/journal/new",
  useSearchParams: () => new URLSearchParams(),
}));

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(status: number, code: string, fields: Record<string, string[]> = {}) {
  return new ApiClientError(status, { code, message: "接口错误", fields }, "req-test");
}

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
    { name: "w320.webp", width: 320, height: 213, bytes: 100, url: "/api/v1/media/33333333/w320.webp" },
    { name: "w640.webp", width: 640, height: 427, bytes: 200, url: "/api/v1/media/33333333/w640.webp" },
  ],
  original_url: "/api/v1/media/33333333/original",
};

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  };
}

function workStub(overrides: Record<string, unknown> = {}) {
  const saved = draft();
  return {
    draft: saved,
    state: "synced",
    syncMessage: "已同步 · 可在另一设备继续编辑",
    recoveryNotice: null,
    update: vi.fn(),
    saveNow: vi.fn(async () => saved),
    discard: vi.fn(async () => undefined),
    resolveConflict: vi.fn(async () => undefined),
    lastSyncedAt: "2026-10-18T00:00:00Z",
    localCopy: null,
    adoptLocalCopy: vi.fn(),
    discardLocalCopy: vi.fn(),
    authExpired: false,
    ...overrides,
  };
}

function entry(overrides: Partial<JournalAdminEntry> = {}): JournalAdminEntry {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    entry_date: "2026-10-09",
    title: "公开的一天",
    content_md: "原来的正文。",
    mood: "平静",
    location: "四轩茶屋",
    status: "draft",
    visibility: "private",
    post: null,
    images: [],
    published_at: null,
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    deleted_at: null,
    version: 3,
    public: false,
    shared_media: [],
    ...overrides,
  };
}

interface EditorOptions {
  entry?: JournalAdminEntry | null;
  initialDate?: string;
  images?: PickedImage[];
  posts?: PostOption[] | null;
  postsError?: string | null;
  returnTo?: string | null;
}

function renderEditor(options: EditorOptions = {}) {
  return render(
    <JournalEditor
      mode={options.entry ? "edit" : "new"}
      entry={options.entry ?? null}
      initialDate={options.initialDate ?? "2026-10-18"}
      dateHint={null}
      ownerId="owner-1"
      csrfToken="csrf-token"
      returnTo={options.returnTo ?? null}
      posts={options.posts ?? []}
      postsError={options.postsError ?? null}
      images={options.images ?? []}
      timezone="Asia/Shanghai"
      today="2026-10-18"
      entryId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    />,
  );
}

function setInput(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelect(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as HTMLSelectElement | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  resetDocument();
  mockUseWorkDraft.mockReset();
  mockCommitWorkDraft.mockReset();
  mockGetWorkDraft.mockReset();
  mockUseWorkDraft.mockReturnValue(workStub());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("新建手记：默认私密，保存 ≠ 公开", () => {
  it("初始状态是 draft + private；保存/公开是分开的明确按钮", () => {
    const view = renderEditor();
    expect(view.container.querySelector('[data-editor="journal"]')).not.toBeNull();
    const status = view.container.querySelector("[data-editor-status]");
    expect(status?.getAttribute("data-editor-status")).toBe("draft");
    expect(status?.getAttribute("data-editor-visibility")).toBe("private");
    expect(view.container.textContent ?? "").toContain("保存不会公开");
    const save = view.container.querySelector('[data-editor-submit-action="save"]');
    const publish = view.container.querySelector('[data-editor-submit-action="publish"]');
    expect(save?.textContent).toBe("保存草稿");
    expect(publish?.textContent).toBe("公开这篇");
    // 「保存」按钮绝不用「发布/公开」字样（避免一个按钮两种含义）。
    expect(save?.textContent ?? "").not.toContain("公开");
    view.unmount();
  });

  it("点「保存草稿」只提交 action=save，结果为正式草稿且仅自己可见", async () => {
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    mockCommitWorkDraft.mockResolvedValue({
      draft_id: "draft-1",
      content_type: "journal",
      target_id: "entry-1",
      target_version: 1,
      status: "draft",
      visibility: "private",
      action: "save",
      idempotent_replay: false,
    });
    const view = renderEditor();
    setInput(view.container, '[data-editor-field="title"]', "第一篇");
    setInput(view.container, '[data-editor-field="content"]', "今天写了一点。");
    click(view.container.querySelector('[data-editor-submit-action="save"]'));
    await advance(20);

    expect(work.update).toHaveBeenCalled();
    expect(mockCommitWorkDraft).toHaveBeenCalledTimes(1);
    const [csrf, draftId, draftVersion, body] = mockCommitWorkDraft.mock.calls[0] as [
      string,
      string,
      number,
      { action: string; expectedTargetVersion: number | null; commitKey: string },
    ];
    expect(csrf).toBe("csrf-token");
    expect(draftId).toBe("draft-1");
    expect(draftVersion).toBe(1);
    expect(body.action).toBe("save");
    expect(body.expectedTargetVersion).toBeNull();
    expect(body.commitKey.length).toBeGreaterThan(8);

    // 已提交后清理本机恢复副本（否则下次打开会被误报成「本机有未同步修改」）
    expect(work.discardLocalCopy).toHaveBeenCalled();
    const success = view.container.querySelector("[data-editor-success]");
    expect(success?.textContent ?? "").toContain("仅自己可见");
    expect(success?.textContent ?? "").toContain("要公开请单独点「公开这篇」");
    expect(success?.textContent ?? "").not.toContain("访客现在可以看到");
    // 成功后的状态钩子仍如实：草稿 + 私密
    const status = view.container.querySelector("[data-editor-status]");
    expect(status?.getAttribute("data-editor-status")).toBe("draft");
    expect(status?.getAttribute("data-editor-visibility")).toBe("private");
    view.unmount();
  });

  it("公开是独立动作：缺标题/正文时列出阻塞原因且不发提交请求", async () => {
    const view = renderEditor();
    const blockers = view.container.querySelector("[data-editor-blockers]");
    expect(blockers?.textContent ?? "").toContain("还没有标题");
    expect(blockers?.textContent ?? "").toContain("还没有正文");

    click(view.container.querySelector('[data-editor-submit-action="publish"]'));
    await advance(20);
    expect(mockCommitWorkDraft).not.toHaveBeenCalled();
    expect(view.container.querySelector("[data-editor-error]")?.textContent ?? "").toContain(
      "公开前还需要",
    );
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();
    view.unmount();
  });

  it("补齐标题正文后点公开：action=publish，成功说「访客现在可以看到」", async () => {
    mockCommitWorkDraft.mockResolvedValue({
      draft_id: "draft-1",
      content_type: "journal",
      target_id: "entry-9",
      target_version: 1,
      status: "published",
      visibility: "public",
      action: "publish",
      idempotent_replay: false,
    });
    const view = renderEditor();
    setInput(view.container, '[data-editor-field="title"]', "公开的一天");
    setInput(view.container, '[data-editor-field="content"]', "正文写好了。");
    click(view.container.querySelector('[data-editor-submit-action="publish"]'));
    await advance(20);

    const body = mockCommitWorkDraft.mock.calls[0]?.[3] as { action: string };
    expect(body.action).toBe("publish");
    const success = view.container.querySelector("[data-editor-success]");
    expect(success?.textContent ?? "").toContain("访客现在可以看到这一篇");
    const status = view.container.querySelector("[data-editor-status]");
    expect(status?.getAttribute("data-editor-status")).toBe("published");
    expect(status?.getAttribute("data-editor-visibility")).toBe("public");
    // 公开成功后提供「查看手记」入口
    expect(success?.textContent ?? "").toContain("查看手记");
    view.unmount();
  });
});

describe("编辑已公开手记：先工作副本，明确更新才改正式内容", () => {
  it("打字只写工作副本（update），不发任何提交请求", async () => {
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    const view = renderEditor({
      entry: entry({ status: "published", visibility: "public", public: true }),
    });
    setInput(view.container, '[data-editor-field="title"]', "改过的标题");
    await advance(20);

    expect(work.update).toHaveBeenCalledTimes(1);
    const patch = (work.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0];
    expect(patch.data.title).toBe("改过的标题");
    expect(mockCommitWorkDraft).not.toHaveBeenCalled();
    view.unmount();
  });

  it("只有「更新正式内容」按钮；明说访客仍看原版本；提交 action=update 且带正式版本", async () => {
    mockCommitWorkDraft.mockResolvedValue({
      draft_id: "draft-1",
      content_type: "journal",
      target_id: "11111111-1111-1111-1111-111111111111",
      target_version: 4,
      status: "published",
      visibility: "public",
      action: "update",
      idempotent_replay: false,
    });
    const view = renderEditor({
      entry: entry({ status: "published", visibility: "public", public: true }),
    });
    expect(view.container.querySelector('[data-editor-submit-action="save"]')).toBeNull();
    expect(view.container.querySelector('[data-editor-submit-action="publish"]')).toBeNull();
    const update = view.container.querySelector('[data-editor-submit-action="update"]');
    expect(update?.textContent).toBe("更新正式内容");
    expect(view.container.textContent ?? "").toContain("访客看到的仍是原版本");

    setInput(view.container, '[data-editor-field="content"]', "更新后的正文。");
    click(update);
    await advance(20);

    const body = mockCommitWorkDraft.mock.calls[0]?.[3] as {
      action: string;
      expectedTargetVersion: number | null;
    };
    expect(body.action).toBe("update");
    expect(body.expectedTargetVersion).toBe(3);
    expect(view.container.querySelector("[data-editor-success]")?.textContent ?? "").toContain(
      "访客现在看到的是新版本",
    );
    view.unmount();
  });

  it("412 版本冲突：保留输入、不显示成功、给出可行动说明", async () => {
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    mockCommitWorkDraft.mockRejectedValue(apiError(412, "VERSION_CONFLICT"));
    const view = renderEditor({
      entry: entry({ status: "published", visibility: "public", public: true }),
    });
    setInput(view.container, '[data-editor-field="title"]', "还没提交的标题");
    click(view.container.querySelector('[data-editor-submit-action="update"]'));
    await advance(20);

    expect(view.container.querySelector("[data-editor-error]")?.textContent ?? "").toContain("412");
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();
    const title = view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]');
    expect(title?.value).toBe("还没提交的标题");
    // 失败后按钮恢复可点（可以重新读取后重试）
    const update = view.container.querySelector<HTMLButtonElement>(
      '[data-editor-submit-action="update"]',
    );
    expect(update?.disabled).toBe(false);
    view.unmount();
  });
});

describe("失败与防重复提交", () => {
  it("422 发布校验失败：保留输入、显示字段原因、不显示成功", async () => {
    mockCommitWorkDraft.mockRejectedValue(
      apiError(422, "VALIDATION_FAILED", { content_md: ["正文不能为空"] }),
    );
    const view = renderEditor();
    setInput(view.container, '[data-editor-field="title"]', "标题有了");
    setInput(view.container, '[data-editor-field="content"]', "正文有了");
    click(view.container.querySelector('[data-editor-submit-action="save"]'));
    await advance(20);
    const error = view.container.querySelector("[data-editor-error]");
    expect(error?.textContent ?? "").toContain("422");
    expect(error?.textContent ?? "").toContain("content_md");
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();
    expect(
      view.container.querySelector<HTMLTextAreaElement>('[data-editor-field="content"]')?.value,
    ).toBe("正文有了");
    view.unmount();
  });

  it("提交中按钮禁用，连点只提交一次", async () => {
    let release: ((value: unknown) => void) | null = null;
    mockCommitWorkDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = renderEditor();
    setInput(view.container, '[data-editor-field="title"]', "标题");
    setInput(view.container, '[data-editor-field="content"]', "正文");
    const save = view.container.querySelector<HTMLButtonElement>(
      '[data-editor-submit-action="save"]',
    );
    click(save);
    await advance(10);
    expect(save?.disabled).toBe(true);
    expect(save?.textContent).toContain("保存中");
    click(save);
    click(save);
    await advance(10);
    expect(mockCommitWorkDraft).toHaveBeenCalledTimes(1);
    if (release) {
      act(() => {
        (release as (value: unknown) => void)({
          draft_id: "draft-1",
          content_type: "journal",
          target_id: "entry-1",
          target_version: 1,
          status: "draft",
          visibility: "private",
          action: "save",
          idempotent_replay: false,
        });
      });
    }
    await advance(20);
    view.unmount();
  });

  it("空内容点保存：明确提示先写内容，不提交空正式草稿", async () => {
    const view = renderEditor();
    click(view.container.querySelector('[data-editor-submit-action="save"]'));
    await advance(20);
    expect(mockCommitWorkDraft).not.toHaveBeenCalled();
    expect(view.container.querySelector("[data-editor-error]")?.textContent ?? "").toContain(
      "先写一点内容再保存",
    );
    view.unmount();
  });
});

describe("Markdown 预览与次要信息", () => {
  it("Markdown 正文可预览（复用 legacy markdown 渲染）", async () => {
    const view = renderEditor();
    setInput(view.container, '[data-editor-field="content"]', "## 小标题\n\n正文**加粗**。");
    click(view.container.querySelector('[data-journal-pane="preview"]'));
    await advance(10);
    const preview = view.container.querySelector("[data-journal-preview]");
    expect(preview?.textContent ?? "").toContain("小标题");
    expect(preview?.textContent ?? "").toContain("加粗");
    view.unmount();
  });

  it("日期 / 心情 / 地点都是主/次要区域的真实输入，并写进工作副本 data", async () => {
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    const view = renderEditor({ initialDate: "2026-10-05" });
    const date = view.container.querySelector<HTMLInputElement>('[data-editor-field="date"]');
    expect(date?.value).toBe("2026-10-05");
    setInput(view.container, '[data-editor-field="mood"]', "专注");
    setInput(view.container, '[data-editor-field="location"]', "四轩茶屋");

    const calls = work.update.mock.calls as [{ data: Record<string, unknown> }][];
    expect(calls.at(-1)?.[0].data.mood).toBe("专注");
    expect(calls.at(-1)?.[0].data.location).toBe("四轩茶屋");
    expect(calls.at(-1)?.[0].data.entry_date).toBe("2026-10-05");
    view.unmount();
  });

  it("关联文章下拉来自公开文章列表；选中后写入 post_id", async () => {
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    const view = renderEditor({
      posts: [{ id: "post-1", label: "长文标题" }],
    });
    const select = view.container.querySelector<HTMLSelectElement>("[data-journal-post]");
    expect(select?.textContent).toContain("长文标题");
    setSelect(view.container, "[data-journal-post]", "post-1");
    const calls = work.update.mock.calls as [{ data: Record<string, unknown> }][];
    expect(calls.at(-1)?.[0].data.post_id).toBe("post-1");
    view.unmount();
  });

  it("同步状态钩子稳定（data-sync-state）", () => {
    const view = renderEditor();
    expect(view.container.querySelector('[data-sync-state="synced"]')).not.toBeNull();
    view.unmount();
  });

  it("本机恢复副本：给出「采用本机 / 放弃本机」两个明确动作（不静默选择）", async () => {
    const localCopy = {
      data: { title: "本机标题", entry_date: "2026-10-05", content_md: "本机正文" },
      images: [] as PickedImage[],
      draftId: null,
      draftVersion: null,
      savedAt: "2026-10-18T00:00:00Z",
      returnTo: null,
    };
    const work = workStub({
      recoveryNotice: "已恢复本机未同步的修改（本机副本）。",
      localCopy,
    });
    mockUseWorkDraft.mockReturnValue(work);
    const view = renderEditor();
    const block = view.container.querySelector("[data-editor-recovery]");
    expect(block?.textContent ?? "").toContain("本机");

    click(view.container.querySelector("[data-workdraft-adopt-local]"));
    await advance(10);
    expect(work.adoptLocalCopy).toHaveBeenCalledTimes(1);
    // 采用后表单如实切到本机内容（内容不会静默丢失）
    const title = view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]');
    expect(title?.value).toBe("本机标题");

    click(view.container.querySelector("[data-workdraft-discard-local]"));
    await advance(10);
    expect(work.discardLocalCopy).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("冲突时展示 ConflictNotice；「载入最新版本」会把表单刷新成服务端最新内容（A6）", async () => {
    const work = workStub({ state: "conflict", syncMessage: "草稿已在其他设备更新，自动保存已暂停" });
    mockUseWorkDraft.mockReturnValue(work);
    // 本机冲突输入（还没被服务端接受）
    const view = renderEditor();
    setInput(view.container, '[data-editor-field="title"]', "冲突时的本机输入");
    // 服务端最新工作草稿（另一台设备保存过）
    mockGetWorkDraft.mockResolvedValue({
      ...draft(),
      data: {
        entry_date: "2026-10-09",
        title: "服务器最新标题",
        content_md: "服务器最新正文",
        mood: "平静",
        location: "四轩茶屋",
        post_id: null,
      },
      images: [],
    });

    const notice = view.container.querySelector("[data-workspace-conflict]");
    expect(notice).not.toBeNull();
    click(view.container.querySelector("[data-workspace-conflict-reload]"));
    await advance(20);

    expect(work.resolveConflict).toHaveBeenCalledWith("reload-latest");
    expect(mockGetWorkDraft).toHaveBeenCalledWith("draft-1");
    // 关键断言（C5 A6）：表单必须显示服务端最新文本，而不是冲突时的本机输入。
    const title = view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]');
    const content = view.container.querySelector<HTMLTextAreaElement>(
      '[data-editor-field="content"]',
    );
    expect(title?.value).toBe("服务器最新标题");
    expect(content?.value).toBe("服务器最新正文");
    // 本机副本已丢弃（内容就是最新版本，不应再被当成未同步修改）
    expect(work.discardLocalCopy).toHaveBeenCalled();

    click(view.container.querySelector("[data-workspace-conflict-save-as-new]"));
    await advance(10);
    expect(work.resolveConflict).toHaveBeenCalledWith("save-as-new");
    view.unmount();
  });
});

describe("图片接入共享选择器（C3）", () => {
  it("通过 MediaPickerDialog 选图：确认后图片进入列表并写进工作副本 images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        if (String(url).includes("/admin/media")) {
          return json({ items: [MEDIA], next_cursor: null });
        }
        return json({ items: [], next_cursor: null });
      }),
    );
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    const view = renderEditor();
    // 打开选择器（契约 §9.5 的稳定钩子 data-media-picker-open）
    click(view.container.querySelector("[data-media-picker-open]"));
    await advance(40);
    const dialog = view.container.querySelector("[data-media-picker]");
    expect(dialog).not.toBeNull();
    // 选中媒体库里的第一张
    const item = view.container.querySelector("[data-media-picker-item]");
    expect(item).not.toBeNull();
    click(item);
    await advance(10);
    // 确认
    click(view.container.querySelector("[data-media-picker-confirm]"));
    await advance(20);

    const imageRow = view.container.querySelector("[data-journal-image]");
    expect(imageRow?.getAttribute("data-journal-image")).toBe(MEDIA.id);
    const calls = work.update.mock.calls as [{ images: PickedImage[] }][];
    const images = calls.at(-1)?.[0].images ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]?.media_id).toBe(MEDIA.id);
    expect(images[0]?.position).toBe(0);
    view.unmount();
  });

  it("编辑已有的图片：真实补取的媒体详情会显示；不再要求输入媒体 ID", async () => {
    const work = workStub();
    mockUseWorkDraft.mockReturnValue(work);
    const view = renderEditor({
      entry: entry({
        images: [
          {
            media_id: MEDIA.id,
            position: 0,
            alt: "街景",
            width: 1200,
            height: 800,
            still_public: false,
          },
        ],
      }),
      images: [{ media_id: MEDIA.id, alt: "街景", position: 0, media: MEDIA as never }],
    });
    const row = view.container.querySelector("[data-journal-image]");
    expect(row?.getAttribute("data-journal-image")).toBe(MEDIA.id);
    expect(row?.textContent ?? "").toContain("街景");
    // 旧工作台那套「输入媒体 ID」的 textarea 不再出现在编辑页
    expect(view.container.querySelector('textarea[aria-label="每行一条：媒体 UUID 与替代文本"]')).toBeNull();
    view.unmount();
  });
});
