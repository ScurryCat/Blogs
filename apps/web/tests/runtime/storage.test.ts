/**
 * 本机状态服务测试（02 §7）。
 *
 * 重点覆盖一个**真实浏览器验收抓到、单实例单测抓不到**的缺陷：
 * `clear()` 原实现只遍历本实例写过的键（内部 `written` 集合）。换页后 `LocalStateService`
 * 是新实例、`written` 为空，而内存本来也是空的 —— 于是「清除本机状态」**静默失效**，
 * 用户点完数据还在。
 *
 * 所以这里每个用例都**刻意换一个实例**来调用 `clear()`，模拟换页后的真实情形；
 * 用 jsdom 的真实 `localStorage` 而不是替身，因为缺陷恰恰在于「服务不知道存储里有什么」。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LocalStateService } from "@/features/runtime/storage";

/** 按前缀列出当前 localStorage 里的键。 */
function keysWithPrefix(prefix: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) found.push(key);
  }
  return found;
}

describe("LocalStateService.clear", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("换实例后仍能清掉上一个实例写入的键（回归：清除曾静默失效）", () => {
    const writer = new LocalStateService(1);
    writer.set("footprint", "entries", [{ slug: "phantom-base" }]);
    expect(keysWithPrefix("pl-app:footprint:")).toHaveLength(1);

    // 换页：新实例，written 为空。修复前这里一个键都删不掉。
    const afterNavigation = new LocalStateService(1);
    afterNavigation.clear("footprint");

    expect(keysWithPrefix("pl-app:footprint:")).toEqual([]);
    expect(afterNavigation.get("footprint", "entries", null)).toBeNull();
  });

  it("只清目标命名空间，不误伤其它应用与 site", () => {
    const service = new LocalStateService(1);
    service.set("footprint", "k", 1);
    service.set("ins", "k", 2);
    service.set("site", "k", 3);

    new LocalStateService(1).clear("footprint");

    const reader = new LocalStateService(1);
    expect(reader.get("footprint", "k", null)).toBeNull();
    expect(reader.get("ins", "k", null)).toBe(2);
    expect(reader.get("site", "k", null)).toBe(3);
  });

  it("跨版本号写入的键一并清除（前缀在 :v 之前就分开了）", () => {
    new LocalStateService(1).set("footprint", "k", "from-v1");
    new LocalStateService(2).set("footprint", "k", "from-v2");
    expect(keysWithPrefix("pl-app:footprint:")).toHaveLength(2);

    new LocalStateService(2).clear("footprint");

    expect(keysWithPrefix("pl-app:footprint:")).toEqual([]);
  });

  it("自定义存储（内存替身）也能被清除，且不要求它实现枚举", () => {
    // 覆盖 collectKeys 的兜底分支：存储只有 get/set/remove 时，靠 written 集合清除。
    const bare = {
      store: new Map<string, string>(),
      getItem(key: string) {
        return this.store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.store.set(key, value);
      },
      removeItem(key: string) {
        this.store.delete(key);
      },
    };
    const service = new LocalStateService(1);
    // 直接把服务指向替身存储：验证「无枚举能力」路径不会抛错。
    Object.assign(service, { storage: bare });
    service.set("footprint", "k", "v");
    service.clear("footprint");

    expect(bare.store.size).toBe(0);
  });
});
