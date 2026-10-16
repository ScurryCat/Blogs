/**
 * 本机足迹（04 §9）：上限 30、去重置顶、可清除、存储不可用降级。
 *
 * 这些是纯函数用例：状态服务由测试注入（内存实现或「一定会失败」的实现），
 * 因此「存储不可用」这条路径是被真的执行过的，而不是靠读代码相信。
 */

import { describe, expect, it } from "vitest";

import {
  FOOTPRINT_APP_ID,
  FOOTPRINT_LIMIT,
  clearFootprint,
  createMemoryStateAdapter,
  readFootprint,
  recordVisit,
  removeVisit,
  type StateAdapter,
} from "./footprint";

/** 一定能写、但如实报告「没有持久化」的存储（无痕 / 配额满的行为）。 */
function unavailableStorage(): StateAdapter {
  const memory = new Map<string, unknown>();
  return {
    get: <T,>(appId: string, key: string, fallback: T): T =>
      (memory.get(`${appId}:${key}`) as T) ?? fallback,
    set: <T,>(appId: string, key: string, value: T) => {
      memory.set(`${appId}:${key}`, value);
      return { persisted: false };
    },
    clear: (appId: string) => {
      for (const key of [...memory.keys()]) if (key.startsWith(`${appId}:`)) memory.delete(key);
    },
  };
}

describe("足迹读写", () => {
  it("记录后可按最近优先读回，并保留标题与时间", () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: "a", title: "甲", at: "2026-10-16T10:00:00.000Z" });
    recordVisit(state, { slug: "b", title: "乙", at: "2026-10-16T11:00:00.000Z" });

    const entries = readFootprint(state);
    expect(entries.map((item) => item.slug)).toEqual(["b", "a"]);
    expect(entries[0]).toMatchObject({ title: "乙", at: "2026-10-16T11:00:00.000Z" });
  });

  it("同一个 slug 只保留最新一次（去重后置顶，不重复计数）", () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: "a", title: "甲", at: "2026-10-16T10:00:00.000Z" });
    recordVisit(state, { slug: "b", title: "乙", at: "2026-10-16T11:00:00.000Z" });
    recordVisit(state, { slug: "a", title: "甲（改名）", at: "2026-10-16T12:00:00.000Z" });

    const entries = readFootprint(state);
    expect(entries.map((item) => item.slug)).toEqual(["a", "b"]);
    expect(entries[0]?.title).toBe("甲（改名）");
  });

  it("上限 30：第 31 条把最旧的一条挤出去", () => {
    const state = createMemoryStateAdapter();
    for (let index = 0; index < FOOTPRINT_LIMIT + 5; index += 1) {
      recordVisit(state, {
        slug: `palace-${index}`,
        title: `殿堂 ${index}`,
        at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      });
    }
    const entries = readFootprint(state);
    expect(entries).toHaveLength(FOOTPRINT_LIMIT);
    expect(entries[0]?.slug).toBe(`palace-${FOOTPRINT_LIMIT + 4}`);
    expect(entries.map((item) => item.slug)).not.toContain("palace-0");
  });

  it("清除后为空，重新访问会再次写入（不是一次性快照）", () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: "a", title: "甲" });
    clearFootprint(state);
    expect(readFootprint(state)).toEqual([]);

    recordVisit(state, { slug: "a", title: "甲" });
    expect(readFootprint(state).map((item) => item.slug)).toEqual(["a"]);
  });

  it("可以移除单条（专题已不再公开时的过期入口）", () => {
    const state = createMemoryStateAdapter();
    recordVisit(state, { slug: "a", title: "甲" });
    recordVisit(state, { slug: "b", title: "乙" });
    expect(removeVisit(state, "a").map((item) => item.slug)).toEqual(["b"]);
    expect(readFootprint(state).map((item) => item.slug)).toEqual(["b"]);
  });

  it("存储里的脏数据被丢弃，而不是尽量猜", () => {
    const state = createMemoryStateAdapter();
    state.set(FOOTPRINT_APP_ID, "footprint", [
      { slug: "ok", title: "正常", at: "2026-10-16T10:00:00.000Z" },
      { slug: "", title: "空 slug", at: "2026-10-16T10:00:00.000Z" },
      { slug: "no-title", at: "2026-10-16T10:00:00.000Z" },
      "不是对象",
      null,
    ]);
    expect(readFootprint(state).map((item) => item.slug)).toEqual(["ok"]);

    state.set(FOOTPRINT_APP_ID, "footprint", "不是数组");
    expect(readFootprint(state)).toEqual([]);
  });

  it("存储不可用时如实返回 persisted:false，但本次会话内仍能读回（导航不被阻止）", () => {
    const state = unavailableStorage();
    const result = recordVisit(state, { slug: "a", title: "甲" });
    expect(result.persisted).toBe(false);
    expect(result.entries.map((item) => item.slug)).toEqual(["a"]);
    expect(readFootprint(state).map((item) => item.slug)).toEqual(["a"]);
  });
});
