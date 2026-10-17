/**
 * 我的殿堂手机视图：第三轮把照片展区拆到生活图库后，旧手机深链的兼容转发
 * （任务书 §4.1 / §6.1、验收 §8.2 末行）。
 *
 * 覆盖：
 *  - `photos` / `album` 两个旧屏幕转发到 `/gallery`（保留目标相册），不是停在殿堂；
 *  - 非法相册 slug 退回图库首页，不把任意值拼进 URL；
 *  - 转发**不带 `intent`**：图库不是作品殿堂边界，不能触发异世界过场；
 *  - StrictMode 双挂载下只提交一次（不产生重复历史）。
 */

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PhoneHost } from "@/features/phone/types";

import { ShowcasePhoneView, legacyGalleryTarget } from "./phone-view";
import { advance, render, resetDocument } from "@/tests/helpers/render";

function makeHost() {
  const host = {
    openApp: vi.fn(),
    navigateScreen: vi.fn(),
    back: vi.fn(),
    close: vi.fn(),
    openSiteContent: vi.fn(),
    toast: vi.fn(),
    audio: {
      isPlaying: () => false,
      play: vi.fn(),
      pause: vi.fn(),
      setVolume: vi.fn(),
      getVolume: () => 0,
    },
    state: {
      get: <T,>(_appId: string, _key: string, fallback: T) => fallback,
      set: vi.fn(() => ({ persisted: true })),
      clear: vi.fn(),
    },
  };
  return host as unknown as PhoneHost & { openSiteContent: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  resetDocument();
});

describe("legacyGalleryTarget（旧手机照片 / 相册屏幕 → 生活图库）", () => {
  it("photos 屏幕转到图库首页", () => {
    expect(legacyGalleryTarget("photos", null)).toBe("/gallery");
    expect(legacyGalleryTarget("photos", "ignored")).toBe("/gallery");
  });

  it("album 屏幕保留目标相册（相册自己的排序）", () => {
    expect(legacyGalleryTarget("album", "tokyo-2026")).toBe(
      "/gallery?scope=album&album=tokyo-2026",
    );
  });

  it("相册 slug 非法 / 缺失时退回图库首页，不拼任意路径", () => {
    expect(legacyGalleryTarget("album", null)).toBe("/gallery");
    expect(legacyGalleryTarget("album", "../etc/passwd")).toBe("/gallery");
    expect(legacyGalleryTarget("album", "UPPER")).toBe("/gallery");
    expect(legacyGalleryTarget("album", "a/b")).toBe("/gallery");
  });

  it("作品屏幕不受影响（返回 null）", () => {
    expect(legacyGalleryTarget("projects", null)).toBeNull();
    expect(legacyGalleryTarget("project", "p5-blog")).toBeNull();
  });
});

describe("ShowcasePhoneView 旧照片屏幕", () => {
  it("album 深链通过宿主导航到图库的对应相册，且不传 intent", async () => {
    const host = makeHost();
    const { container, unmount } = render(
      <StrictMode>
        <ShowcasePhoneView screen="album" item="tokyo-2026" mode="compact" host={host} />
      </StrictMode>,
    );
    await advance(20);
    expect(host.openSiteContent).toHaveBeenCalledTimes(1);
    const request = host.openSiteContent.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.destination).toBe("/gallery?scope=album&album=tokyo-2026");
    expect(request.source).toBe("phone-link");
    // 图库不是殿堂边界：旧地址虽带 showcase，也不能显式声明进入殿堂的意图。
    expect("intent" in request).toBe(false);
    expect(container.querySelector("[data-legacy-gallery-forward]")).not.toBeNull();
    expect(container.textContent).toContain("生活图库");
    unmount();
  });

  it("photos 深链转到图库首页", async () => {
    const host = makeHost();
    const { unmount } = render(
      <ShowcasePhoneView screen="photos" item={null} mode="compact" host={host} />,
    );
    await advance(20);
    expect(host.openSiteContent).toHaveBeenCalledTimes(1);
    expect(host.openSiteContent.mock.calls[0]![0]).toEqual({
      destination: "/gallery",
      source: "phone-link",
    });
    unmount();
  });

  it("非法 album slug 的深链也落到图库（不显示殿堂的「不存在」错误页）", async () => {
    const host = makeHost();
    const { unmount } = render(
      <ShowcasePhoneView screen="album" item="../secret" mode="compact" host={host} />,
    );
    await advance(20);
    expect(host.openSiteContent).toHaveBeenCalledTimes(1);
    expect(host.openSiteContent.mock.calls[0]![0]).toEqual({
      destination: "/gallery",
      source: "phone-link",
    });
    unmount();
  });
});
