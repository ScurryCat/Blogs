/**
 * 留言的存取层 —— 旧站 `assets/js/guestbook-store.js` 的 TypeScript 迁移。
 *
 * **本机留言仍然是本机留言**（T02 任务卡明确要求「不偷偷迁成共享留言」）：
 * `store: 'local'` 时留言只写进访客自己的浏览器；`remote` 分支保留为将来的
 * Supabase 适配器（本项目首版不引入 Supabase，也没有配置端点与 key）。
 *
 * 与旧站一致：本地最多保留 200 条；联系方式在本地模式下根本不出浏览器。
 */

import type { GuestbookConfig } from "../config";

export interface GuestbookEntry {
  id: string;
  at: string;
  name: string;
  text: string;
  contact?: string;
  page?: string;
}

export interface GuestbookStore {
  mode: "local" | "remote";
  contactStaysLocal: boolean;
  list(): Promise<GuestbookEntry[]>;
  add(entry: Omit<GuestbookEntry, "id" | "at">): Promise<GuestbookEntry>;
}

const LOCAL_KEY = "pl-guestbook-v1";
const LIMIT = 200;

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeParse(raw: string | null): GuestbookEntry[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value) ? (value as GuestbookEntry[]) : [];
  } catch {
    return [];
  }
}

export function createLocalStore(
  storage: LocalStorageLike | null,
  now: () => number = () => Date.now(),
): GuestbookStore {
  return {
    mode: "local",
    contactStaysLocal: true,
    async list() {
      try {
        return safeParse(storage?.getItem(LOCAL_KEY) ?? null);
      } catch {
        return [];
      }
    },
    async add(entry) {
      const all = await this.list();
      const row: GuestbookEntry = { id: `l${now()}`, at: new Date(now()).toISOString(), ...entry };
      all.unshift(row);
      try {
        storage?.setItem(LOCAL_KEY, JSON.stringify(all.slice(0, LIMIT)));
      } catch {
        // 隐私模式：本次会话内有效。
      }
      return row;
    },
  };
}

/**
 * 远端（Supabase REST）适配器。**首版不启用**：只有配置里同时给出
 * `store: 'remote'`、endpoint 与 key 才会切过来（与旧站判定一致）。
 * 权限靠 RLS，anon key 是公开的，绝不当作密码。
 */
export function createRemoteStore(config: GuestbookConfig): GuestbookStore {
  const table = config.table || "guestbook";
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
    ...extra,
  });
  return {
    mode: "remote",
    contactStaysLocal: false,
    async list() {
      const response = await fetch(
        `${config.endpoint}/rest/v1/${table}?select=id,name,text,page,at&order=at.desc&limit=${LIMIT}`,
        { headers: headers() },
      );
      if (!response.ok) throw new Error(`读取失败 ${response.status}`);
      return (await response.json()) as GuestbookEntry[];
    },
    async add(entry) {
      const response = await fetch(`${config.endpoint}/rest/v1/${table}`, {
        method: "POST",
        headers: headers({ Prefer: "return=representation" }),
        body: JSON.stringify(entry),
      });
      if (!response.ok) throw new Error(`提交失败 ${response.status}`);
      const rows = (await response.json()) as GuestbookEntry[];
      const first = rows[0];
      if (!first) throw new Error("提交失败：服务端没有返回记录");
      return first;
    },
  };
}

export function createGuestbookStore(
  config: GuestbookConfig,
  storage: LocalStorageLike | null,
): GuestbookStore {
  const ready = config.store === "remote" && Boolean(config.endpoint) && Boolean(config.key);
  return ready ? createRemoteStore(config) : createLocalStore(storage);
}

export { LOCAL_KEY, LIMIT };
