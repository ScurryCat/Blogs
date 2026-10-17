/**
 * 生活图库 · 相册视图（`/gallery?view=albums`，第三轮任务书 §4.1）。
 *
 * 覆盖：
 *  - 首屏由服务端 props 渲染，不发请求（不出现「空转一圈再渲染」）；
 *  - 空态不编造相册、不填占位封面；失败态与空态**分开表达**；
 *  - 「加载更多相册」带游标与类型筛选，并把结果追加在后面；
 *  - 相册卡片点进 `/gallery?scope=album&album=<slug>`（相册自己的排序）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AlbumGallery } from "./album-gallery";
import { makeApiAlbum, stubFetch, type FetchStub } from "./test-support";
import type { AlbumSummary } from "./types";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

function album(overrides: Record<string, unknown> = {}): AlbumSummary {
  return makeApiAlbum(overrides) as unknown as AlbumSummary;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("AlbumGallery", () => {
  it("首屏渲染服务端给的相册，不发起任何请求", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <AlbumGallery
        initialAlbums={[
          album({ id: "a-1", slug: "tokyo-2026", title: "东京 2026" }),
          album({ id: "a-2", slug: "screens", title: "游戏截图", kind: "screenshot" }),
        ]}
        initialCursor={null}
      />,
    );
    const cards = [...container.querySelectorAll("[data-album]")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.getAttribute("href")).toBe("/gallery?scope=album&album=tokyo-2026");
    expect(container.textContent).toContain("东京 2026");
    expect(container.textContent).toContain("共 2 个相册");
    expect(stub.requests).toHaveLength(0);
    unmount();
  });

  it("空态明确写「还没有公开的相册」，不显示占位卡", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <AlbumGallery initialAlbums={[]} initialCursor={null} />,
    );
    expect(container.querySelector("[data-gallery-albums-empty]")).not.toBeNull();
    expect(container.querySelector("[data-album]")).toBeNull();
    expect(container.textContent).toContain("还没有公开的相册");
    unmount();
  });

  it("服务端读取失败时只显示失败态（与空态含义不同）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <AlbumGallery
        initialAlbums={[]}
        initialCursor={null}
        loadError="读取图库失败（HTTP 503）：上游不可用"
      />,
    );
    expect(container.querySelector("[data-gallery-albums-error]")).not.toBeNull();
    expect(container.querySelector("[data-gallery-albums-empty]")).toBeNull();
    expect(container.textContent).toContain("HTTP 503");
    unmount();
  });

  it("「加载更多相册」带游标与类型筛选，并把结果追加在后面", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/gallery/albums",
        body: {
          items: [album({ id: "a-2", slug: "screens", title: "游戏截图", kind: "screenshot" })],
          next_cursor: null,
        },
      },
    ]);
    const { container, unmount } = render(
      <AlbumGallery
        initialAlbums={[album({ id: "a-1", slug: "tokyo-2026", title: "东京 2026" })]}
        initialCursor="cursor-1"
        kind="screenshot"
      />,
    );
    click(container.querySelector("[data-load-more-albums]"));
    await advance(30);
    expect(stub.requests).toHaveLength(1);
    const url = stub.requests[0]!.url;
    expect(url).toContain("cursor=cursor-1");
    expect(url).toContain("kind=screenshot");
    expect(container.querySelectorAll("[data-album]")).toHaveLength(2);
    expect(container.querySelector("[data-load-more-albums]")).toBeNull();
    expect(container.textContent).toContain("共 2 个相册");
    unmount();
  });

  it("加载更多失败时给出可读原因与重试，已显示的相册不消失", async () => {
    stub = stubFetch([{ match: "/api/v1/gallery/albums", throws: true }]);
    const { container, unmount } = render(
      <AlbumGallery
        initialAlbums={[album({ id: "a-1", slug: "tokyo-2026" })]}
        initialCursor="cursor-1"
      />,
    );
    click(container.querySelector("[data-load-more-albums]"));
    await advance(400);
    expect(container.querySelectorAll("[data-album]")).toHaveLength(1);
    expect(container.querySelector("[data-load-more-albums-error]")).not.toBeNull();
    expect(container.textContent).toContain("连不上接口服务");
    unmount();
  });
});
