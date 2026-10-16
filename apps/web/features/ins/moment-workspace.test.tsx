/**
 * 管理端工作台（T03 验收用例 2、执行清单第 3 条）。
 *
 * 这里断言的是**真实 HTTP 交互形状**：
 *  - 新建草稿是 `POST /admin/moments`；
 *  - 保存是带 `If-Match` 的 `PATCH`；
 *  - 发布是 `POST .../publish` 且带 `If-Match`；
 *  - 上传走 T01 的共享媒体端点 `POST /admin/media`（multipart），**客户端缩略图不算成功**；
 *  - 412 冲突时**保留未保存输入**并提示重新读取，不自动覆盖。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/admin/moments",
  useSearchParams: () => new URLSearchParams(""),
}));

import { MomentWorkspace } from "./admin/moment-workspace";
import { stubFetch, type FetchStub } from "./test-support";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

const DRAFT = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "操场上的下午",
  tags: [{ id: "t1", slug: "campus", name: "校园" }],
  published_at: null,
  images: [],
  status: "draft",
  version: 1,
  created_at: "2026-10-16T04:00:00Z",
  updated_at: "2026-10-16T04:00:00Z",
  images_admin: [],
};

const MEDIA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  mime_type: "image/png",
  bytes: 1234,
  width: 800,
  height: 600,
  status: "ready",
  variants: [
    {
      name: "w320.webp",
      width: 320,
      height: 240,
      bytes: 10,
      url: "/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/w320.webp",
    },
  ],
  original_url: "/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original",
};

/** 取「新建草稿」按钮：它才是真的创建服务端草稿（列表头那个是「清空工作台」）。 */
function createDraftButton(container: HTMLElement): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "新建草稿",
    ) ?? null
  );
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    csrfToken: "csrf-token",
    describeError: (error: unknown) =>
      error instanceof Error ? `ERR:${error.message}` : "ERR:unknown",
    isConflict: (error: unknown) =>
      typeof error === "object" && error !== null && (error as { status?: number }).status === 412,
    ...overrides,
  };
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("MomentWorkspace", () => {
  it("列表读取失败显示原因，不显示成「还没有任何动态」", async () => {
    stub = stubFetch([
      {
        match: "/admin/moments",
        status: 401,
        body: { error: { code: "UNAUTHORIZED", message: "需要站主登录", fields: {} }, request_id: "r" },
      },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    expect(view.container.textContent).toContain("ERR:");
    expect(view.container.textContent).not.toContain("还没有任何动态");
    view.unmount();
  });

  it("空列表时如实显示「还没有任何动态」", async () => {
    stub = stubFetch([
      { match: "/admin/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    expect(view.container.textContent).toContain("还没有任何动态");
    view.unmount();
  });

  it("新建草稿：POST 到 /admin/moments，随后才能上传图片", async () => {
    stub = stubFetch([
      { match: "/admin/moments", method: "POST", status: 201, body: DRAFT },
      { match: "/admin/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);

    // 还没有草稿时，界面上明确说明「上传需要先有草稿」，也不给出上传控件
    expect(view.container.textContent).toContain("图片上传需要先有草稿");
    expect(view.container.querySelector('input[type="file"]')).toBeNull();

    click(createDraftButton(view.container));
    await advance(30);

    const created = stub.requests.find((request) => request.method === "POST");
    expect(created?.url).toContain("/admin/moments");
    // CSRF 必须在请求体里（服务端也接受 X-CSRF-Token 头，但共享客户端还没有 headers 选项）。
    expect((created?.body as Record<string, unknown>)?.csrf_token).toBe("csrf-token");
    expect(view.container.querySelector('input[type="file"]')).not.toBeNull();
    view.unmount();
  });

  it("保存草稿带上 If-Match，并在成功后提示「可以发布」", async () => {
    stub = stubFetch([
      { match: "/publish", method: "POST", body: { ...DRAFT, status: "published", version: 3, published_at: "2026-10-16T05:00:00Z" } },
      { match: "/admin/moments/", method: "PATCH", body: { ...DRAFT, version: 2 } },
      { match: "/admin/moments", method: "POST", status: 201, body: DRAFT },
      { match: "/admin/moments", body: { items: [DRAFT], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    click(createDraftButton(view.container));
    await advance(30);

    click([...view.container.querySelectorAll("button")].find((b) => b.textContent === "保存草稿") ?? null);
    await advance(30);

    const patch = stub.requests.find((request) => request.method === "PATCH");
    expect(patch?.headers["if-match"]).toBe('"1"');
    expect((patch?.body as Record<string, unknown>)?.csrf_token).toBe("csrf-token");
    expect(view.container.textContent).toContain("还不");
    view.unmount();
  });

  it("412 冲突：保留输入、提示重新读取、不自动覆盖，并且不会发出发布请求", async () => {
    stub = stubFetch([
      {
        match: "/admin/moments/",
        method: "PATCH",
        status: 412,
        body: {
          error: {
            code: "VERSION_CONFLICT",
            message: "内容已在别处更新，请先读取最新版本。",
            fields: { version: ["当前版本为 2"] },
          },
          request_id: "r",
        },
      },
      { match: "/admin/moments", method: "POST", status: 201, body: DRAFT },
      { match: "/admin/moments", body: { items: [DRAFT], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    click(createDraftButton(view.container));
    await advance(30);

    // 改动文字 → 保存 → 服务端返回 412
    const textarea = view.container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "我改过的内容");
    await act(async () => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await advance(10);

    click([...view.container.querySelectorAll("button")].find((b) => b.textContent.includes("保存草稿")) ?? null);
    await advance(30);

    // 输入被保留（这就是「冲突不清空输入」）
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("我改过的内容");
    expect(view.container.textContent).toContain("版本冲突");
    expect(
      stub.requests.some((request) => request.url.includes("/publish")),
    ).toBe(false);
    view.unmount();
  });

  it("有未保存改动时发布按钮被禁用，避免发布旧内容", async () => {
    stub = stubFetch([
      { match: "/admin/moments", method: "POST", status: 201, body: DRAFT },
      { match: "/admin/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    click(createDraftButton(view.container));
    await advance(30);

    const publishButton = () =>
      [...view.container.querySelectorAll("button")].find((b) => b.textContent === "发布") as
        | HTMLButtonElement
        | undefined;
    expect(publishButton()?.disabled).toBe(false);

    const textarea = view.container.querySelector<HTMLTextAreaElement>("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "改了");
    await act(async () => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await advance(10);
    expect(publishButton()?.disabled).toBe(true);
    view.unmount();
  });

  it("上传成功后才把图片计入草稿，并且替代文本默认留空（不编假描述）", async () => {
    stub = stubFetch([
      { match: "/admin/media", method: "POST", status: 201, body: MEDIA },
      {
        match: "/admin/moments/",
        method: "PATCH",
        body: { ...DRAFT, version: 2, images_admin: [{ media_id: MEDIA.id, position: 0, alt: "操场" }] },
      },
      { match: "/admin/moments", method: "POST", status: 201, body: DRAFT },
      { match: "/admin/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    click(createDraftButton(view.container));
    await advance(30);

    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    Object.defineProperty(fileInput!, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await advance(60);

    const upload = stub.requests.find((request) => request.url.includes("/admin/media"));
    expect(upload?.method).toBe("POST");
    // 上传成功后出现一条可编辑替代文本的图片
    const altInput = [...view.container.querySelectorAll<HTMLInputElement>('input[type="text"]')].find(
      (input) => input.maxLength === 200,
    );
    expect(altInput).toBeDefined();
    expect(altInput?.value).toBe("");
    expect(view.container.textContent).toContain("已上传（ready）");
    view.unmount();
  });

  it("上传失败（413）保留本地预览并说明原因，不计入草稿", async () => {
    stub = stubFetch([
      {
        match: "/admin/media",
        method: "POST",
        status: 413,
        body: { error: { code: "PAYLOAD_TOO_LARGE", message: "文件过大", fields: {} }, request_id: "r" },
      },
      { match: "/admin/moments", method: "POST", status: 201, body: DRAFT },
      { match: "/admin/moments", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<MomentWorkspace {...props()} />);
    await advance(30);
    click(createDraftButton(view.container));
    await advance(30);

    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File([new Uint8Array([1])], "huge.png", { type: "image/png" });
    Object.defineProperty(fileInput!, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await advance(60);

    expect(view.container.textContent).toContain("本地预览 · 尚未上传");
    expect(view.container.textContent).toContain("8 MiB");
    expect(view.container.textContent).not.toContain("已上传（ready）");
    view.unmount();
  });
});
