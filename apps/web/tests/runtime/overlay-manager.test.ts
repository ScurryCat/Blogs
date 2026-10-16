/**
 * 弹层管理器（02 §9）：Escape 只给最上面能处理的层、滚动锁按层数计数、退出时归还焦点。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCROLL_LOCK_CLASS, createOverlayManager } from "@/features/runtime/overlay-manager";

beforeEach(() => {
  document.documentElement.className = "";
});

describe("OverlayManager", () => {
  it("Escape 交给最上面那个声明了处理的层，只处理一层", () => {
    const manager = createOverlayManager();
    const bottom = vi.fn(() => true);
    const top = vi.fn(() => true);
    manager.push({ id: "poll", onEscape: bottom });
    manager.push({ id: "phone", onEscape: top });

    expect(manager.handleEscape()).toBe(true);
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it("没有处理函数的层不消费 Escape，也不挡住下面的层", () => {
    const manager = createOverlayManager();
    const handler = vi.fn(() => true);
    manager.push({ id: "phone", onEscape: handler });
    manager.push({ id: "image-preview" }); // 只锁滚动，不处理 Escape

    expect(manager.handleEscape()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("谁都不处理时返回 false（浏览器默认行为不受影响）", () => {
    const manager = createOverlayManager();
    manager.push({ id: "image-preview" });
    expect(manager.handleEscape()).toBe(false);
  });

  it("滚动锁按层数计数，最后一层退出才恢复", () => {
    const manager = createOverlayManager();
    const removeFirst = manager.push({ id: "poll", lockScroll: true });
    const removeSecond = manager.push({ id: "phone", lockScroll: true });
    expect(document.documentElement.classList.contains(SCROLL_LOCK_CLASS)).toBe(true);

    removeSecond();
    expect(document.documentElement.classList.contains(SCROLL_LOCK_CLASS)).toBe(true);
    removeFirst();
    expect(document.documentElement.classList.contains(SCROLL_LOCK_CLASS)).toBe(false);
  });

  it("注销只生效一次；退出时调用 restoreFocus", () => {
    const manager = createOverlayManager();
    const restore = vi.fn();
    const remove = manager.push({ id: "poll", restoreFocus: restore });
    remove();
    remove();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(manager.depth()).toBe(0);
    expect(manager.has("poll")).toBe(false);
  });
});
