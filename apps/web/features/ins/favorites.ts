"use client";

/**
 * 本机收藏（03 §7「本机收藏只存 UUID、收藏时间及最小展示摘要」）。
 *
 * 规则：
 *  - 只存 `id`、收藏时间与**最小展示摘要**（文字前若干码点 + 封面 URL + 标签名）。
 *    **不复制原图、不存整段正文、不存草稿**（03 §7）。
 *  - 存储不可用（隐私模式 / 配额满 / 被策略禁用）时降级为内存，并让调用方知道
 *    `persisted: false`：界面必须写「仅此浏览器保存」，且**收藏失败不能伪装为已保存**
 *    （03 §4「必备状态」）。
 *  - 再次打开收藏要**重新确认内容仍公开**：本模块只负责本地读写，
 *    校验由 `useFavorites` 调公开详情接口完成（05 §2：UUID 不等于访问控制）。
 */

export interface FavoriteEntry {
  id: string;
  savedAt: string;
  excerpt: string;
  cover: string | null;
  tags: string[];
}

export const FAVORITES_KEY = "ins.favorites.v1";
const MAX_ENTRIES = 200;

export interface FavoriteStore {
  /**
   * 收藏是否真的会持久化（false 表示只在内存里，刷新就丢）。
   * 写入一旦失败就会变成 false —— 界面据此显示真相，而不是笼统说「已保存」。
   */
  readonly durable: boolean;
  list(): FavoriteEntry[];
  has(id: string): boolean;
  add(entry: FavoriteEntry): { persisted: boolean };
  remove(id: string): { persisted: boolean };
  clear(): void;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const probe = "__ins_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Safari 隐私模式、禁用 Cookie / 站点数据、配额满都会走到这里。
    return null;
  }
}

export function parseFavorites(raw: string | null): FavoriteEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFavoriteEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function isFavoriteEntry(value: unknown): value is FavoriteEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.savedAt === "string" &&
    typeof entry.excerpt === "string" &&
    (entry.cover === null || typeof entry.cover === "string") &&
    Array.isArray(entry.tags) &&
    entry.tags.every((tag) => typeof tag === "string")
  );
}

/**
 * 建一个收藏存储。传 `storage` 便于测试注入不可用的替身（不必真的关掉 localStorage）。
 */
export function createFavoriteStore(storage: Storage | null = safeStorage()): FavoriteStore {
  let memory: FavoriteEntry[] = [];
  // `durable` 表示「写入真的落盘了」，不是「浏览器里有 localStorage 这个 API」：
  // Safari 隐私模式、企业策略、配额满都会让 API 存在但每一次读写都抛错，
  // 那种情况下如实报告「不会持久化」比报告「有存储」有用（验收 §1：收藏失败不得伪装为已保存）。
  // 先做一次真实探测：API 存在 ≠ 能用（隐私模式 / 企业策略下一次 setItem 就抛）。
  let usable = storage !== null;
  if (storage) {
    try {
      const probe = "__ins_favorites_probe__";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
    } catch {
      usable = false;
    }
  }

  /**
   * 读取本机存储。
   *
   * **降级语义（重要）**：写入失败时（配额满 / 被策略拦截 / 没有 localStorage）
   * 这次操作的结果仍然留在内存里 —— 否则界面上会出现「点了收藏但列表里没有」，
   * 而 `persisted: false` 已经如实告诉调用方它不会被持久化。
   * 因此只有存储真的能读出内容时才以它为准；读不到时回落到内存副本。
   */
  const read = (): FavoriteEntry[] => {
    if (!storage) return memory;
    try {
      const raw = storage.getItem(FAVORITES_KEY);
      if (raw === null) return memory;
      return parseFavorites(raw);
    } catch {
      usable = false;
      return memory;
    }
  };
  const write = (entries: FavoriteEntry[]): boolean => {
    const bounded = entries.slice(0, MAX_ENTRIES);
    memory = bounded;
    if (!storage) return false;
    try {
      storage.setItem(FAVORITES_KEY, JSON.stringify(bounded));
      return true;
    } catch {
      // 配额满 / 被拦截：内存里仍然可用，但如实报告没有持久化。
      usable = false;
      return false;
    }
  };

  return {
    get durable() {
      return usable;
    },
    list() {
      return read();
    },
    has(id) {
      return read().some((entry) => entry.id === id);
    },
    add(entry) {
      const others = read().filter((item) => item.id !== entry.id);
      const persisted = write([entry, ...others]);
      return { persisted };
    },
    remove(id) {
      const persisted = write(read().filter((entry) => entry.id !== id));
      return { persisted };
    },
    clear() {
      write([]);
    },
  };
}

/** 单例：同一页面上多处收藏状态必须看到同一份数据。 */
let shared: FavoriteStore | null = null;

export function favoriteStore(): FavoriteStore {
  if (!shared) shared = createFavoriteStore();
  return shared;
}

/** 仅测试使用：丢弃单例，让下一次调用重新探测存储可用性。 */
export function resetFavoriteStoreForTests(): void {
  shared = null;
}
