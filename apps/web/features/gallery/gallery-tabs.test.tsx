/**
 * 生活图库「照片墙 / 相册」切换（第三轮任务书 §4.1）。
 *
 * 断言的是**真实的站内链接**：视图属于 URL（可分享 / 刷新 / Back），
 * 不是组件内部 state；且切换链接不能让图库被误判成作品殿堂边界（不传 intent）。
 */

import { afterEach, describe, expect, it } from "vitest";

import { GalleryTabs } from "./gallery-tabs";
import { render, resetDocument } from "@/tests/helpers/render";

afterEach(() => {
  resetDocument();
});

describe("GalleryTabs", () => {
  it("照片墙是默认视图：根地址、当前页高亮", () => {
    const { container, unmount } = render(<GalleryTabs view="wall" />);
    const wall = container.querySelector('[data-gallery-tab="wall"]');
    const albums = container.querySelector('[data-gallery-tab="albums"]');
    expect(wall?.getAttribute("href")).toBe("/gallery");
    expect(wall?.getAttribute("aria-current")).toBe("page");
    expect(albums?.getAttribute("href")).toBe("/gallery?view=albums");
    expect(albums?.getAttribute("aria-current")).toBeNull();
    // 切换是站内链接，不是按钮（保留 href 才能新标签页 / 爬虫 / 刷新）。
    expect(wall?.tagName).toBe("A");
    expect(albums?.tagName).toBe("A");
    unmount();
  });

  it("相册视图高亮「相册」，照片墙链接回到根地址", () => {
    const { container, unmount } = render(<GalleryTabs view="albums" />);
    expect(
      container.querySelector('[data-gallery-tab="albums"]')?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      container.querySelector('[data-gallery-tab="wall"]')?.getAttribute("aria-current"),
    ).toBeNull();
    unmount();
  });

  it("切换链接不带导航意图（图库不是殿堂边界，不能触发异世界过场）", () => {
    const { container, unmount } = render(<GalleryTabs view="wall" />);
    for (const link of container.querySelectorAll("a")) {
      // 意图只能由协调器按目的地推导；这里不显式声明，也没有任何 data-intent 钩子。
      expect(link.getAttribute("data-intent")).toBeNull();
      expect(link.getAttribute("href")).not.toContain("intent");
    }
    unmount();
  });
});
