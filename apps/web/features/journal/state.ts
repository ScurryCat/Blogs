/**
 * 手记的本机状态适配器。
 *
 * 与客户端的 `PhoneStateService` **结构相同**（get / set / clear），因此：
 *  - 手机宿主把 `host.state` 直接传进来就能用；
 *  - 独立页用 `createBrowserStateAdapter()`，走同一套版本化键
 *    （`pl-app:journal:v1:*`），于是两边共享「上次看的是列表还是日历」。
 *
 * 存储不可用时 `set` 返回 `persisted: false`：调用方应当如实提示「只在本页有效」，
 * 而不是假装保存成功（02 §7）。
 */

import { LocalStateService } from "@/features/runtime/storage";

/** 与手机 manifest 的 `state_version` 保持一致。 */
export const JOURNAL_STATE_VERSION = 1;
export const JOURNAL_APP_ID = "journal";

export interface StateAdapter {
  get<T>(appId: string, key: string, fallback: T): T;
  set<T>(appId: string, key: string, value: T): { persisted: boolean };
  clear(appId: string): void;
}

/** 浏览器侧的默认实现：独立页没有手机宿主，但用同一套键。 */
export function createBrowserStateAdapter(): StateAdapter {
  const service = new LocalStateService(JOURNAL_STATE_VERSION);
  return {
    get: (appId, key, fallback) => service.get(appId, key, fallback),
    set: (appId, key, value) => service.set(appId, key, value),
    clear: (appId) => service.clear(appId),
  };
}

/** 内存实现：测试与「存储一定不可用」的场景使用（如实返回 `persisted: false`）。 */
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

/** 记录「最近一次浏览位置」。返回是否真的持久化了。 */
export function rememberScreen(state: StateAdapter, screen: string): boolean {
  return state.set(JOURNAL_APP_ID, "screen", screen).persisted;
}

export function lastScreen(state: StateAdapter): string | null {
  const value = state.get<string | null>(JOURNAL_APP_ID, "screen", null);
  return typeof value === "string" ? value : null;
}

/**
 * 存档式列表的「返回位置」（任务书 §3.2：保留返回位置）。
 *
 * 记录的是**当前选中的那篇手记 ID**，不是显示编号 —— 编号只是列表顺序，
 * 会随筛选变化，不能作为恢复依据。读取正文时写一次，回到列表时按 ID 恢复选中
 * （记录已不在公开列表里时自然回退到第一篇）。
 */
export function rememberEntry(state: StateAdapter, entryId: string): boolean {
  return state.set(JOURNAL_APP_ID, "entry", entryId).persisted;
}

export function lastEntry(state: StateAdapter): string | null {
  const value = state.get<string | null>(JOURNAL_APP_ID, "entry", null);
  return typeof value === "string" ? value : null;
}

/** 年份筛选也记一份：从正文返回时保持当时的筛选，不突然跳回全部。 */
export function rememberYear(state: StateAdapter, year: string): boolean {
  return state.set(JOURNAL_APP_ID, "year", year).persisted;
}

export function lastYear(state: StateAdapter): string | null {
  const value = state.get<string | null>(JOURNAL_APP_ID, "year", null);
  return typeof value === "string" ? value : null;
}
