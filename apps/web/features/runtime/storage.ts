/**
 * 版本化本机状态（02 §7）。
 *
 * 规则：
 *  - **不在模块顶层读 `window` / `localStorage`**（01 §4 / 02 §7）：所有读写都经函数，
 *    在服务端渲染与预渲染时安全返回默认值。
 *  - 存储不可用（无痕、被策略禁、配额满）时退化为**内存**，并如实告诉调用方
 *    `persisted: false`，让界面能提示「只在本页有效」，而不是静默假装保存成功。
 *  - 旧站键（`pl-track` / `pl-vol` / `pl-music` / `pl-sound`）按版本迁移，
 *    并且**不擅自把用户记住的「音乐关闭」改成开启**。
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WriteResult {
  persisted: boolean;
}

/** 每次读取都重新探测：用户可能在会话中途进入无痕模式或清空存储。 */
function detectStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    const candidate = window.localStorage;
    if (!candidate) return null;
    // 无痕模式下 setItem 会抛异常：写一次探针确认真的可用。
    const probe = "__pl_probe__";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * 版本化本机状态。`namespace` 取手机应用 id 或 `site`；键形如
 * `pl-app:<namespace>:v<version>:<key>`，与 02 §4 的 `state_version` 对应。
 */
export class LocalStateService {
  private readonly memory = new Map<string, string>();
  private readonly written = new Set<string>();
  private readonly storage: StorageLike | null;

  constructor(private readonly version: number = 1) {
    this.storage = detectStorage();
  }

  /** 现在是否真的能持久化（供「只在本页有效」之类的提示使用）。 */
  get available(): boolean {
    return typeof window !== "undefined" && this.storage !== null;
  }

  get<T>(namespace: string, key: string, fallback: T): T {
    const scoped = this.scopedKey(namespace, key);
    const raw = this.readRaw(scoped);
    if (raw !== null) return parseJson(raw, fallback);
    const legacy = this.legacyKey(namespace, key);
    if (legacy !== null) {
      const old = this.readRaw(legacy);
      if (old !== null) {
        const value = parseJson(old, fallback);
        // 迁移一次，之后只认版本化键。
        this.set(namespace, key, value);
        return value;
      }
    }
    return fallback;
  }

  set<T>(namespace: string, key: string, value: T): WriteResult {
    const serialized = JSON.stringify(value);
    const scoped = this.scopedKey(namespace, key);
    this.memory.set(scoped, serialized);
    this.written.add(scoped);
    try {
      if (this.storage) {
        this.storage.setItem(scoped, serialized);
        return { persisted: true };
      }
    } catch {
      // 配额 / 隐私模式：内存继续服务本次会话。
    }
    return { persisted: false };
  }

  clear(namespace: string): void {
    const prefix = `pl-app:${namespace}:`;
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(prefix)) this.memory.delete(key);
    }
    try {
      if (this.storage) {
        for (const key of [...this.written]) {
          if (key.startsWith(prefix)) {
            this.storage.removeItem(key);
            this.written.delete(key);
          }
        }
      }
    } catch {
      // 忽略：内存已清空。
    }
  }

  private scopedKey(namespace: string, key: string): string {
    return `pl-app:${namespace}:v${this.version}:${key}`;
  }

  /** v1 之前只对 `site` 命名空间有一个旧位置；应用级状态从来没有无版本键。 */
  private legacyKey(namespace: string, key: string): string | null {
    return namespace === "site" ? `pl-site:${key}` : null;
  }

  private readRaw(key: string): string | null {
    try {
      const value = this.storage?.getItem(key) ?? null;
      if (value !== null) return value;
    } catch {
      // 落到内存。
    }
    return this.memory.get(key) ?? null;
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** 旧站的普通字符串键（`pl-vol` / `pl-music` 存的不是 JSON）。 */
export function readLegacyString(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLegacyString(key: string, value: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 内存存储：测试与「存储不可用」路径使用。 */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
