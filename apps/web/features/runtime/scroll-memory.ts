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

/**
 * 找**最近的真正可滚动的祖先**。
 *
 * 这里踩过一个坑：手机里真正滚动的**不是** `.pw-screen`，而是它里面的 `.pw-appbody`
 * （`overflow-y:auto`，实测 scrollHeight 2608 / clientHeight 524）。早期版本写死找
 * `.pw-screen`，于是手机里的滚动记忆**一直没生效** —— 而 jsdom 测试因为自己假设了
 * `.pw-screen` 反而全绿。是浏览器端到端测量把它抓出来的。
 */
export function nearestScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScrollY && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * 解析实际滚动容器，按优先级：
 * 1. 最近的可滚动祖先（手机 App 里的 `.pw-appbody`、某些页面的局部滚动区）；
 * 2. 手机宿主的 `.pw-screen`（jsdom 里没有布局，量不出可滚性，用这个兜底）；
 * 3. window（独立页）。
 */
export function scrollContainerFor(el: HTMLElement | null): HTMLElement | Window {
  return nearestScrollableAncestor(el) ?? phoneScrollContainer(el) ?? window;
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
  //
  // 这里有两层坑，都是浏览器端到端测量抓出来的：
  //  1. React 会在卸载清理**之前**把 ref 置空 —— 清理时直接读 ref 会拿到 null，
  //     于是回退成 window、永远存 0；
  //  2. 但也不能在 effect 建立时就把**容器**定死 —— 列表首帧还没内容，
  //     `.pw-appbody` 此时 scrollHeight == clientHeight，量不出「可滚动」，
  //     会退化成不滚动的 `.pw-screen`，同样存 0（实测：进正文时存的是 0 而不是 1300）。
  //
  // 解法：每次渲染后把**列表元素本身**同步到一个自有 ref（元素一直有效），
  // 真正解析容器放到卸载那一刻 —— 那时内容已渲染、可滚性可量。
  // 位置必须**边滚边记**，不能等卸载再读。
  //
  // 实测（浏览器打点）：组件卸载时 React 已经把 DOM 摘掉了 —— 清理函数里拿到的
  // `.pw-appbody` 是 `connected=false`，`scrollTop` 已被重置为 0。
  // 所以：每次渲染后解析出真正可滚的容器并挂 scroll 监听，滚动即写；
  // 卸载时只做「仍连接才写」的兜底，避免用 0 覆盖掉滚动期间存下的好值。
  const scrollTargetRef = useRef<HTMLElement | Window | null>(null);
  const attachedRef = useRef<HTMLElement | Window | null>(null);
  const listenerRef = useRef<(() => void) | null>(null);

  const detach = () => {
    const attached = attachedRef.current;
    const listener = listenerRef.current;
    if (attached && listener) attached.removeEventListener("scroll", listener);
    attachedRef.current = null;
    listenerRef.current = null;
  };

  // 不返回清理函数：这个 effect 每次渲染都会跑，但只在**容器变化**时重挂监听，
  // 否则每次渲染都会摘掉再挂上（干净但没必要）。真正的摘除在卸载 effect 里。
  useEffect(() => {
    if (!options.enabled) return undefined;
    const anchor = options.containerRef?.current ?? null;
    // 没有列表 ref（例如独立页测试里的简化用法）时，按窗口滚动处理。
    const target: HTMLElement | Window = anchor ? scrollContainerFor(anchor) : window;
    scrollTargetRef.current = target;
    if (attachedRef.current === target) return undefined;
    detach();
    const onScroll = () => {
      const current = scrollTargetRef.current;
      if (current) writeScroll(key, readOffset(current));
    };
    listenerRef.current = onScroll;
    attachedRef.current = target;
    target.addEventListener("scroll", onScroll, { passive: true } as AddEventListenerOptions);
    return undefined;
  });

  useEffect(() => {
    if (!options.enabled) return undefined;
    return () => {
      const target = scrollTargetRef.current;
      // 只在元素仍连接时兜底写一次；已卸载的节点 scrollTop 是 0，会覆盖掉好值。
      if (target && (target === window || (target as HTMLElement).isConnected)) {
        writeScroll(key, readOffset(target));
      }
      detach();
    };
  }, [key, options.enabled]);
}
