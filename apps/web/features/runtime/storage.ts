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
  /**
   * 与 `Storage` 同形的枚举能力（可选）。
   *
   * `clear()` 需要它才能清掉**上一次会话/上一个页面**写入的键：那些键不在本实例的
   * `written` 集合里，但确实属于同一个命名空间。真实 `localStorage` 天然满足；
   * 自定义实现（如 `createMemoryStorage`）按需提供。
   */
  readonly length?: number;
  key?(index: number): string | null;
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

  /**
   * 清除某个命名空间的本机状态。
   *
   * `namespace` 是手机应用 id 或 `site`；只清该命名空间的键（含**旧版本号**的键，
   * 因为前缀到 `:v` 之前就分开了——`pl-app:<ns>:` 覆盖 `v1`/`v2`）。
   */
  clear(namespace: string): void {
    const prefix = `pl-app:${namespace}:`;
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(prefix)) this.memory.delete(key);
    }
    try {
      if (this.storage) {
        for (const key of this.collectKeys(prefix)) {
          this.storage.removeItem(key);
          this.written.delete(key);
        }
      }
    } catch {
      // 忽略：内存已清空。
    }
  }

  /**
   * 待清除的键 = 本实例写过的 ∪ **存储里已有的同前缀键**。
   *
   * 只遍历 `written` 是错的：换页后 `LocalStateService` 是新实例、`written` 为空，
   * 而内存本来也是空的 —— 于是「清除本机状态」在真实浏览器里**静默失效**，用户点完
   * 数据还在（T04 的浏览器验收就是这么抓到的）。
   *
   * 前缀已经按命名空间限定，所以扫真实存储既安全又必要（不会碰到别的应用或 `site`）。
   * **先收集再删除**：边遍历 `key(i)` 边删会让下标错位、漏掉一半键。
   */
  private collectKeys(prefix: string): string[] {
    const doomed = new Set<string>();
    for (const key of this.written) {
      if (key.startsWith(prefix)) doomed.add(key);
    }
    const store = this.storage;
    if (store && typeof store.length === "number" && typeof store.key === "function") {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key && key.startsWith(prefix)) doomed.add(key);
      }
    }
    return [...doomed];
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
    // 与真实 Storage 一样支持枚举：`clear()` 靠它清掉上一个实例写入的键。
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}
