/**
 * 照片墙视图（T06；验收 4「不新增 body 锁或音频」、验收 6「加载更多 / 失败态」）。
 *
 * 覆盖：
 *  - 首屏由 props 渲染（服务端已经读过，客户端不重复请求）；
 *  - 「加载更多」带上正确的 scope / 筛选 / 游标，并把结果**追加**；
 *  - 加载失败给出可读原因与重试；
 *  - 空态不编造张数；
 *  - 按相册分组保持服务端顺序；
 *  - 打开灯箱 / 关闭时把焦点还给原图格；
 *  - **不新增 `<audio>`、不加 `ov-lock`**（滚动锁只由 OverlayManager 管）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GalleryView } from "./gallery-view";
import { makeApiAlbum, makeApiWallPhoto, MEDIA_IDS, stubFetch, type FetchStub } from "./test-support";
import type { AlbumSummary, WallPhoto } from "./types";
import { advance, click, key, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

function wallPhoto(overrides: Record<string, unknown> = {}): WallPhoto {
  return makeApiWallPhoto(overrides) as unknown as WallPhoto;
}

function album(overrides: Record<string, unknown> = {}): AlbumSummary {
  return makeApiAlbum(overrides) as unknown as AlbumSummary;
}

const baseProps = {
  album: null,
  kind: null,
  year: null,
  albums: [album({ slug: "tokyo-2026", title: "东京 2026" })],
  years: [2026, 2025],
} as const;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("GalleryView", () => {
  it("首屏渲染服务端的照片，不发起任何请求", () => {
    stub = stubFetch([]);
    const photos = [
      wallPhoto({ photo: { media_id: MEDIA_IDS.A, alt: "第一张", position: 0 } }),
      wallPhoto({ photo: { media_id: MEDIA_IDS.B, alt: "第二张", position: 1 } }),
    ];
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        initialPhotos={photos}
        initialCursor={null}
        initialTotal={2}
      />,
    );
    expect(container.querySelectorAll(".photo-tile")).toHaveLength(2);
    expect(stub.requests).toHaveLength(0);
    expect(container.querySelector("[data-photo-total]")?.textContent).toContain("共 2 张照片");
    unmount();
  });

  it("「加载更多」带 scope/筛选/游标，并把结果追加在后面", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/gallery/photos",
        body: {
          items: [wallPhoto({ photo: { media_id: MEDIA_IDS.B, alt: "第二张", position: 1 } })],
          next_cursor: null,
          total: 2,
        },
      },
    ]);
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        kind="photo"
        year={2026}
        initialPhotos={[wallPhoto({ photo: { media_id: MEDIA_IDS.A, alt: "第一张" } })]}
        initialCursor="cursor-1"
        initialTotal={2}
      />,
    );
    click(container.querySelector("[data-load-more]"));
    await advance(30);
    expect(stub.requests).toHaveLength(1);
    const url = stub.requests[0]!.url;
    // 默认 scope 不写进查询串（服务端默认就是 global，少一个参数少一处漂移）。
    expect(url).not.toContain("scope=");
    expect(url).toContain("kind=photo");
    expect(url).toContain("year=2026");
    expect(url).toContain("cursor=cursor-1");
    expect(container.querySelectorAll(".photo-tile")).toHaveLength(2);
    expect(container.querySelector("[data-load-more]")).toBeNull();
    unmount();
  });

  it("加载更多失败时给出可读原因与重试按钮，已显示的照片不消失", async () => {
    stub = stubFetch([{ match: "/api/v1/gallery/photos", throws: true }]);
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        initialPhotos={[wallPhoto({ photo: { media_id: MEDIA_IDS.A, alt: "第一张" } })]}
        initialCursor="cursor-1"
        initialTotal={9}
      />,
    );
    click(container.querySelector("[data-load-more]"));
    await advance(400);
    expect(container.querySelectorAll(".photo-tile")).toHaveLength(1);
    expect(container.querySelector("[data-load-more-error]")).not.toBeNull();
    expect(container.textContent).toContain("连不上接口服务");
    unmount();
  });

  it("服务端读取失败时只显示失败态，不显示空态（两者含义不同）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        initialPhotos={[]}
        initialCursor={null}
        initialTotal={0}
        loadError="读取照片失败（HTTP 503）：上游不可用"
      />,
    );
    expect(container.querySelector("[data-gallery-error]")).not.toBeNull();
    expect(container.querySelector("[data-gallery-empty]")).toBeNull();
    expect(container.textContent).toContain("HTTP 503");
    unmount();
  });

  it("空态明确写「没有照片」且不编造张数", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <GalleryView {...baseProps} initialPhotos={[]} initialCursor={null} initialTotal={0} />,
    );
    expect(container.querySelector("[data-gallery-empty]")).not.toBeNull();
    expect(container.textContent).toContain("共 0 张照片");
    unmount();
  });

  it("按相册分组时保持服务端顺序，并显示相册标题", () => {
    stub = stubFetch([]);
    const photos = [
      wallPhoto({ photo: { media_id: MEDIA_IDS.A, alt: "A" }, album: { slug: "tokyo-2026", title: "东京 2026" } }),
      wallPhoto({ photo: { media_id: MEDIA_IDS.B, alt: "B" }, album: { slug: "screens", title: "游戏截图", kind_label: "游戏截图" } }),
    ];
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        initialPhotos={photos}
        initialCursor={null}
        initialTotal={2}
      />,
    );
    click(container.querySelector('[data-filter="group"]'));
    const groups = [...container.querySelectorAll("[data-photo-group]")];
    expect(groups.map((group) => group.getAttribute("data-photo-group"))).toEqual([
      "tokyo-2026",
      "screens",
    ]);
    expect(container.textContent).toContain("东京 2026");
    expect(container.textContent).toContain("游戏截图");
    unmount();
  });

  it("打开灯箱后 Escape 关闭，并把焦点还给原来的图格", async () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        initialPhotos={[
          wallPhoto({ photo: { media_id: MEDIA_IDS.A, alt: "第一张" } }),
          wallPhoto({ photo: { media_id: MEDIA_IDS.B, alt: "第二张" } }),
        ]}
        initialCursor={null}
        initialTotal={2}
      />,
    );
    const buttons = [...container.querySelectorAll("button.photo-tile-button")];
    expect(buttons).toHaveLength(2);
    click(buttons[1]!);
    await advance(20);
    const dialog = container.querySelector("[data-lightbox]") as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(container.querySelector(".plg-lightbox-counter")?.textContent).toContain("2 / 2");
    key(dialog, "Escape");
    await advance(20);
    expect(container.querySelector("[data-lightbox]")).toBeNull();
    expect(document.activeElement).toBe(buttons[1]);
    unmount();
  });

  it("不新增 <audio>、不加滚动锁类（音乐与滚动由宿主统一管）", async () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <GalleryView
        {...baseProps}
        initialPhotos={[wallPhoto({ photo: { media_id: MEDIA_IDS.A, alt: "第一张" } })]}
        initialCursor={null}
        initialTotal={1}
      />,
    );
    click(container.querySelector("button.photo-tile-button"));
    await advance(20);
    expect(container.querySelector("[data-lightbox]")).not.toBeNull();
    expect(document.querySelectorAll("audio")).toHaveLength(0);
    expect(document.documentElement.className).not.toContain("ov-lock");
    unmount();
  });

  it("筛选链接指向带查询串的独立页地址（可分享 / 刷新 / Back）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <GalleryView {...baseProps} initialPhotos={[]} initialCursor={null} initialTotal={0} />,
    );
    const tokyo = container.querySelector('[data-filter="album-tokyo-2026"]');
    expect(tokyo?.getAttribute("href")).toBe("/gallery?scope=album&album=tokyo-2026");
    const all = container.querySelector('[data-filter="album-all"]');
    expect(all?.getAttribute("href")).toBe("/gallery");
    const year2026 = container.querySelector('[data-filter="year-2026"]');
    expect(year2026?.getAttribute("href")).toContain("year=2026");
    unmount();
  });
});
