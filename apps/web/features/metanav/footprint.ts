/**
 * 本机访问足迹（04 §9）。
 *
 * 规则：
 *  - 只保存在**本机**（`localStorage`，经宿主的版本化状态服务），上限 **30** 条，可清除；
 *  - 记录的是「最近访问过的殿堂」，**不是**「已读完」；不做跨设备同步、不做阅读等级；
 *  - 存储不可用（无痕 / 配额 / 被策略禁用）时**不阻止导航**：读写退化为内存，
 *    并如实返回 `persisted:false`，界面提示「这次访问不会被记住」；
 *  - 手机里的应用与独立页共用同一个 `metanav` 命名空间（同一个 `state_version`），
 *    因此「手机里进过的殿堂」在独立页也看得到，反之亦然。
 *
 * 这里不读 `window`：状态服务由调用方注入（手机是 `host.state`，独立页是
 * `LocalStateService`），因此本模块可以在没有浏览器的环境里被测。
 */

import { LocalStateService } from "@/features/runtime/storage";

export const FOOTPRINT_APP_ID = "metanav";
export const FOOTPRINT_KEY = "footprint";
/** 上限 30 条（04 §9）。 */
export const FOOTPRINT_LIMIT = 30;
/** 与手机 manifest 的 `state_version` 保持一致：独立页与手机共用同一份键。 */
export const FOOTPRINT_STATE_VERSION = 1;

export interface StateAdapter {
  get<T>(appId: string, key: string, fallback: T): T;
  set<T>(appId: string, key: string, value: T): { persisted: boolean };
  clear(appId: string): void;
}

export interface FootprintEntry {
  slug: string;
  title: string;
  /** ISO 时间；由本机时钟写入，仅用于展示「最近」顺序。 */
  at: string;
}

// 本机足迹的外部存储订阅（给 `useFootprint` 用）。
// 纯函数在写入后通知订阅者；没有订阅者时（例如 Node 测试）就是空操作。
const listeners = new Set<() => void>();

export function subscribeFootprint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyFootprintChanged(): void {
  for (const listener of [...listeners]) listener();
}

function isEntry(value: unknown): value is FootprintEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === "string" &&
    candidate.slug.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.at === "string"
  );
}

/** 读取足迹：形状不对的条目直接丢弃（不做「尽量猜」），并按上限截断。 */
export function readFootprint(state: StateAdapter, appId: string = FOOTPRINT_APP_ID): FootprintEntry[] {
  const raw = state.get<unknown>(appId, FOOTPRINT_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEntry).slice(0, FOOTPRINT_LIMIT);
}

export interface RecordResult {
  entries: FootprintEntry[];
  persisted: boolean;
}

/**
 * 记录一次访问。同一个 slug 只保留最新一次（去重后置顶），总数不超过 30。
 * 返回写入后的列表；`persisted:false` 说明这次只存在内存里。
 */
export function recordVisit(
  state: StateAdapter,
  entry: { slug: string; title: string; at?: string },
  appId: string = FOOTPRINT_APP_ID,
): RecordResult {
  const at = entry.at ?? new Date().toISOString();
  const previous = readFootprint(state, appId).filter((item) => item.slug !== entry.slug);
  const entries = [{ slug: entry.slug, title: entry.title, at }, ...previous].slice(0, FOOTPRINT_LIMIT);
  const result = state.set(appId, FOOTPRINT_KEY, entries);
  notifyFootprintChanged();
  return { entries, persisted: result.persisted };
}

/**
 * 清除本机足迹。
 *
 * 依赖宿主状态服务的 `clear(namespace)` 语义：删除该命名空间的**所有**键，
 * 而不只是「本实例写过的」那些。这两者在真实浏览器里完全不同 —— 换页后实例是新的，
 * `written` 为空，「点清除但数据还在」就是这么发生的（T04 的浏览器验收抓到，
 * T02 已在 `features/runtime/storage.ts: LocalStateService.clear()` 里修好，
 * 并补了 `tests/runtime/storage.test.ts`）。本包不再自己扫 localStorage：
 * 手机与独立页都只通过注入的状态适配器读写。
 */
export function clearFootprint(state: StateAdapter, appId: string = FOOTPRINT_APP_ID): void {
  state.clear(appId);
  notifyFootprintChanged();
}

/** 移除单条（专题已不再公开时用它清掉过期入口）。 */
export function removeVisit(
  state: StateAdapter,
  slug: string,
  appId: string = FOOTPRINT_APP_ID,
): FootprintEntry[] {
  const entries = readFootprint(state, appId).filter((item) => item.slug !== slug);
  state.set(appId, FOOTPRINT_KEY, entries);
  notifyFootprintChanged();
  return entries;
}

/** 浏览器侧的默认实现：独立页没有手机宿主，但用同一套键（因此两边共享足迹）。 */
export function createBrowserStateAdapter(): StateAdapter {
  const service = new LocalStateService(FOOTPRINT_STATE_VERSION);
  return {
    get: (appId, key, fallback) => service.get(appId, key, fallback),
    set: (appId, key, value) => service.set(appId, key, value),
    clear: (appId) => service.clear(appId),
  };
}

/** 内存实现：测试与「存储一定不可用」的场景使用。 */
export function createMemoryStateAdapter(): StateAdapter {
  const store = new Map<string, unknown>();
  return {
    get: <T,>(appId: string, key: string, fallback: T): T => {
      const value = store.get(`${appId}:${key}`);
      return value === undefined ? fallback : (value as T);
    },
    set: <T,>(appId: string, key: string, value: T) => {
      store.set(`${appId}:${key}`, value);
      return { persisted: false };
    },
    clear: (appId: string) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${appId}:`)) store.delete(key);
      }
    },
  };
}
