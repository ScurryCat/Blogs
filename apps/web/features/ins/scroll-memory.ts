"use client";

/**
 * 滚动位置记忆（03 §4：「回到列表恢复筛选、分页结果和滚动位置」）。
 *
 * 为什么不用浏览器原生滚动恢复：App Router 的客户端导航不会自动恢复窗口滚动，
 * 而「详情 → 返回」必须回到原卡片。这里把位置存在 `sessionStorage`（按标签分键，
 * 因此筛选不同不会互相串位），在列表重新挂载并且**已渲染足够内容之后**再恢复。
 *
 * 存储不可用时安静降级：记住位置是体验优化，不是正确性要求，不能因此阻断阅读。
 */

import { useEffect, useRef } from "react";

const KEY_PREFIX = "ins.feed.scroll.v1";

export function scrollKey(tag: string | null): string {
  return `${KEY_PREFIX}:${(tag ?? "").trim() || "__all__"}`;
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
}

export function useFeedScrollRestore(
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
    // 等一帧：图片与卡片的高度在首帧之后才稳定，过早滚动会被后续布局顶回去。
    const raf = requestAnimationFrame(() => {
      window.scrollTo({ top: target, behavior: "auto" });
      if (options.consume) {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          /* 忽略 */
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [key, options.consume, options.enabled, ready]);

  // 卸载前记下当前位置，供「详情 → 返回」使用。
  useEffect(() => {
    if (!options.enabled) return undefined;
    return () => {
      writeScroll(key, window.scrollY);
    };
  }, [key, options.enabled]);
}
