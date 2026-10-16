/**
 * 放课后的本机状态适配器（与 journal 同一套做法）。
 *
 * 键：`pl-app:leisure:v1:*`；手机与独立页共用，因此「上次看的是追番还是游戏」
 * 在两个宿主里一致（`state_version` 与 manifest 一致 = 1）。
 */

import { LocalStateService } from "@/features/runtime/storage";

export const LEISURE_STATE_VERSION = 1;
export const LEISURE_APP_ID = "leisure";

export interface StateAdapter {
  get<T>(appId: string, key: string, fallback: T): T;
  set<T>(appId: string, key: string, value: T): { persisted: boolean };
  clear(appId: string): void;
}

export function createBrowserStateAdapter(): StateAdapter {
  const service = new LocalStateService(LEISURE_STATE_VERSION);
  return {
    get: (appId, key, fallback) => service.get(appId, key, fallback),
    set: (appId, key, value) => service.set(appId, key, value),
    clear: (appId) => service.clear(appId),
  };
}

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

export function rememberScreen(state: StateAdapter, screen: string): boolean {
  return state.set(LEISURE_APP_ID, "screen", screen).persisted;
}

export function lastScreen(state: StateAdapter): string | null {
  const value = state.get<string | null>(LEISURE_APP_ID, "screen", null);
  return typeof value === "string" ? value : null;
}
