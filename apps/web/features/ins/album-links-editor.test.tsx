/**
 * 「同时收录到相册」编辑分区（第三轮 §4.2，N4b）。
 *
 * 断言的是**真实交互与请求**：
 *  - 相册列表来自管理端点 `/api/v1/admin/albums`（含草稿），失败如实显示并可重试；
 *  - 添加相册后逐张勾选本条动态的图片（可同图多相册），移除相册；
 *  - 草稿相册提示「已收录，待相册公开后展示」，不宣称已经展示；
 *  - 新建相册走现有相册管理页（新标签页），不在本组件里复制创建 / 发布流程；
 *  - 服务端返回的已删除相册显示为不可用并提供移除。
 */

import { act, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AdminAlbum } from "@/features/gallery/types";

import { AlbumLinksEditor, albumPublicHint } from "./admin/album-links-editor";
import type { UploadedImage } from "./admin/media-uploader";
import { stubFetch, type FetchStub } from "./test-support";
import type { MomentAlbumLink } from "./types";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

const MEDIA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEDIA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PUBLISHED_ALBUM = adminAlbum({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "tokyo-2026",
  title: "东京 2026",
  status: "published",
});

const DRAFT_ALBUM = adminAlbum({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "kyoto-2025",
  title: "京都 2025",
  status: "draft",
});

function adminAlbum(overrides: Partial<AdminAlbum>): AdminAlbum {
  return {
    id: "",
    slug: "",
    title: "",
    description: "",
    kind: "photo",
    kind_label: "摄影",
    position: 0,
    status: "published",
    published_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    version: 1,
    photo_count: 0,
    photos: [],
    ...overrides,
  } as AdminAlbum;
}

function uploaded(mediaId: string, alt: string): UploadedImage {
  return {
    mediaId,
    alt,
    upload: {
      id: mediaId,
      mime_type: "image/png",
      bytes: 1,
      width: 10,
      height: 10,
      status: "ready",
      variants: [],
      original_url: "",
    },
  };
}

const IMAGES = [uploaded(MEDIA_A, "操场"), uploaded(MEDIA_B, "走廊")];

function describeError(error: unknown): string {
  return error instanceof Error ? `ERR:${error.message}` : "ERR:unknown";
}

/** 受控容器：把 onChange 的结果渲染出来，便于断言「界面到底提交了什么选择」。 */
function Harness({
  images = IMAGES,
  initialLinks = [],
  disabled = false,
}: {
  images?: readonly UploadedImage[];
  initialLinks?: readonly MomentAlbumLink[];
  disabled?: boolean;
}): ReactNode {
  const [links, setLinks] = useState<MomentAlbumLink[]>([...initialLinks]);
  return (
    <>
      <AlbumLinksEditor
        images={images}
        links={links}
        onChange={setLinks}
        describeError={describeError}
        disabled={disabled}
      />
      <p data-state="">{JSON.stringify(links)}</p>
    </>
  );
}

function stateOf(container: HTMLElement): MomentAlbumLink[] {
  const text = container.querySelector("[data-state]")?.textContent ?? "[]";
  return JSON.parse(text) as MomentAlbumLink[];
}

