/**
 * 共享图片选择器行为（P5 第一批 · C3；契约 §4.3 / §6 A11）。
 *
 * 断言的是**真实 HTTP 交互 + 用户可见结果**：
 *  - 分页浏览 / 加载更多 / 翻页后已选不丢；
 *  - 选择顺序 / 上移下移 / 移除 / 逐图替代文本；
 *  - 超上限禁用、公开引用提示、HEIC 明确提示（不发请求）；
 *  - 上传带 `X-CSRF-Token` 头，失败保留已选、不显示虚假成功；
 *  - 关闭不丢已确认选择（只有「确定」才回写）；
 *  - 已选图片不在当前列表页时按 ID 补取详情，只有 404 才算不可用。
 *
 * 不 mock 共享 API 客户端：错误信封解析、读重试、写不重试仍走真实代码。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next/navigation` 在本组件里没有用到，但共享测试辅助里的页面壳不需要它；
// 这里保持与仓库其它客户端组件测试一致的显式替身，避免未来加链接时突然抛错。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/admin/moments/new",
  useSearchParams: () => new URLSearchParams(""),
}));

import { MediaPickerDialog } from "./media-picker-dialog";
import { PUBLIC_REFERENCE_WARNING, type MediaPickerMedia, type PickedImage } from "./types";
import { stubFetch, type FetchStub } from "@/features/ins/test-support";
import { advance, click, key, render, resetDocument } from "@/tests/helpers/render";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UPLOADED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function makeMedia(id: string, overrides: Record<string, unknown> = {}): MediaPickerMedia {
  return {
    id,
    mime_type: "image/png",
    bytes: 1234,
    width: 800,
    height: 600,
    sha256: "hash",
    status: "ready",
    created_at: "2026-10-18T00:00:00Z",
    original_url: `/api/v1/media/${id}/original`,
    variants: [
      { name: "w320.webp", width: 320, height: 240, bytes: 10, url: `/api/v1/media/${id}/w320.webp` },
      { name: "w640.webp", width: 640, height: 480, bytes: 20, url: `/api/v1/media/${id}/w640.webp` },
    ],
    ...overrides,
  };
}

function picked(media: MediaPickerMedia, alt = ""): PickedImage {
  return { media_id: media.id, alt, media };
}

function page(items: unknown[], nextCursor: string | null = null) {
  return { items, next_cursor: nextCursor };
}

function errorBody(message: string, code = "SERVICE_UNAVAILABLE") {
  return { error: { code, message, fields: {} }, request_id: "stub" };
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

interface SetupOptions {
  selected?: PickedImage[];
  max?: number;
  allowUpload?: boolean;
  csrfToken?: string;
}

function setup(options: SetupOptions = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <MediaPickerDialog
      open
      csrfToken={options.csrfToken ?? "csrf-token"}
      selected={options.selected ?? []}
      onConfirm={onConfirm}
      onClose={onClose}
      max={options.max}
      allowUpload={options.allowUpload}
    />,
  );
  return { view, onConfirm, onClose };
}

function itemButton(container: HTMLElement, id: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    `[data-media-picker-item][data-media-id="${id}"]`,
  );
}

function pickedIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-media-picker-picked]")].map(
    (element) => element.dataset.mediaId ?? "",
  );
}

function altInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>("[data-media-picker-alt]")];
}

async function typeValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pickFiles(input: HTMLInputElement, files: File[]): Promise<void> {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("[data-media-picker-upload]");
  if (!input) throw new Error("缺少上传输入框");
  return input;
}

describe("MediaPickerDialog · 媒体库分页与选择", () => {
  it("分页浏览：加载更多按 ID 去重，已选不因翻页丢失，确定时按选择顺序回写", async () => {
    stub = stubFetch([
      { match: "cursor=c1", body: page([makeMedia(A), makeMedia(B)]) },
      { match: "/admin/media?", body: page([makeMedia(A)], "c1") },
    ]);
    const { view, onConfirm, onClose } = setup();
    await advance(80);

    expect(view.container.querySelectorAll("[data-media-picker-item]")).toHaveLength(1);
    click(itemButton(view.container, A));
    await advance(10);

    click(view.container.querySelector('[data-media-picker-next]'));
    await advance(80);

    // 第二页里又有 A（分页边界可能重复）：列表里 A 只出现一次。
    expect(view.container.querySelectorAll("[data-media-picker-item]")).toHaveLength(2);
    expect(view.container.querySelector("[data-media-picker-next]")).toBeNull();
    // 已选 A 仍然存在（不是「翻页就没了」）。
    expect(itemButton(view.container, A)?.getAttribute("aria-pressed")).toBe("true");

    click(itemButton(view.container, B));
    await advance(10);
    click(view.container.querySelector("[data-media-picker-confirm]"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const next = onConfirm.mock.calls[0]?.[0] as PickedImage[];
    expect(next.map((image) => image.media_id)).toEqual([A, B]);
    expect(next.map((image) => image.position)).toEqual([0, 1]);
    expect(onClose).toHaveBeenCalled();
    view.unmount();
  });

  it("选择顺序可调整：上移/下移改变回写顺序，替代文本跟随图片", async () => {
    stub = stubFetch([
      { match: "/admin/media?", body: page([makeMedia(A), makeMedia(B), makeMedia(C)]) },
    ]);
    const { view, onConfirm } = setup();
    await advance(80);

    click(itemButton(view.container, A));
    await advance(10);
    click(itemButton(view.container, B));
    await advance(10);
    expect(pickedIds(view.container)).toEqual([A, B]);

    const alts = altInputs(view.container);
    await typeValue(alts[0] as HTMLInputElement, "操场");

    // 把 A（第 1 张）下移：顺序变成 B、A，替代文本跟着 A 走。
    const moveDown = view.container.querySelectorAll<HTMLButtonElement>("[data-media-picker-move-down]");
    click(moveDown[0] ?? null);
    await advance(10);
    expect(pickedIds(view.container)).toEqual([B, A]);

    click(view.container.querySelector("[data-media-picker-confirm]"));
    const next = onConfirm.mock.calls[0]?.[0] as PickedImage[];
    expect(next.map((image) => image.media_id)).toEqual([B, A]);
    expect(next.map((image) => image.alt)).toEqual(["", "操场"]);
    view.unmount();
  });

  it("移除已选：回写里不再包含这张", async () => {
    stub = stubFetch([
      { match: "/admin/media?", body: page([makeMedia(A), makeMedia(B)]) },
    ]);
    const { view, onConfirm } = setup({ selected: [picked(makeMedia(A), "旧图")] });
    await advance(80);

    click(itemButton(view.container, B));
    await advance(10);
    expect(pickedIds(view.container)).toEqual([A, B]);

    const removeButtons = view.container.querySelectorAll<HTMLButtonElement>(
      "[data-media-picker-remove]",
    );
    click(removeButtons[0] ?? null);
    await advance(10);
    expect(pickedIds(view.container)).toEqual([B]);

    click(view.container.querySelector("[data-media-picker-confirm]"));
    const next = onConfirm.mock.calls[0]?.[0] as PickedImage[];
    expect(next.map((image) => image.media_id)).toEqual([B]);
    view.unmount();
  });

  it("超过上限（9 张）：未选中的图片禁用，并说明已达上限", async () => {
    const nine = Array.from({ length: 9 }, (_, index) => {
      const id = `0000000${index}-0000-4000-8000-000000000000`;
      return picked(makeMedia(id));
    });
    stub = stubFetch([{ match: "/admin/media?", body: page([makeMedia(A)]) }]);
    const { view, onConfirm } = setup({ selected: nine });
    await advance(80);

    expect(view.container.textContent).toContain("已选满 9 张");
    const button = itemButton(view.container, A);
    expect(button?.disabled).toBe(true);
    click(button);
    await advance(10);
    expect(pickedIds(view.container)).toHaveLength(9);

    click(view.container.querySelector("[data-media-picker-confirm]"));
    expect((onConfirm.mock.calls[0]?.[0] as PickedImage[])).toHaveLength(9);
    view.unmount();
  });

  it("公开引用提示：显示「该图片已在其他位置公开」，但仍是可选操作", async () => {
    stub = stubFetch([
      { match: "/admin/media?", body: page([makeMedia(A, { publicly_referenced: true })]) },
    ]);
    const { view } = setup();
    await advance(80);

    expect(view.container.textContent).toContain("该图片已在其他位置公开");
    expect(view.container.textContent).toContain(PUBLIC_REFERENCE_WARNING);
    expect(view.container.querySelector("[data-media-picker-warning]")).not.toBeNull();
    expect(itemButton(view.container, A)?.disabled).toBe(false);
    view.unmount();
  });

  it("关闭不丢已选：取消不回写，重新打开从调用方的 selected 初始化", async () => {
    stub = stubFetch([
      { match: "/admin/media?", body: page([makeMedia(A), makeMedia(B)]) },
    ]);
    const first = setup({ selected: [picked(makeMedia(A), "旧图")] });
    await advance(80);
    click(itemButton(first.view.container, B));
    await advance(10);
    click(first.view.container.querySelector("[data-media-picker-cancel]"));
    expect(first.onConfirm).not.toHaveBeenCalled();
    expect(first.onClose).toHaveBeenCalled();
    first.view.unmount();

    // 调用方没有回写，所以重新打开时仍然只有 A。
    const second = setup({ selected: [picked(makeMedia(A), "旧图")] });
    await advance(80);
    expect(pickedIds(second.view.container)).toEqual([A]);
    click(second.view.container.querySelector("[data-media-picker-confirm]"));
    expect((second.onConfirm.mock.calls[0]?.[0] as PickedImage[]).map((image) => image.media_id)).toEqual([
      A,
    ]);
    second.view.unmount();
  });

  it("Escape 关闭选择器（只关当前层，不提交选择）", async () => {
    stub = stubFetch([{ match: "/admin/media?", body: page([]) }]);
    const { view, onConfirm, onClose } = setup();
    await advance(80);
    key(document, "Escape");
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe("MediaPickerDialog · 上传新图", () => {
  it("上传成功：POST /admin/media 带 X-CSRF-Token 头，ready 记录加入已选", async () => {
    stub = stubFetch([
      { match: "/admin/media", method: "POST", status: 201, body: makeMedia(UPLOADED) },
      { match: "/admin/media?", body: page([]) },
    ]);
    const { view, onConfirm } = setup();
    await advance(80);
    expect(view.container.textContent).toContain("媒体库还没有图片");

    await pickFiles(
      fileInput(view.container),
      [new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" })],
    );
    await advance(120);

    const upload = stub.requests.find((request) => request.method === "POST");
    expect(upload?.url).toContain("/admin/media");
    expect(upload?.headers["x-csrf-token"]).toBe("csrf-token");
    expect(pickedIds(view.container)).toEqual([UPLOADED]);
    expect(view.container.textContent).toContain("已上传 1 张图片");

    click(view.container.querySelector("[data-media-picker-confirm]"));
    const next = onConfirm.mock.calls[0]?.[0] as PickedImage[];
    expect(next[0]?.media_id).toBe(UPLOADED);
    // 不编造替代文本：新上传图片的 alt 默认空。
    expect(next[0]?.alt).toBe("");
    view.unmount();
  });

  it("上传失败（415）：保留已选、保留本地预览并显示真实原因，不假装成功", async () => {
    stub = stubFetch([
      {
        match: "/admin/media",
        method: "POST",
        status: 415,
        body: errorBody("不支持的媒体类型", "UNSUPPORTED_MEDIA_TYPE"),
      },
      { match: "/admin/media?", body: page([makeMedia(A)]) },
    ]);
    const { view, onConfirm } = setup({ selected: [picked(makeMedia(A), "旧图")] });
    await advance(80);

    await pickFiles(
      fileInput(view.container),
      [new File([new Uint8Array([1])], "photo.png", { type: "image/png" })],
    );
    await advance(120);

    expect(view.container.textContent).toContain("没有上传成功");
    expect(view.container.textContent).toContain("本地预览 · 尚未上传");
    expect(view.container.textContent).toContain("图片格式不支持");
    // 已选图片没有丢，失败的网络图片没有被当成成功。
    expect(pickedIds(view.container)).toEqual([A]);

    click(view.container.querySelector("[data-media-picker-confirm]"));
    expect((onConfirm.mock.calls[0]?.[0] as PickedImage[]).map((image) => image.media_id)).toEqual([A]);
    view.unmount();
  });

  it("HEIC：明确提示、不承诺自动转换、不发上传请求", async () => {
    stub = stubFetch([{ match: "/admin/media?", body: page([]) }]);
    const { view } = setup();
    await advance(80);

    await pickFiles(
      fileInput(view.container),
      [new File([new Uint8Array([1])], "IMG_0001.HEIC", { type: "image/heic" })],
    );
    await advance(80);

    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(view.container.textContent).toContain("HEIC");
    expect(view.container.textContent).toContain("不会自动转换");
    expect(view.container.textContent).toContain("本地预览 · 尚未上传");
    expect(pickedIds(view.container)).toEqual([]);
    view.unmount();
  });
});

describe("MediaPickerDialog · 已选不在当前页 / 读取失败", () => {
  it("已选图片不在当前列表页：按 ID 补取详情，不误判为失效", async () => {
    stub = stubFetch([
      { match: /\/admin\/media\/[0-9a-f-]{36}$/, body: makeMedia(A) },
      { match: "/admin/media?", body: page([makeMedia(B)]) },
    ]);
    const { view, onConfirm } = setup({ selected: [{ media_id: A, alt: "旧图" }] });
    await advance(160);

    const pickedItem = view.container.querySelector("[data-media-picker-picked]");
    expect(pickedItem?.textContent).toContain("800×600");
    expect(view.container.textContent).not.toContain("已不可用");

    click(view.container.querySelector("[data-media-picker-confirm]"));
    const next = onConfirm.mock.calls[0]?.[0] as PickedImage[];
    expect(next[0]?.media_id).toBe(A);
    expect(next[0]?.media?.id).toBe(A);
    view.unmount();
  });

  it("补取详情 404：明确「已不可用」但保留在已选里，让站主自己移除", async () => {
    stub = stubFetch([
      {
        match: /\/admin\/media\/[0-9a-f-]{36}$/,
        status: 404,
        body: errorBody("不存在", "NOT_FOUND"),
      },
      { match: "/admin/media?", body: page([]) },
    ]);
    const { view } = setup({ selected: [{ media_id: A, alt: "旧图" }] });
    await advance(160);

    expect(view.container.textContent).toContain("已不可用");
    expect(pickedIds(view.container)).toEqual([A]);
    expect(view.container.textContent).toContain("请移除它再保存");
    view.unmount();
  });

  it("媒体库读取失败：显示原因与重试，不清空已选；重试会重新请求", async () => {
    stub = stubFetch([
      {
        match: "/admin/media?",
        status: 503,
        body: errorBody("服务暂时不可用"),
      },
    ]);
    const { view } = setup({ selected: [picked(makeMedia(A), "旧图")] });
    await advance(80);

    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("服务暂时不可用");
    expect(pickedIds(view.container)).toEqual([A]);

    const before = stub.requests.filter((request) => request.url.includes("/admin/media?")).length;
    click(view.container.querySelector("[data-media-picker-retry]"));
    await advance(120);
    const after = stub.requests.filter((request) => request.url.includes("/admin/media?")).length;
    expect(after).toBeGreaterThan(before);
    view.unmount();
  });

  it("加载更多失败：保留已读到的内容，只说明追加失败", async () => {
    stub = stubFetch([
      { match: "cursor=c1", status: 503, body: errorBody("服务暂时不可用") },
      { match: "/admin/media?", body: page([makeMedia(A)], "c1") },
    ]);
    const { view } = setup();
    await advance(80);
    expect(view.container.querySelectorAll("[data-media-picker-item]")).toHaveLength(1);

    click(view.container.querySelector("[data-media-picker-next]"));
    await advance(120);
    expect(view.container.querySelectorAll("[data-media-picker-item]")).toHaveLength(1);
    expect(view.container.textContent).toContain("服务暂时不可用");
    view.unmount();
  });
});
