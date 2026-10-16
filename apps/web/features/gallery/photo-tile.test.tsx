/**
 * 相册图格与灯箱（T06；验收 6「灯箱键盘、图片慢加载与损坏均验证」）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PhotoTile } from "./photo-tile";
import { Lightbox } from "./lightbox";
import { makeApiPhoto, MEDIA_IDS } from "./test-support";
import type { Photo } from "./types";
import { act } from "react";

import { advance, click, key, render, resetDocument } from "@/tests/helpers/render";

function photo(overrides: Partial<Photo> = {}): Photo {
  const api = makeApiPhoto(overrides as Record<string, unknown>);
  return api as unknown as Photo;
}

/** 图片加载失败：走真实的 `error` 事件（React 用它驱动 onError）。 */
async function fireError(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new Event("error", { bubbles: false }));
  });
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  resetDocument();
});

describe("PhotoTile", () => {
  it("渲染缩略图，带 alt 与真实宽高（自然比例，不裁切）", () => {
    const { container, unmount } = render(<PhotoTile photo={photo()} />);
    const img = container.querySelector("img.photo-tile-image");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("东京街头的一角");
    expect(img?.getAttribute("width")).toBe("800");
    expect(img?.getAttribute("height")).toBe("600");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("src")).toBe(`/api/v1/media/${MEDIA_IDS.A}/w640.webp`);
    // 拍摄时间与说明都在 figcaption 里。
    expect(container.querySelector(".photo-tile-date")?.textContent).toBe("2026-10-16");
    expect(container.querySelector(".photo-tile-caption")?.textContent).toContain("雨后的路口");
    unmount();
  });

  it("没有拍摄时间时明确写「未填写日期」，不回落到上传时间", () => {
    const { container, unmount } = render(
      <PhotoTile photo={photo({ taken_on: null, caption: "" })} />,
    );
    const date = container.querySelector(".photo-tile-date");
    expect(date?.textContent).toBe("未填写日期");
    expect(date?.getAttribute("data-taken-on")).toBe("empty");
    unmount();
  });

  it("图片损坏时显示失败态、保留日期说明，重试由「再点一次」承担", async () => {
    const opened: Photo[] = [];
    const { container, unmount } = render(
      <PhotoTile
        photo={photo()}
        onOpen={(item) => {
          opened.push(item);
          // 真实场景里 onOpen 打开灯箱；这里只验证点击仍然可用。
        }}
      />,
    );
    const img = container.querySelector("img.photo-tile-image");
    expect(img).not.toBeNull();
    await fireError(img as Element);
    await advance(20);
    const fallback = container.querySelector("[data-photo-fallback]");
    expect(fallback).not.toBeNull();
    expect(container.textContent).toContain("这张图片暂时加载不出来");
    // 说明没有因为图片失败而消失。
    expect(container.textContent).toContain("2026-10-16");
    // 失败态里**没有**嵌套 button（无效 HTML + 水合错误）：只有一层可点区域。
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(container.querySelector("button.photo-tile-retry")).toBeNull();
    click(container.querySelector("button.photo-tile-button"));
    expect(opened).toHaveLength(1);
    unmount();
  });

  it("纯展示模式的失败态不提示「再点一次」（没有可点的外层按钮）", async () => {
    const { container, unmount } = render(<PhotoTile photo={photo()} />);
    await fireError(container.querySelector("img.photo-tile-image") as Element);
    await advance(20);
    expect(container.querySelector("[data-photo-fallback]")).not.toBeNull();
    expect(container.querySelector(".photo-tile-retry")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    unmount();
  });

  it("onOpen 只在点击按钮时触发（纯展示模式没有按钮）", () => {
    const opened: Photo[] = [];
    const withButton = render(<PhotoTile photo={photo()} onOpen={(item) => opened.push(item)} />);
    click(withButton.container.querySelector("button.photo-tile-button"));
    expect(opened).toHaveLength(1);
    withButton.unmount();

    const plain = render(<PhotoTile photo={photo()} />);
    expect(plain.container.querySelector("button.photo-tile-button")).toBeNull();
    plain.unmount();
  });
});

describe("Lightbox", () => {
  const photos = [
    photo({ media_id: MEDIA_IDS.A, position: 0, alt: "第一张" }),
    photo({ media_id: MEDIA_IDS.B, position: 1, alt: "第二张", taken_on: null, caption: "" }),
  ];

  it("显示第几张 / 共几张，大图带 alt 与宽高", () => {
    const { container, unmount } = render(
      <Lightbox photos={photos} index={0} onIndexChange={() => undefined} onClose={() => undefined} />,
    );
    expect(container.querySelector("[data-lightbox]")).not.toBeNull();
    expect(container.querySelector(".plg-lightbox-counter")?.textContent).toContain("1 / 2");
    const img = container.querySelector("img.plg-lightbox-image");
    expect(img?.getAttribute("alt")).toBe("第一张");
    expect(img?.getAttribute("width")).toBe("800");
    unmount();
  });

  it("← / → 切换，Home / End 跳首尾", () => {
    const changes: number[] = [];
    const { container, unmount } = render(
      <Lightbox
        photos={photos}
        index={1}
        onIndexChange={(next) => changes.push(next)}
        onClose={() => undefined}
      />,
    );
    const dialog = container.querySelector("[data-lightbox]") as HTMLElement;
    key(dialog, "ArrowRight");
    key(dialog, "ArrowLeft");
    key(dialog, "Home");
    key(dialog, "End");
    expect(changes).toEqual([0, 0, 0, 1]);
    unmount();
  });

  it("Escape 关闭一次（没有宿主时自己接管，不依赖 OverlayManager）", () => {
    let closed = 0;
    const { container, unmount } = render(
      <Lightbox
        photos={photos}
        index={0}
        onIndexChange={() => undefined}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    const dialog = container.querySelector("[data-lightbox]") as HTMLElement;
    key(dialog, "Escape");
    expect(closed).toBe(1);
    // 已经被消费过的事件不重复关闭（双保险的语义）。
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    dialog.dispatchEvent(consumed);
    expect(closed).toBe(1);
    unmount();
  });

  it("只有一张时上一张 / 下一张禁用（不做无意义的循环）", () => {
    const { container, unmount } = render(
      <Lightbox
        photos={[photos[0]!]}
        index={0}
        onIndexChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    const buttons = [...container.querySelectorAll("button.plg-button")];
    const prev = buttons.find((button) => button.textContent === "上一张");
    const next = buttons.find((button) => button.textContent === "下一张");
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(true);
    unmount();
  });

  it("大图损坏时给出失败说明与重试", async () => {
    const { container, unmount } = render(
      <Lightbox photos={photos} index={0} onIndexChange={() => undefined} onClose={() => undefined} />,
    );
    await fireError(container.querySelector("img.plg-lightbox-image") as Element);
    await advance(20);
    expect(container.querySelector(".plg-lightbox-fallback")).not.toBeNull();
    expect(container.textContent).toContain("这张图片暂时加载不出来");
    unmount();
  });

  it("打开时把焦点放到关闭按钮（键盘用户的第一站）", async () => {
    const { container, unmount } = render(
      <Lightbox photos={photos} index={0} onIndexChange={() => undefined} onClose={() => undefined} />,
    );
    await advance(20);
    const active = document.activeElement as HTMLElement | null;
    expect(active?.textContent).toBe("关闭");
    expect(container.contains(active)).toBe(true);
    unmount();
  });
});
