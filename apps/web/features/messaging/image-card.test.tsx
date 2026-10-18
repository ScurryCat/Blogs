/**
 * IM 图片卡（B4 方案 A · Phase 1）前端行为。
 *
 * 断言的是安全与可用性，不是「看起来像」：
 *  - 图片卡不渲染成链接；`src` 用服务端给的 w640 变体地址；
 *  - `alt` 非空（取 alt，缺省用标题兜底），width/height 来自服务端；
 *  - 点击打开灯箱，Escape 关闭并把焦点还给触发按钮；
 *  - 图片加载失败时降级为文字说明（撤回/权限变化时不出现坏图）。
 */

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { OverlayProvider } from "@/features/runtime/overlay-manager";

import type { Card } from "./types";
import { ContentCardList } from "./content-card";
import { click, key, render, resetDocument } from "@/tests/helpers/render";

const ALBUM_PHOTO: Card = {
  kind: "album_photo",
  id: "tokyo-nights:0",
  title: "东京夜景的一张",
  summary: "东京夜景",
  url: "/api/v1/media/11111111-1111-4111-8111-111111111111/w640.webp",
  width: 640,
  height: 480,
  alt: "相册里的照片",
};

afterEach(() => {
  resetDocument();
});

describe("IM 图片卡", () => {
  it("渲染图片而不是站内链接，alt/宽高来自服务端", () => {
    const view = render(<ContentCardList cards={[ALBUM_PHOTO]} />);
    const img = view.container.querySelector<HTMLImageElement>("img.msg-photo-img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(ALBUM_PHOTO.url);
    expect(img?.getAttribute("alt")).toBe("相册里的照片");
    expect(img?.getAttribute("width")).toBe("640");
    expect(img?.getAttribute("height")).toBe("480");
    expect(img?.getAttribute("loading")).toBe("lazy");
    // 图片卡不是链接：不允许把图片变成可点击跳转（避免把图片当站内内容）。
    expect(view.container.querySelector("a")).toBeNull();
    view.unmount();
  });

  it("缺 alt 时用标题兜底，仍有非空替代文本", () => {
    const view = render(<ContentCardList cards={[{ ...ALBUM_PHOTO, alt: null }]} />);
    const img = view.container.querySelector<HTMLImageElement>("img.msg-photo-img");
    expect(img?.getAttribute("alt")).toBe("东京夜景的一张");
    view.unmount();
  });

  it("点击打开灯箱，Escape 关闭并把焦点还给触发按钮（经共享 OverlayManager）", () => {
    const view = render(
      <OverlayProvider>
        <ContentCardList cards={[ALBUM_PHOTO]} />
      </OverlayProvider>,
    );
    const trigger = view.container.querySelector<HTMLButtonElement>("button.msg-photo");
    expect(trigger).not.toBeNull();
    click(trigger);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.querySelector(".msg-photo-lightbox-img")?.getAttribute("alt")).toBe("相册里的照片");

    key(document, "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    view.unmount();
  });

  it("灯箱内图片请求失败时显示可读降级，且仍可关闭", () => {
    const view = render(
      <OverlayProvider>
        <ContentCardList cards={[ALBUM_PHOTO]} />
      </OverlayProvider>,
    );
    click(view.container.querySelector("button.msg-photo"));

    const lightboxImg = document.querySelector<HTMLImageElement>("img.msg-photo-lightbox-img");
    expect(lightboxImg).not.toBeNull();
    act(() => {
      lightboxImg?.dispatchEvent(new Event("error"));
    });

    expect(document.querySelector("img.msg-photo-lightbox-img")).toBeNull();
    expect(document.querySelector(".msg-photo-lightbox-fallback")?.textContent).toContain(
      "图片暂时不可用",
    );
    const closeButton = document.querySelector<HTMLButtonElement>(".msg-photo-lightbox-close");
    expect(closeButton).not.toBeNull();
    click(closeButton);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector("button.msg-photo"));
    view.unmount();
  });

  it("图片加载失败时降级为文字，不显示坏图", () => {
    const view = render(<ContentCardList cards={[ALBUM_PHOTO]} />);
    const img = view.container.querySelector<HTMLImageElement>("img.msg-photo-img");
    expect(img).not.toBeNull();
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(view.container.querySelector("img.msg-photo-img")).toBeNull();
    expect(view.container.textContent).toContain("图片暂时不可用");
    view.unmount();
  });
});
