/**
 * 本机收藏存储（T03 §7）。
 *
 * 关键断言：只存最小摘要（不存正文 / 原图）、存储不可用时降级为内存并**如实报告**
 * `persisted: false`（界面据此说明真相，不谎报「已保存」）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAVORITES_KEY,
  createFavoriteStore,
  favoriteStore,
  parseFavorites,
  resetFavoriteStoreForTests,
  type FavoriteEntry,
} from "./favorites";

function entry(overrides: Partial<FavoriteEntry> = {}): FavoriteEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    savedAt: "2026-10-16T04:00:00.000Z",
    excerpt: "操场上的下午",
    cover: "/api/v1/media/a/w640.webp",
    tags: ["校园"],
    ...overrides,
  };
}

/** 一个不可用的 Storage 替身（模拟隐私模式 / 配额满 / 策略禁用）。 */
function brokenStorage(): Storage {
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
  } as unknown as Storage;
}

/** 一个「写就抛」的存储：模拟配额满（读仍可用）。 */
function quotaFullStorage(): Storage {
  let data = "";
  return {
    length: 0,
    clear: () => {
      data = "";
    },
    getItem: () => data || null,
    key: () => null,
    removeItem: () => {
      data = "";
    },
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } as unknown as Storage;
}

beforeEach(() => {
  window.localStorage.clear();
  resetFavoriteStoreForTests();
});

describe("parseFavorites", () => {
  it("坏数据不抛错，只返回空列表", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("{not json")).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    expect(parseFavorites('[{"id":1}]')).toEqual([]);
  });

  it("丢弃形状不对的条目，保留合法的", () => {
    const raw = JSON.stringify([entry(), { id: "x" }, null, "字符串"]);
    expect(parseFavorites(raw)).toHaveLength(1);
  });
});

describe("createFavoriteStore（可用存储）", () => {
  it("加入 / 判定 / 移除都会真的写进 localStorage", () => {
    const store = createFavoriteStore(window.localStorage);
    expect(store.durable).toBe(true);
    expect(store.add(entry()).persisted).toBe(true);
    expect(store.has(entry().id)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]")).toHaveLength(1);
    expect(store.remove(entry().id).persisted).toBe(true);
    expect(store.has(entry().id)).toBe(false);
  });

  it("重复收藏同一条只保留一份，并把它排到最前", () => {
    const store = createFavoriteStore(window.localStorage);
    const other = entry({ id: "22222222-2222-4222-8222-222222222222" });
    store.add(other);
    store.add(entry());
    store.add(other);
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(other.id);
  });

  it("保存的是最小摘要：不含整段正文，也不含原图地址", () => {
    const store = createFavoriteStore(window.localStorage);
    store.add(entry());
    const raw = window.localStorage.getItem(FAVORITES_KEY) ?? "";
    expect(raw).toContain("操场上的下午");
    expect(raw).not.toContain("original");
    expect(raw).not.toContain("content_md");
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(
      ["cover", "excerpt", "id", "savedAt", "tags"].sort(),
    );
  });

  it("超过上限时保留最近的条目", () => {
    const store = createFavoriteStore(window.localStorage);
    for (let index = 0; index < 205; index += 1) {
      store.add(entry({ id: `id-${index}` }));
    }
    expect(store.list()).toHaveLength(200);
    expect(store.list()[0]?.id).toBe("id-204");
  });
});

describe("createFavoriteStore（存储不可用）", () => {
  it("完全不可读写的存储：降级为内存，并如实报告没有持久化", () => {
    const store = createFavoriteStore(brokenStorage());
    expect(store.durable).toBe(false);
    const result = store.add(entry());
    expect(result.persisted).toBe(false);
    // 内存里仍然可用（界面能切换状态，但会同时说明真相）
    expect(store.has(entry().id)).toBe(true);
  });

  it("配额满：写入失败但仍然可用，且不谎报成功", () => {
    const store = createFavoriteStore(quotaFullStorage());
    const result = store.add(entry());
    expect(result.persisted).toBe(false);
    // 写不进去之后 `durable` 立刻转为 false —— 界面据此说明「刷新会丢」，
    // 而不是继续声称「已保存」。
    expect(store.durable).toBe(false);
    // 内存里仍然可用：这一次收藏在当前页面里是生效的。
    expect(store.has(entry().id)).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it("先探测再声明：不可写的存储从一开始就报告不会持久化", () => {
    const store = createFavoriteStore(quotaFullStorage());
    expect(store.durable).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("没有 localStorage（服务端 / 被禁用）时 durable 为 false", () => {
    expect(createFavoriteStore(null).durable).toBe(false);
  });
});

describe("favoriteStore 单例", () => {
  it("同一页面多处拿到同一份数据", () => {
    const first = favoriteStore();
    first.add(entry());
    expect(favoriteStore().has(entry().id)).toBe(true);
  });

  it("重置后重新探测存储可用性（仅测试用）", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    resetFavoriteStoreForTests();
    favoriteStore();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