function selectAlbum(container: HTMLElement, albumId: string): void {
  const select = container.querySelector<HTMLSelectElement>("[data-album-picker]");
  if (!select) throw new Error("相册下拉不存在");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, albumId);
  act(() => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === label,
    ) ?? null
  );
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("AlbumLinksEditor", () => {
  it("从管理端点读相册列表（含草稿），并区分「已公开 / 草稿」", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM, DRAFT_ALBUM], next_cursor: null } },
    ]);
    const view = render(<Harness />);
    await advance(40);
    const options = [...view.container.querySelectorAll<HTMLOptionElement>("[data-album-picker] option")];
    expect(options.map((option) => option.value)).toEqual([
      "",
      PUBLISHED_ALBUM.id,
      DRAFT_ALBUM.id,
    ]);
    expect(view.container.textContent).toContain("东京 2026（已公开）");
    expect(view.container.textContent).toContain("京都 2025（草稿）");
    expect(stub.requests[0]?.url).toContain("/api/v1/admin/albums");
    view.unmount();
  });

  it("添加相册 → 逐张勾选图片 → 移除相册（选择随 onChange 提交完整状态）", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM], next_cursor: null } },
    ]);
    const view = render(<Harness />);
    await advance(40);

    selectAlbum(view.container, PUBLISHED_ALBUM.id);
    click(button(view.container, "添加相册"));
    expect(stateOf(view.container)).toEqual([{ album_id: PUBLISHED_ALBUM.id, media_ids: [] }]);

    // 逐张勾选：第一张 → 第二张
    const boxes = [...view.container.querySelectorAll<HTMLInputElement>(".ins-admin-album-media input")];
    expect(boxes).toHaveLength(2);
    box1Click(boxes[0]!);
    box1Click(boxes[1]!);
    expect(stateOf(view.container)).toEqual([
      { album_id: PUBLISHED_ALBUM.id, media_ids: [MEDIA_A, MEDIA_B] },
    ]);
    expect(view.container.textContent).toContain("已选 2 张");

    // 取消勾选第一张
    box1Click(boxes[0]!);
    expect(stateOf(view.container)).toEqual([
      { album_id: PUBLISHED_ALBUM.id, media_ids: [MEDIA_B] },
    ]);

    click(button(view.container, "移除相册"));
    expect(stateOf(view.container)).toEqual([]);
    expect(view.container.querySelector("[data-album-links-empty]")).not.toBeNull();
    view.unmount();
  });

  it("同一张图可以收录到多个相册", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM, DRAFT_ALBUM], next_cursor: null } },
    ]);
    const view = render(<Harness />);
    await advance(40);

    selectAlbum(view.container, PUBLISHED_ALBUM.id);
    click(button(view.container, "添加相册"));
    box1Click(view.container.querySelectorAll<HTMLInputElement>(".ins-admin-album-media input")[0]!);

    // 已添加的相册不再出现在下拉选项里。
    selectAlbum(view.container, DRAFT_ALBUM.id);
    click(button(view.container, "添加相册"));
    const draftBoxes = [...view.container.querySelectorAll<HTMLInputElement>(
      '[data-album-link="kyoto-2025"] .ins-admin-album-media input',
    )];
    box1Click(draftBoxes[0]!);

    expect(stateOf(view.container)).toEqual([
      { album_id: PUBLISHED_ALBUM.id, media_ids: [MEDIA_A] },
      { album_id: DRAFT_ALBUM.id, media_ids: [MEDIA_A] },
    ]);
    view.unmount();
  });

  it("草稿相册提示「已收录，待相册公开后展示」，已公开相册说明要等动态发布", async () => {
    expect(albumPublicHint({ status: "draft" })).toContain("已收录，待相册公开后展示");
    expect(albumPublicHint({ status: "published" })).toContain("本条动态发布后");

    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM, DRAFT_ALBUM], next_cursor: null } },
    ]);
    const view = render(<Harness />);
    await advance(40);
    selectAlbum(view.container, DRAFT_ALBUM.id);
    click(button(view.container, "添加相册"));
    view.container
      .querySelectorAll<HTMLInputElement>(".ins-admin-album-media input")
      .forEach((box) => box1Click(box));
    await advance(10);

    expect(view.container.textContent).toContain("已收录，待相册公开后展示");
    expect(view.container.querySelector("[data-album-pending-note]")?.textContent).toContain(
      "草稿相册不会自动发布",
    );
    view.unmount();
  });

  it("服务端返回的已删除相册：显示不可用提示并可移除（不静默丢配置）", async () => {
    const missingId = "33333333-3333-4333-8333-333333333333";
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM], next_cursor: null } },
      {
        match: `/api/v1/admin/albums/${missingId}`,
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "not found", fields: {} }, request_id: "stub" },
      },
    ]);
    const view = render(<Harness initialLinks={[{ album_id: missingId, media_ids: [MEDIA_A] }]} />);
    await advance(80);
    expect(view.container.textContent).toContain("相册已不可用");
    expect(view.container.querySelector(".ins-admin-album.is-missing")).not.toBeNull();
    click(button(view.container, "移除相册"));
    expect(stateOf(view.container)).toEqual([]);
    view.unmount();
  });

  it("列表分页：后续页相册可选；列表外的已选相册走详情补取，不被误判为已删除", async () => {
    const laterAlbum = adminAlbum({
      id: "44444444-4444-4444-8444-444444444444",
      slug: "later-page",
      title: "后续页相册",
      status: "published",
    });
    const ghostAlbum = adminAlbum({
      id: "66666666-6666-4666-8666-666666666666",
      slug: "old-link",
      title: "被收录的旧相册",
      status: "draft",
    });
    stub = stubFetch([
      {
        match: "/api/v1/admin/albums?limit=50",
        body: { items: [PUBLISHED_ALBUM], next_cursor: "cursor-2" },
      },
      {
        match: "/api/v1/admin/albums?cursor=cursor-2",
        body: { items: [laterAlbum], next_cursor: null },
      },
      { match: `/api/v1/admin/albums/${ghostAlbum.id}`, body: ghostAlbum },
    ]);
    const view = render(<Harness initialLinks={[{ album_id: ghostAlbum.id, media_ids: [MEDIA_A] }]} />);
    await advance(120);

    // 两页都请求了
    const urls = stub.requests.map((request) => request.url);
    expect(urls.some((url) => url.includes("cursor=cursor-2"))).toBe(true);
    // 后续页的未选相册出现在下拉里（说明分页合并成功）
    const optionValues = [...view.container.querySelectorAll<HTMLOptionElement>("[data-album-picker] option")].map(
      (option) => option.value,
    );
    expect(optionValues).toContain(laterAlbum.id);
    // 列表外的已选目标通过详情补取回显，而不是「已不可用」
    expect(view.container.textContent).toContain("被收录的旧相册");
    expect(view.container.textContent).not.toContain("相册已不可用");
    expect(view.container.querySelector(".ins-admin-album.is-missing")).toBeNull();
    view.unmount();
  });

  it("已选相册详情读取失败（非 404）：如实显示读取失败，不当作已删除", async () => {
    const brokenId = "55555555-5555-4555-8555-555555555555";
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM], next_cursor: null } },
      {
        match: `/api/v1/admin/albums/${brokenId}`,
        status: 500,
        body: { error: { code: "INTERNAL", message: "boom", fields: {} }, request_id: "stub" },
      },
    ]);
    const view = render(<Harness initialLinks={[{ album_id: brokenId, media_ids: [MEDIA_A] }]} />);
    await advance(120);
    expect(view.container.textContent).toContain("相册状态读取失败");
    expect(view.container.textContent).toContain("这不代表相册已删除");
    expect(view.container.textContent).not.toContain("相册已不可用");
    view.unmount();
  });

  it("新建相册打开现有相册管理页（新标签页，当前动态草稿不受影响）", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [], next_cursor: null } },
    ]);
    const view = render(<Harness />);
    await advance(40);
    const link = view.container.querySelector<HTMLAnchorElement>("[data-album-admin-link]");
    expect(link?.getAttribute("href")).toBe("/admin/albums");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(view.container.textContent).toContain("不会自动发布");
    view.unmount();
  });

  it("相册列表读取失败如实显示原因并可重试", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/admin/albums",
        status: 500,
        body: { error: { code: "INTERNAL", message: "服务暂时不可用", fields: {} }, request_id: "r" },
      },
    ]);
    const view = render(<Harness />);
    await advance(40);
    expect(view.container.querySelector("[data-album-list-error]")).not.toBeNull();
    expect(view.container.textContent).toContain("ERR:");
    click(button(view.container, "重试"));
    await advance(40);
    expect(stub.requests.filter((request) => request.url.includes("/admin/albums"))).toHaveLength(2);
    view.unmount();
  });

  it("动态还没有图片时给出提示，且不渲染无法勾选的复选框", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM], next_cursor: null } },
    ]);
    const view = render(<Harness images={[]} />);
    await advance(40);
    expect(view.container.textContent).toContain("先上传图片");
    selectAlbum(view.container, PUBLISHED_ALBUM.id);
    click(button(view.container, "添加相册"));
    expect(view.container.querySelectorAll(".ins-admin-album-media input")).toHaveLength(0);
    view.unmount();
  });

  it("busy 时所有操作被禁用（避免保存途中改选择）", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/albums?limit=50", body: { items: [PUBLISHED_ALBUM], next_cursor: null } },
    ]);
    const view = render(<Harness disabled />);
    await advance(40);
    expect(view.container.querySelector<HTMLSelectElement>("[data-album-picker]")?.disabled).toBe(true);
    expect(button(view.container, "添加相册")?.disabled).toBe(true);
    expect(button(view.container, "刷新相册列表")?.disabled).toBe(true);
    view.unmount();
  });
});

/** jsdom 里 `element.click()` 会先切换 checked 再派发 click，React 的 onChange 才读得到新值。 */
function box1Click(input: HTMLInputElement): void {
  act(() => {
    input.click();
  });
}
