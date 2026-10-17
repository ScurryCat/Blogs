"use client";

/**
 * 滚动位置记忆（03 §4：「回到列表恢复筛选、分页结果和滚动位置」）。
 *
 * 为什么不用浏览器原生滚动恢复：App Router 的客户端导航不会自动恢复窗口滚动，
 * 而「详情 → 返回」必须回到原卡片。这里把位置存在 `sessionStorage`（按标签分键，
 * 因此筛选不同不会互相串位），在列表重新挂载并且**已渲染足够内容之后**再恢复。
 *
 * 存储不可用时安静降级：记住位置是体验优化，不是正确性要求，不能因此阻断阅读。
 *
 * **滚动容器不一定是 window**：手机里滚动的是 `.pw-screen`（手机宿主内的滚动区），
 * 独立页 `/apps/ins` 滚的才是窗口。早期版本只读写 `window.scrollY`，于是手机里
 * 「详情 → 返回」根本恢复不了位置（保存的永远是 0）。这里按列表最近的 `.pw-screen`
 * 祖先自动判定容器，独立页自然回退到 window。
 */

import { useEffect, useRef, type RefObject } from "react";

// 各调用方用自己的前缀，互不干扰。
export const FEED_SCROLL_PREFIX = "ins.feed.scroll.v1";

export function scrollKey(tag: string | null): string {
  return `${FEED_SCROLL_PREFIX}:${(tag ?? "").trim() || "__all__"}`;
}

/** 手机宿主的滚动区；不在手机里时返回 null（此时滚动的是窗口）。 */
export function phoneScrollContainer(el: HTMLElement | null): HTMLElement | null {
  return el?.closest<HTMLElement>(".pw-screen") ?? null;
}

/** 解析实际滚动容器：手机 → `.pw-screen`，独立页 → window。 */
export function scrollContainerFor(el: HTMLElement | null): HTMLElement | Window {
  return phoneScrollContainer(el) ?? window;
}

function readOffset(container: HTMLElement | Window): number {
  return (container as HTMLElement).scrollTop ?? window.scrollY;
}

function writeOffset(container: HTMLElement | Window, target: number): void {
  if (container === window) {
    window.scrollTo({ top: target, behavior: "auto" });
    return;
  }
  (container as HTMLElement).scrollTop = target;
}

function readScroll(key: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function writeScroll(key: string, value: number): void {
  try {
    window.sessionStorage.setItem(key, String(Math.round(value)));
  } catch {
    // 隐私模式 / 配额满：忽略，不影响阅读。
  }
}

export interface RestoreScrollOptions {
  /** 是否启用（服务端渲染时关闭）。 */
  enabled: boolean;
  /** 恢复后是否清掉记录：只在一次返回里生效。 */
  consume?: boolean;
  /** 列表根节点的 ref：用来判定滚动容器（手机 `.pw-screen` / 独立页 window）。 */
  containerRef?: RefObject<HTMLElement | null>;
}

export function useScrollMemory(
  key: string,
  ready: boolean,
  options: RestoreScrollOptions = { enabled: true, consume: true },
): void {
  const restored = useRef(false);

  useEffect(() => {
    if (!options.enabled || !ready || restored.current) return;
    restored.current = true;
    const target = readScroll(key);
    if (target === null) return;
    const container = scrollContainerFor(options.containerRef?.current ?? null);
    // 等一帧：图片与卡片的高度在首帧之后才稳定，过早滚动会被后续布局顶回去。
    const raf = requestAnimationFrame(() => {
      writeOffset(container, target);
      if (options.consume) {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          /* 忽略 */
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [key, options.consume, options.enabled, options.containerRef, ready]);

  // 卸载前记下当前位置，供「详情 → 返回」使用。
  // **容器在 effect 建立时就解析**：React 会在卸载清理之前把 ref 置空，
  // 到清理时再解析会回退成 window，于是永远存 0（实测踩到）。
  useEffect(() => {
    if (!options.enabled) return undefined;
    const container = scrollContainerFor(options.containerRef?.current ?? null);
    return () => {
      writeScroll(key, readOffset(container));
    };
  }, [key, options.enabled, options.containerRef]);
}
