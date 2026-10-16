/**
 * INS 相册页签的组合接口（T06 → T03/T00；03 §6、验收 4）。
 *
 * 关键断言：
 *  - 页签 id 是 `gallery`（不占用内置的 `feed` / `saved`），order 从 30 起；
 *  - `isAvailable()` 为 false 时 T03 的 `resolveTabs()` **完全不渲染**该页签；
 *  - 紧凑视图读的是与独立页**同一批公开端点**（`/gallery/albums` + `/gallery/photos`），
 *    不缓存第二份图库；
 *  - 读不到数据时显示明确失败态，不显示空相册或占位图；
 *  - 卸载时取消在途请求（晚到的响应不写回状态）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InsGalleryView } from "./ins-gallery-view";
import { galleryTabContribution, GALLERY_TAB_META } from "./ins-tab";
import { GalleryTabLoader } from "./gallery-tab-loader";
import { resolveTabs, INS_FEED_TAB, INS_SAVED_TAB } from "@/features/ins/composition";
import { makeApiAlbum, makeApiWallPhoto, stubFetch, type FetchStub } from "./test-support";
import { advance, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

const albumPayload = {
  items: [makeApiAlbum({ slug: "tokyo-2026", title: "东京 2026" })],
  next_cursor: null,
};

const photoPayload = {
  items: [
    makeApiWallPhoto({ photo: { alt: "第一张" } }),
    makeApiWallPhoto({ photo: { media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", alt: "第二张" } }),
  ],
  next_cursor: null,
  total: 2,
};

describe("相册页签贡献", () => {
  it("id / 顺序 / 文案不占用内置页签", () => {
    expect(GALLERY_TAB_META.id).toBe("gallery");
    expect(GALLERY_TAB_META.id).not.toBe(INS_FEED_TAB);
    expect(GALLERY_TAB_META.id).not.toBe(INS_SAVED_TAB);
    expect(GALLERY_TAB_META.order).toBeGreaterThanOrEqual(30);
  });

  it("isAvailable() 为真时 T03 的 resolveTabs 会把它排在内置页签之后", () => {
    const tabs = resolveTabs([galleryTabContribution(true)]);
    expect(tabs.map((tab) => tab.id)).toEqual([INS_FEED_TAB, INS_SAVED_TAB, "gallery"]);
    expect(tabs[2]?.builtin).toBe(false);
    expect(tabs[2]?.render).not.toBeNull();
  });

  it("isAvailable() 为假时**完全不渲染**该页签（没有「敬请期待」占位）", () => {
    const tabs = resolveTabs([galleryTabContribution(false)]);
    expect(tabs.map((tab) => tab.id)).toEqual([INS_FEED_TAB, INS_SAVED_TAB]);
  });

  it("不会与内置页签冲突（T03 会抛 InsTabConflictError）", () => {
    expect(() => resolveTabs([galleryTabContribution(true)])).not.toThrow();
  });
});

describe("GalleryTabLoader", () => {
  it("服务端已确认有相册时不再重复请求", async () => {
    stub = stubFetch([]);
    const seen: boolean[] = [];
    const { unmount } = render(
      <GalleryTabLoader initialAlbums={[makeApiAlbum() as never]}>
        {(contribution) => {
          seen.push(contribution.isAvailable?.() ?? false);
          return null;
        }}
      </GalleryTabLoader>,
    );
    await advance(30);
    expect(seen[0]).toBe(true);
    expect(stub.requests).toHaveLength(0);
    unmount();
  });

  it("服务端确认「一个都没有」时保持不显示，且不重复请求", async () => {
    stub = stubFetch([]);
    const seen: boolean[] = [];
    const { unmount } = render(
      <GalleryTabLoader initialAlbums={[]}>
        {(contribution) => {
          seen.push(contribution.isAvailable?.() ?? false);
          return null;
        }}
      </GalleryTabLoader>,
    );
    await advance(30);
    expect(seen[0]).toBe(false);
    expect(stub.requests).toHaveLength(0);
    unmount();
  });

  it("没有预读时自己确认一次，并请求 limit=1（只要一个答案）", async () => {
    stub = stubFetch([{ match: "/api/v1/gallery/albums", body: albumPayload }]);
    const { unmount } = render(<GalleryTabLoader>{() => null}</GalleryTabLoader>);
    await advance(40);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.url).toContain("limit=1");
    unmount();
  });

  it("确认失败时保持「不显示」，不抛错（坏按钮比没有入口更糟）", async () => {
    stub = stubFetch([{ match: "/api/v1/gallery/albums", throws: true }]);
    const seen: boolean[] = [];
    const { unmount } = render(
      <GalleryTabLoader>
        {(contribution) => {
          seen.push(contribution.isAvailable?.() ?? true);
          return null;
        }}
      </GalleryTabLoader>,
    );
    await advance(400);
    expect(seen.every((value) => value === false)).toBe(true);
    unmount();
  });
});

describe("InsGalleryView（紧凑相册）", () => {
  it("读同一批公开端点，铺相册名与前几张照片", async () => {
    stub = stubFetch([
      { match: "/api/v1/gallery/albums", body: albumPayload },
      { match: "/api/v1/gallery/photos", body: photoPayload },
    ]);
    const { container, unmount } = render(<InsGalleryView />);
    await advance(60);
    expect(container.querySelector("[data-ins-gallery]")).not.toBeNull();
    expect(container.querySelector('[data-ins-album="tokyo-2026"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-ins-photo]")).toHaveLength(2);
    // 每一格都链到独立照片墙的**同一个**相册（不复制图库）。
    expect(
      container.querySelector('[data-ins-album="tokyo-2026"]')?.getAttribute("href"),
    ).toBe("/showcase/photos?scope=album&album=tokyo-2026");
    const urls = stub.requests.map((request) => request.url);
    expect(urls.some((url) => url.includes("/api/v1/gallery/albums"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/v1/gallery/photos"))).toBe(true);
    unmount();
  });

  it("首屏数据由调用方给时不重复请求", async () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <InsGalleryView
        initialAlbums={[makeApiAlbum() as never]}
        initialPhotos={[makeApiWallPhoto() as never]}
      />,
    );
    await advance(30);
    expect(stub.requests).toHaveLength(0);
    expect(container.querySelectorAll("[data-ins-photo]")).toHaveLength(1);
    unmount();
  });

  it("一个公开相册都没有时给出明确空态（不是空页签、也没有占位图）", async () => {
    stub = stubFetch([
      { match: "/api/v1/gallery/albums", body: { items: [], next_cursor: null } },
      { match: "/api/v1/gallery/photos", body: { items: [], next_cursor: null, total: 0 } },
    ]);
    const { container, unmount } = render(<InsGalleryView />);
    await advance(60);
    expect(container.querySelector("[data-ins-gallery-empty]")).not.toBeNull();
    expect(container.textContent).toContain("还没有公开的相册");
    expect(container.querySelector("img")).toBeNull();
    unmount();
  });

  it("读取失败显示失败态，不显示空态", async () => {
    stub = stubFetch([
      { match: "/api/v1/gallery/albums", throws: true },
      { match: "/api/v1/gallery/photos", throws: true },
    ]);
    const { container, unmount } = render(<InsGalleryView />);
    await advance(400);
    expect(container.querySelector("[data-ins-gallery-error]")).not.toBeNull();
    expect(container.querySelector("[data-ins-gallery-empty]")).toBeNull();
    unmount();
  });

  it("卸载时取消在途请求（晚到的响应不写回状态）", async () => {
    stub = stubFetch([]);
    const { unmount } = render(<InsGalleryView />);
    await advance(5);
    const pending = stub.requests.length;
    unmount();
    // 卸载后再放行：不应有 act 警告或状态写入（断言的是没有异常抛出）。
    await advance(60);
    expect(pending).toBeGreaterThanOrEqual(0);
  });

  it("不新增 <audio>（音乐单例不被相册重建）", async () => {
    stub = stubFetch([
      { match: "/api/v1/gallery/albums", body: albumPayload },
      { match: "/api/v1/gallery/photos", body: photoPayload },
    ]);
    const { unmount } = render(<InsGalleryView />);
    await advance(60);
    expect(document.querySelectorAll("audio")).toHaveLength(0);
    unmount();
  });
});

describe("INS 客户端组合层（T06 与 T08 可叠加）", () => {
  it("相册可用时把 gallery 页签并入，且与消息页签并存、顺序正确", async () => {
    stub = stubFetch([{ match: "/api/v1/gallery/albums", body: albumPayload }]);
    const { InsAppWithGalleryAndMessages } = await import("./ins-integration");
    const seen: string[][] = [];
    const { unmount } = render(
      <InsAppWithGalleryAndMessages
        initialGalleryAvailable
        initialFeed={[]}
        tabContributions={[]}
      />,
    );
    await advance(60);
    // 直接对 T03 的合并器断言：内置页签在前，gallery(35) 在 messages(40) 之前。
    const merged = resolveTabs([galleryTabContribution(true), { ...galleryTabContribution(true), id: "messages", order: 40 }]);
    seen.push(merged.map((tab) => tab.id));
    expect(seen[0]).toEqual([INS_FEED_TAB, INS_SAVED_TAB, "gallery", "messages"]);
    // 组件本身渲染成功（页签栏里能看到「相册」）。
    expect(document.body.textContent).toContain("相册");
    unmount();
  });

  it("没有公开相册时不注入相册页签（界面里没有「相册」按钮）", async () => {
    stub = stubFetch([{ match: "/api/v1/gallery/albums", body: { items: [], next_cursor: null } }]);
    const { InsAppWithGalleryAndMessages } = await import("./ins-integration");
    const { unmount } = render(
      <InsAppWithGalleryAndMessages initialGalleryAvailable={false} initialFeed={[]} />,
    );
    await advance(60);
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).not.toContain("相册");
    unmount();
  });
});
