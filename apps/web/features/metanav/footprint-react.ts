"use client";

/**
 * 足迹的 React 绑定。
 *
 * 用 `useSyncExternalStore` 而不是「effect 里读 localStorage 再 setState」：
 *  - 服务端渲染时 `getServerSnapshot` 返回空列表，客户端水合不会因为本机已有足迹而错位；
 *  - 存储变化（包括同一个标签页里的写入与其它标签页的 `storage` 事件）都能重新读取；
 *  - 不在渲染期或 effect 里同步改状态，避免级联渲染。
 *
 * `getSnapshot` 必须返回稳定引用，否则会无限重渲染 —— 因此这里缓存上一次的规范化结果。
 */

import { useSyncExternalStore } from "react";

import { FOOTPRINT_APP_ID, readFootprint, subscribeFootprint, type FootprintEntry, type StateAdapter } from "./footprint";

const EMPTY: readonly FootprintEntry[] = Object.freeze([]);

const cache = new Map<string, { raw: string; entries: FootprintEntry[] }>();

function snapshotKey(appId: string, entries: FootprintEntry[]): string {
  return `${appId}:${JSON.stringify(entries)}`;
}

export function useFootprint(
  state: StateAdapter,
  appId: string = FOOTPRINT_APP_ID,
): readonly FootprintEntry[] {
  const getSnapshot = (): readonly FootprintEntry[] => {
    const entries = readFootprint(state, appId);
    const key = snapshotKey(appId, entries);
    const previous = cache.get(appId);
    if (previous && previous.raw === key) return previous.entries;
    cache.set(appId, { raw: key, entries });
    return entries;
  };

  return useSyncExternalStore(
    (listener) => {
      const unsubscribe = subscribeFootprint(listener);
      const onStorage = () => listener();
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        unsubscribe();
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot,
    () => EMPTY,
  );
}
