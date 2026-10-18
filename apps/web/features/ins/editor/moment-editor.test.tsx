/**
 * INS 独立编辑器行为（P5 第一批 · C3；契约 §4.4 / 设计书 §2.3）。
 *
 * 断言真实 HTTP 交互 + 用户可见结果：
 *  - 以选图为起点、未选图也能写文字并保存草稿（自动保存只写工作草稿，正式提交才 commit）；
 *  - 发布前集中列出全部阻塞原因，缺图/缺替代文本时不会发出 commit；
 *  - 发布失败保留输入、不显示虚假成功；重试复用同一个 commit_key（服务端幂等）；
 *  - 发布成功提供「查看动态」与「再发一条」；保存草稿成功可「继续编辑」；
 *  - 新建相册往返：打开相册页前发起 guard 保存，文字 / 图片 / 收录选择不丢；
 *  - returnTo 原样传给 EditorShell（含手机上下文查询串），返回按钮 replace 到来源。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
  usePathname: () => "/admin/moments/new",
  useSearchParams: () => new URLSearchParams(""),
}));

import { MomentEditor, type MomentEditorProps } from "./moment-editor";
import type { PickedImage } from "@/features/media-picker";
import { stubFetch, type FetchStub } from "@/features/ins/test-support";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

const MOMENT_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RETURN_TO = "/apps/ins?phone=ins&screen=detail&item=11111111-1111-4111-8111-111111111111&tag=校园";
const DATE = "2026-10-18T00:00:00Z";

function makeMedia(id = MEDIA_ID, overrides: Record<string, unknown> = {}) {
  return {
    id,
    mime_type: "image/png",
    bytes: 1234,
    width: 800,
    height: 600,
    sha256: "hash",
    status: "ready",
    created_at: DATE,
    original_url: `/api/v1/media/${id}/original`,
    variants: [
      { name: "w320.webp", width: 320, height: 240, bytes: 10, url: `/api/v1/media/${id}/w320.webp` },
    ],
    ...overrides,
  };
}

function workDraftBody(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    content_type: "moment",
    target_id: null,
    target_version: null,
    draft_version: 1,
    status: "active",
    summary: "",
    data: { text: "", tags: [], album_links: [] },
    images: [],
    created_at: DATE,
    updated_at: DATE,
    ...overrides,
  };
}

function commitResultBody(overrides: Record<string, unknown> = {}) {
  return {
    draft_id: DRAFT_ID,
    content_type: "moment",
    target_id: MOMENT_ID,
    target_version: 1,
    status: "draft",
    visibility: null,
    action: "save",
    idempotent_replay: false,
    ...overrides,
  };
}

const COMMIT_ROUTE = /\/admin\/work-drafts\/[0-9a-f-]+\/commit$/;
const CREATE_ROUTE = { match: "/admin/work-drafts", method: "POST" };
const PATCH_ROUTE = { match: "/admin/work-drafts/", method: "PATCH" };
const MEDIA_DETAIL_ROUTE = /\/admin\/media\/[0-9a-f-]{36}$/;

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.refresh.mockClear();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

function baseProps(overrides: Partial<MomentEditorProps> = {}): MomentEditorProps {
  return {
    targetId: null,
    targetStatus: null,
    targetVersion: null,
    initialData: { text: "", tags: [], album_links: [] },
    initialImages: [] as PickedImage[],
    returnTo: RETURN_TO,
    csrfToken: "csrf-token",
    ownerId: "owner-1",
    entryId: "entry-1",
    ...overrides,
  };
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>("[data-editor-field='text']");
  if (!element) throw new Error("找不到文字输入框");
  return element;
}

async function typeInto(element: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonBy(container: HTMLElement, selector: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(selector);
}

function workRequests(requests: ReadonlyArray<{ url: string; method: string }>) {
  return requests.filter((request) => request.url.includes("/admin/work-drafts"));
}

describe("MomentEditor · 选图优先与保存草稿", () => {
  it("首屏以选图为主动作；未选图也能写文字并保存草稿（自动保存只写工作草稿）", async () => {
    stub = stubFetch([
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody() },
      { ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } },
      { ...PATCH_ROUTE, body: workDraftBody({ draft_version: 2 }) },
    ]);
    const view = render(<MomentEditor {...baseProps()} />);
    await advance(40);

    // 首屏：图片区在前，明确说明草稿可以先不选图。
    expect(view.container.querySelector("[data-media-picker-open]")).not.toBeNull();
    expect(view.container.querySelector("[data-editor-media-empty]")?.textContent).toContain(
      "没有图片也可以先写文字并保存草稿",
    );
    expect(view.container.querySelector("[data-editor='moment']")).not.toBeNull();

    await typeInto(getTextarea(view.container), "未选图的文字");
    click(buttonBy(view.container, "[data-editor-save]"));
    await advance(200);

    const create = stub.requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/admin/work-drafts"),
    );
    expect(create).toBeDefined();
    expect((create?.body as Record<string, unknown>)?.data).toMatchObject({ text: "未选图的文字" });
    expect((create?.body as Record<string, unknown>)?.images).toEqual([]);

    const commit = stub.requests.find((request) => request.method === "POST" && COMMIT_ROUTE.test(request.url));
    expect((commit?.body as Record<string, unknown>)?.action).toBe("save");
    expect((commit?.body as Record<string, unknown>)?.expected_target_version).toBeNull();
    expect(String((commit?.body as Record<string, unknown>)?.commit_key)).toMatch(/^[0-9a-f-]{36}$/);

    expect(view.container.querySelector("[data-editor-success]")?.textContent).toContain("草稿已保存");
    expect(view.container.querySelector("[data-editor-continue]")).not.toBeNull();
    expect(view.container.querySelector("[data-editor-view]")).toBeNull();
    view.unmount();
  });

  it("从媒体库选择图片：确认后进入已选区并写入工作草稿 images", async () => {
    stub = stubFetch([
      { match: "/admin/media?", body: { items: [makeMedia()], next_cursor: null } },
      { ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } },
      { ...PATCH_ROUTE, body: workDraftBody({ draft_version: 2 }) },
      { match: MEDIA_DETAIL_ROUTE, body: makeMedia() },
    ]);
    const view = render(<MomentEditor {...baseProps()} />);
    await advance(40);

    click(buttonBy(view.container, "[data-media-picker-open]"));
    await advance(80);
    click(view.container.querySelector("[data-media-picker-item]"));
    await advance(20);
    click(view.container.querySelector("[data-media-picker-confirm]"));
    await advance(1200);

    expect(view.container.textContent).toContain("已选 1 / 9 张");
    const create = stub.requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/admin/work-drafts"),
    );
    const images = (create?.body as Record<string, unknown>)?.images as Array<Record<string, unknown>>;
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ media_id: MEDIA_ID, position: 0, alt: "" });
    view.unmount();
  });
});

describe("MomentEditor · 发布阻塞与失败保留", () => {
  it("缺图时集中列出阻塞原因，点发布不发 commit；缺替代文本同样列出", async () => {
    stub = stubFetch([{ ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } }]);
    const view = render(<MomentEditor {...baseProps()} />);
    await advance(40);

    expect(view.container.querySelector("[data-editor-blockers]")?.textContent).toContain(
      "发布前至少需要 1 张图片",
    );
    click(buttonBy(view.container, "[data-editor-publish]"));
    await advance(60);
    expect(view.container.querySelector("[data-editor-error]")?.textContent).toContain("还不能发布");
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    view.unmount();

    // 选了图但没写替代文本：阻塞原因里明确要求替代文本。
    stub?.restore();
    stub = stubFetch([{ match: MEDIA_DETAIL_ROUTE, body: makeMedia() }]);
    const second = render(
      <MomentEditor
        {...baseProps({
          initialData: { text: "文字", tags: [], album_links: [] },
          initialImages: [{ media_id: MEDIA_ID, alt: "" }],
        })}
      />,
    );
    await advance(80);
    expect(second.container.querySelector("[data-editor-blockers]")?.textContent).toContain(
      "每张图片都需要替代文本",
    );
    second.unmount();
  });

  it("发布失败保留输入、不显示虚假成功；重试复用同一个 commit_key", async () => {
    stub = stubFetch([
      {
        match: COMMIT_ROUTE,
        method: "POST",
        status: 422,
        body: {
          error: {
            code: "VALIDATION_FAILED",
            message: "发布校验失败",
            fields: { images: ["发布前至少需要 1 张图片"] },
          },
          request_id: "r",
        },
      },
      { ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } },
      { ...PATCH_ROUTE, body: workDraftBody({ draft_version: 2 }) },
    ]);
    const view = render(
      <MomentEditor
        {...baseProps({
          initialImages: [{ media_id: MEDIA_ID, alt: "操场" }],
        })}
      />,
    );
    await advance(40);

    await typeInto(getTextarea(view.container), "保留我");
    click(buttonBy(view.container, "[data-editor-publish]"));
    await advance(200);

    expect(view.container.querySelector("[data-editor-error]")?.textContent).toContain("服务端拒绝了这次提交");
    expect(getTextarea(view.container).value).toBe("保留我");
    expect(view.container.querySelector("[data-editor-success]")).toBeNull();

    const firstCommit = stub.requests.find((request) => request.method === "POST" && COMMIT_ROUTE.test(request.url));
    const firstKey = (firstCommit?.body as Record<string, unknown>)?.commit_key;

    // 重试（模拟网络重试 / 连点后的第二次点击）：必须复用同一个 key，避免重复发布。
    click(buttonBy(view.container, "[data-editor-publish]"));
    await advance(200);
    const commits = stub.requests.filter((request) => request.method === "POST" && COMMIT_ROUTE.test(request.url));
    expect(commits).toHaveLength(2);
    expect((commits[1]?.body as Record<string, unknown>)?.commit_key).toBe(firstKey);
    view.unmount();
  });
});

describe("MomentEditor · 提交成功", () => {
  it("发布成功提供「查看动态」与「再发一条」，状态区标记 published", async () => {
    stub = stubFetch([
      {
        match: COMMIT_ROUTE,
        method: "POST",
        body: commitResultBody({ status: "published", visibility: "public", action: "publish" }),
      },
      { ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } },
      { ...PATCH_ROUTE, body: workDraftBody({ draft_version: 2 }) },
    ]);
    const onStartAnother = vi.fn();
    const view = render(
      <MomentEditor
        {...baseProps({
          initialData: { text: "要发布的文字", tags: [], album_links: [] },
          initialImages: [{ media_id: MEDIA_ID, alt: "操场" }],
          onStartAnother,
        })}
      />,
    );
    await advance(40);
    click(buttonBy(view.container, "[data-editor-publish]"));
    await advance(200);

    const success = view.container.querySelector("[data-editor-success]");
    expect(success?.textContent).toContain("发布成功");
    expect(success?.getAttribute("data-editor-status")).toBe("published");
    const viewLink = view.container.querySelector<HTMLAnchorElement>("[data-editor-view]");
    expect(viewLink?.getAttribute("href")).toBe(`/apps/ins/${MOMENT_ID}`);
    expect(viewLink?.textContent).toBe("查看动态");

    click(buttonBy(view.container, "[data-editor-again]"));
    expect(onStartAnother).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("保存草稿成功「继续编辑」跳到该动态的编辑页（保留 returnTo）", async () => {
    stub = stubFetch([
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody() },
      { ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } },
      { ...PATCH_ROUTE, body: workDraftBody({ draft_version: 2 }) },
    ]);
    const view = render(<MomentEditor {...baseProps()} />);
    await advance(40);
    await typeInto(getTextarea(view.container), "先存草稿");
    click(buttonBy(view.container, "[data-editor-save]"));
    await advance(200);

    click(buttonBy(view.container, "[data-editor-continue]"));
    expect(nav.replace).toHaveBeenCalledWith(
      `/admin/moments/${MOMENT_ID}/edit?returnTo=${encodeURIComponent(RETURN_TO)}`,
    );
    view.unmount();
  });
});

describe("MomentEditor · 新建相册往返", () => {
  it("打开相册页前先发起工作草稿保存；文字 / 图片 / 收录选择不丢", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    stub = stubFetch([
      { match: "/admin/albums", body: { items: [], next_cursor: null } },
      { ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } },
      { ...PATCH_ROUTE, body: workDraftBody({ draft_version: 2 }) },
    ]);
    const view = render(
      <MomentEditor
        {...baseProps({
          initialData: { text: "往返保留的文字", tags: [], album_links: [] },
          initialImages: [{ media_id: MEDIA_ID, alt: "操场" }],
        })}
      />,
    );
    await advance(120);
    expect(view.container.textContent).toContain("同时收录到相册");

    const before = workRequests(stub.requests).length;
    click(buttonBy(view.container, "[data-album-admin-link]"));
    await advance(200);

    // 打开的是现有相册管理页；当前页没有离开。
    expect(openSpy).toHaveBeenCalledWith("/admin/albums", "_blank", "noopener,noreferrer");
    // 打开前已发起一次工作草稿保存（离开期间即使页面被系统回收也能恢复）。
    expect(workRequests(stub.requests).length).toBeGreaterThan(before);
    // 往返后输入不丢：文字、图片、alt 都还在。
    expect(getTextarea(view.container).value).toBe("往返保留的文字");
    expect(view.container.querySelectorAll("[data-editor-image]")).toHaveLength(1);
    expect(view.container.textContent).toContain("同时收录到相册");

    openSpy.mockRestore();
    view.unmount();
  });
});

describe("MomentEditor · 编辑已有内容", () => {
  it("工作草稿比正式内容新时回填草稿内容（继续编辑不丢草稿）", async () => {
    stub = stubFetch([
      {
        match: CREATE_ROUTE.match,
        method: "POST",
        body: {
          draft: workDraftBody({
            target_id: MOMENT_ID,
            target_version: 2,
            draft_version: 3,
            data: { text: "工作草稿里的文字", tags: ["草稿标签"], album_links: [] },
            images: [{ media_id: MEDIA_ID, position: 0, alt: "草稿替代文本" }],
          }),
          reused: true,
        },
      },
      { match: MEDIA_DETAIL_ROUTE, body: makeMedia() },
    ]);
    const view = render(
      <MomentEditor
        {...baseProps({
          targetId: MOMENT_ID,
          targetStatus: "draft",
          targetVersion: 2,
          initialData: { text: "正式内容", tags: [], album_links: [] },
          initialImages: [{ media_id: MEDIA_ID, alt: "正式替代文本" }],
        })}
      />,
    );
    await advance(120);

    expect(getTextarea(view.container).value).toBe("工作草稿里的文字");
    expect(view.container.querySelector<HTMLInputElement>("[data-editor-tags]")?.value).toBe("草稿标签");
    expect(view.container.querySelector("[data-editor-status]")?.getAttribute("data-editor-status")).toBe("draft");
    expect(buttonBy(view.container, "[data-editor-save]")?.getAttribute("data-editor-submit-action")).toBe("save");
    expect(buttonBy(view.container, "[data-editor-publish]")).not.toBeNull();
    view.unmount();
  });

  it("已发布动态：只有「更新正式内容」（commit update，带正式内容版本），没有发布按钮", async () => {
    stub = stubFetch([
      { match: COMMIT_ROUTE, method: "POST", body: commitResultBody({ action: "update", status: "published", target_version: 3, visibility: "public" }) },
      {
        match: CREATE_ROUTE.match,
        method: "POST",
        body: {
          draft: workDraftBody({
            target_id: MOMENT_ID,
            target_version: 2,
            data: { text: "已发布的文字", tags: [], album_links: [] },
            images: [{ media_id: MEDIA_ID, position: 0, alt: "操场" }],
          }),
          reused: true,
        },
      },
      { match: MEDIA_DETAIL_ROUTE, body: makeMedia() },
    ]);
    const view = render(
      <MomentEditor
        {...baseProps({
          targetId: MOMENT_ID,
          targetStatus: "published",
          targetVersion: 2,
          initialData: { text: "已发布的文字", tags: [], album_links: [] },
          initialImages: [{ media_id: MEDIA_ID, alt: "操场" }],
        })}
      />,
    );
    await advance(120);

    const saveButton = buttonBy(view.container, "[data-editor-save]");
    expect(saveButton?.getAttribute("data-editor-submit-action")).toBe("update");
    expect(saveButton?.textContent).toBe("更新正式内容");
    expect(view.container.querySelector("[data-editor-status]")?.getAttribute("data-editor-status")).toBe("published");
    expect(buttonBy(view.container, "[data-editor-publish]")).toBeNull();

    click(saveButton);
    await advance(200);
    const commit = stub.requests.find((request) => request.method === "POST" && COMMIT_ROUTE.test(request.url));
    expect((commit?.body as Record<string, unknown>)?.action).toBe("update");
    expect((commit?.body as Record<string, unknown>)?.expected_target_version).toBe(2);
    expect(view.container.querySelector("[data-editor-success]")?.textContent).toContain("已更新正式内容");
    view.unmount();
  });
});

describe("MomentEditor · 返回上下文", () => {
  it("返回按钮用 returnTo（含手机上下文/筛选参数）replace 来源页", async () => {
    stub = stubFetch([{ ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } }]);
    const view = render(<MomentEditor {...baseProps()} />);
    await advance(40);
    click(buttonBy(view.container, "[data-editor-return]"));
    expect(nav.replace).toHaveBeenCalledWith(RETURN_TO);
    view.unmount();
  });

  it("非法 returnTo 回落到 /admin（不跳外部地址）", async () => {
    stub = stubFetch([{ ...CREATE_ROUTE, body: { draft: workDraftBody(), reused: false } }]);
    const view = render(
      <MomentEditor {...baseProps({ returnTo: "https://evil.example/x" })} />,
    );
    await advance(40);
    click(buttonBy(view.container, "[data-editor-return]"));
    expect(nav.replace).toHaveBeenCalledWith("/admin");
    view.unmount();
  });
});
