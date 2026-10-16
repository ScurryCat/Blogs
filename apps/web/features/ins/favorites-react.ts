"use client";

/**
 * 收藏的 React 绑定。
 *
 * 用 `useSyncExternalStore` 而不是「effect 里读 localStorage 再 setState」：
 *  - 服务端渲染时 `getServerSnapshot` 返回空列表（「未收藏」），客户端水合不会因为
 *    本机已有收藏而错位；
 *  - 本标签页写入与**其他标签页**的 `storage` 事件都能触发重读；
 *  - 不在渲染期或 effect 里同步改状态，避免级联渲染。
 *
 * `getSnapshot` 必须返回**稳定引用**，否则会无限重渲染 —— 因此这里按
 * `localStorage` 的原始字符串缓存上一次的解析结果（T04 的同名做法）。
 */

import { useSyncExternalStore } from "react";

import { createFavoriteStore, FAVORITES_KEY, parseFavorites, type FavoriteEntry, type FavoriteStore } from "./favorites";

const EMPTY: readonly FavoriteEntry[] = Object.freeze([]);

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string; entries: FavoriteEntry[] }>();

/** 写入后通知所有订阅者（同一标签页内不会触发 `storage` 事件，必须自己广播）。 */
export function notifyFavoritesChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function rawFavorites(): string {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(FAVORITES_KEY) ?? "";
  } catch {
    // 存储被禁用：返回空串，与服务端的「未收藏」一致。
    return "";
  }
}

function snapshotFor(store: FavoriteStore): readonly FavoriteEntry[] {
  const raw = store.durable ? rawFavorites() : JSON.stringify(store.list());
  const previous = cache.get("favorites");
  if (previous && previous.raw === raw) return previous.entries;
  const entries = store.durable ? parseFavorites(raw || null) : [...store.list()];
  cache.set("favorites", { raw, entries });
  return entries;
}

/** 读取本机收藏列表；服务端返回空列表。 */
export function useFavoriteEntries(): readonly FavoriteEntry[] {
  return useSyncExternalStore(
    (listener) => {
      const unsubscribe = subscribeFavorites(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === FAVORITES_KEY) listener();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        unsubscribe();
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    () => snapshotFor(createFavoriteStore()),
    () => EMPTY,
  );
}

export interface FavoriteActions {
  entries: readonly FavoriteEntry[];
  durable: boolean;
  has: (id: string) => boolean;
  add: (entry: FavoriteEntry) => { persisted: boolean };
  remove: (id: string) => { persisted: boolean };
}

/**
 * 收藏的读写接口。读取走 `useSyncExternalStore`（见上），
 * 写入后广播，因此同一页面上所有收藏按钮会同步更新。
 */
export function useFavorites(): FavoriteActions {
  const entries = useFavoriteEntries();
  const store = createFavoriteStore();
  return {
    entries,
    durable: store.durable,
    has: (id) => entries.some((entry) => entry.id === id),
    add(entry) {
      const result = store.add(entry);
      notifyFavoritesChanged();
      return result;
    },
    remove(id) {
      const result = store.remove(id);
      notifyFavoritesChanged();
      return result;
    },
  };
}
