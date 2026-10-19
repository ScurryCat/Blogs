/**
 * 手记编辑器 × 真实工作草稿 Hook 的集成回归（P5 返工 R1 / R2）。
 *
 * 与 `journal-editor.test.tsx`（替身 Hook，专注业务语义）互补：这里**不 mock**
 * `useWorkDraft` / `commitWorkDraft`，只替换 fetch 这一层，验证「保存失败 → 不提交」
 * 与「指定草稿恢复」在真实 Hook 契约下成立：
 *  - R1：PATCH 500 时点保存/公开 → commit 请求为 0、无成功提示、表单与本机副本保留；
 *        恢复后重试 → commit 前的 PATCH 携带当前表单内容；
 *  - R1：PATCH 412 时点保存 → 冲突文案、commit 请求为 0（不旁路提交）；
 *  - R2：新建手记 `?draft=`（draftId）→ GET 恢复日期/标题/正文/图片，不新建空草稿，
 *        默认私密语义不变。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubFetch, type FetchStub, type RecordedRequest } from "@/features/ins/test-support";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { JournalEditor } from "./journal-editor";
import type { JournalAdminEntry } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/journal/new",
  useSearchParams: () => new URLSearchParams(),
}));

const ENTRY_ID = "entry-1";
const DRAFT_ID = "draft-journal-1";
const RESUMED_DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";

const COMMIT_ROUTE = /\/admin\/work-drafts\/.+\/commit$/;
const CREATE_ROUTE = { match: "/admin/work-drafts", method: "POST" };
const PATCH_ROUTE = { match: "/admin/work-drafts/", method: "PATCH" };

function entry(overrides: Partial<JournalAdminEntry> = {}): JournalAdminEntry {
  return {
    id: ENTRY_ID,
    entry_date: "2026-10-09",
    title: "原标题",
    content_md: "原正文。",
    mood: "",
    location: "",
    status: "draft",
    visibility: "private",
    post: null,
    images: [],
    published_at: null,
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    deleted_at: null,
    version: 2,
    public: false,
    shared_media: [],
    ...overrides,
  };
}

function draftBody(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    content_type: "journal",
    target_id: ENTRY_ID,
    target_version: 2,
    draft_version: 1,
    status: "active",
    summary: "",
    data: {
      entry_date: "2026-10-09",
      title: "原标题",
      content_md: "原正文。",
      mood: "",
      location: "",
      post_id: null,
    },
    images: [],
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    ...overrides,
  };
}

function commitResultBody(overrides: Record<string, unknown> = {}) {
  return {
    draft_id: DRAFT_ID,
    content_type: "journal",
    target_id: ENTRY_ID,
    target_version: 3,
    status: "draft",
    visibility: "private",
    action: "save",
    idempotent_replay: false,
    ...overrides,
  };
}

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

function renderEdit(overrides: { draftId?: string | null } = {}) {
  return render(
    <JournalEditor
      mode="edit"
      entry={entry()}
      initialDate="2026-10-09"
      dateHint={null}
      ownerId="owner-1"
      csrfToken="csrf-token"
      returnTo={null}
      posts={[]}
      postsError={null}
      images={[]}
      timezone="Asia/Shanghai"
      today="2026-10-18"
      entryId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      draftId={overrides.draftId ?? null}
    />,
  );
}

function setInput(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function workDraftKeys(): string[] {
  return Object.keys(window.localStorage).filter((key) => key.startsWith("pl.workdraft.v1."));
}

function commits(requests: ReadonlyArray<RecordedRequest>) {
  return requests.filter(
    (request) => request.method === "POST" && COMMIT_ROUTE.test(request.url),
  );
}

describe("JournalEditor × 真实 Hook · R1 保存失败不提交", () => {
  it("PATCH 500：点保存 commit 为 0，保留表单与本机副本；恢复后重试提交当前输入", async () => {
    stub = stubFetch([
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody() },
      { ...CREATE_ROUTE, body: { draft: draftBody(), reused: true } },
      {
        ...PATCH_ROUTE,
        status: 500,
        body: { error: { code: "INTERNAL", message: "模拟 PATCH 500", fields: {} }, request_id: "r" },
      },
    ]);
    const view = renderEdit();
    await advance(140);

    setInput(view.container, '[data-editor-field="title"]', "最新标题");
    setInput(view.container, '[data-editor-field="content"]', "最新正文内容。");
    click(view.container.querySelector('[data-editor-submit-action="save"]'));
    await advance(300);

    expect(commits(stub.requests)).toHaveLength(0);
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();
    expect(
      view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]')?.value,
    ).toBe("最新标题");
    expect(view.container.querySelector("[data-editor-error]")?.textContent ?? "").toContain(
      "模拟 PATCH 500",
    );
    // 本机副本保留最新输入
    const keys = workDraftKeys();
    expect(keys).toHaveLength(1);
    expect(window.localStorage.getItem(keys[0] ?? "") ?? "").toContain("最新正文内容。");

    // 解除阻断：重试时 PATCH 携带当前表单，commit 使用同一快照
    stub.restore();
    stub = stubFetch([
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody() },
      {
        ...PATCH_ROUTE,
        body: draftBody({
          draft_version: 2,
          data: {
            entry_date: "2026-10-09",
            title: "最新标题",
            content_md: "最新正文内容。",
            mood: "",
            location: "",
            post_id: null,
          },
        }),
      },
    ]);
    click(view.container.querySelector('[data-editor-submit-action="save"]'));
    await advance(300);

    const patches = stub.requests.filter((request) => request.method === "PATCH");
    expect((patches.at(-1)?.body as { data?: { title?: string } }).data?.title).toBe("最新标题");
    expect(commits(stub.requests)).toHaveLength(1);
    expect(view.container.querySelector("[data-editor-success]")).not.toBeNull();
    // 提交快照与当前内容一致 → 成功后清本机副本
    expect(workDraftKeys()).toHaveLength(0);
    view.unmount();
  }, 20000);

  it("PATCH 412：点保存显示冲突文案、commit 为 0（不旁路提交）", async () => {
    stub = stubFetch([
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody() },
      { ...CREATE_ROUTE, body: { draft: draftBody(), reused: true } },
      {
        ...PATCH_ROUTE,
        status: 412,
        body: { error: { code: "VERSION_CONFLICT", message: "草稿版本冲突", fields: {} }, request_id: "r" },
      },
    ]);
    const view = renderEdit();
    await advance(140);

    setInput(view.container, '[data-editor-field="title"]', "冲突时的本机标题");
    click(view.container.querySelector('[data-editor-submit-action="save"]'));
    await advance(300);

    expect(commits(stub.requests)).toHaveLength(0);
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();
    expect(view.container.querySelector("[data-editor-error]")?.textContent ?? "").toContain(
      "自动保存已暂停",
    );
    expect(
      view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]')?.value,
    ).toBe("冲突时的本机标题");
    view.unmount();
  }, 20000);
});

describe("JournalEditor × 真实 Hook · R2 指定草稿恢复（新建手记）", () => {
  it("draftId：GET 恢复日期/标题/正文/图片，不新建空草稿，默认私密语义不变", async () => {
    stub = stubFetch([
      {
        match: `/admin/work-drafts/${RESUMED_DRAFT_ID}`,
        method: "GET",
        body: {
          id: RESUMED_DRAFT_ID,
          content_type: "journal",
          target_id: null,
          target_version: null,
          draft_version: 5,
          status: "active",
          summary: "",
          data: {
            entry_date: "2026-10-05",
            title: "跨设备恢复的手记",
            content_md: "跨设备恢复的正文。",
            mood: "专注",
            location: "四轩茶屋",
            post_id: null,
          },
          images: [{ media_id: MEDIA_ID, position: 0, alt: "街景" }],
          created_at: "2026-10-18T00:00:00Z",
          updated_at: "2026-10-19T00:00:00Z",
        },
      },
    ]);
    const view = render(
      <JournalEditor
        mode="new"
        entry={null}
        initialDate="2026-10-18"
        dateHint={null}
        ownerId="owner-1"
        csrfToken="csrf-token"
        returnTo={null}
        posts={[]}
        postsError={null}
        images={[]}
        timezone="Asia/Shanghai"
        today="2026-10-18"
        entryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        draftId={RESUMED_DRAFT_ID}
      />,
    );
    await advance(240);

    expect(view.container.querySelector<HTMLInputElement>('[data-editor-field="date"]')?.value).toBe(
      "2026-10-05",
    );
    expect(view.container.querySelector<HTMLInputElement>('[data-editor-field="title"]')?.value).toBe(
      "跨设备恢复的手记",
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>('[data-editor-field="content"]')?.value,
    ).toBe("跨设备恢复的正文。");
    expect(view.container.querySelector("[data-journal-image]")?.getAttribute("data-journal-image")).toBe(
      MEDIA_ID,
    );
    // 新建草稿恢复后仍是「草稿 + 仅自己可见」，公开仍是单独动作
    const status = view.container.querySelector("[data-editor-status]");
    expect(status?.getAttribute("data-editor-status")).toBe("draft");
    expect(status?.getAttribute("data-editor-visibility")).toBe("private");
    expect(view.container.querySelector('[data-editor-submit-action="publish"]')).not.toBeNull();
    // 恢复指定草稿不新建草稿（POST /admin/work-drafts 只允许在首次真实输入后）
    expect(
      stub.requests.filter(
        (request) => request.method === "POST" && request.url.includes("/admin/work-drafts"),
      ),
    ).toHaveLength(0);
    view.unmount();
  }, 20000);

  it("draftId 404：resumeError 可见、禁止编辑提交、不自动新建草稿", async () => {
    stub = stubFetch([
      {
        match: `/admin/work-drafts/${RESUMED_DRAFT_ID}`,
        method: "GET",
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "工作草稿不存在", fields: {} }, request_id: "r" },
      },
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody() },
    ]);
    const view = render(
      <JournalEditor
        mode="new"
        entry={null}
        initialDate="2026-10-18"
        dateHint={null}
        ownerId="owner-1"
        csrfToken="csrf-token"
        returnTo={null}
        posts={[]}
        postsError={null}
        images={[]}
        timezone="Asia/Shanghai"
        today="2026-10-18"
        entryId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        draftId={RESUMED_DRAFT_ID}
        newDraftHref="/admin/journal/new"
      />,
    );
    await advance(240);

    const alert = view.container.querySelector("[data-editor-resume-error]");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent ?? "").toContain("不存在");
    expect(
      view.container.querySelector<HTMLAnchorElement>("[data-editor-resume-blank]")?.getAttribute(
        "href",
      ),
    ).toBe("/admin/journal/new");
    expect(
      view.container.querySelector<HTMLFieldSetElement>("fieldset")?.disabled,
    ).toBe(true);
    expect(
      view.container.querySelector<HTMLButtonElement>('[data-editor-submit-action="save"]')?.disabled,
    ).toBe(true);
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();
    expect(
      stub.requests.filter((request) => request.method === "POST" && request.url.includes("/admin/work-drafts")),
    ).toHaveLength(0);
    view.unmount();
  }, 20000);
});
