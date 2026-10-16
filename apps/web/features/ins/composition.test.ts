/**
 * INS 组合接口（T03 交付的接线契约）。
 *
 * 最关键的断言是「**未接入的页签不显示**」：没有注入就没有按钮，
 * 也不能出现「敬请期待」占位（验收用例 5）。
 */

import { describe, expect, it } from "vitest";

import {
  BUILTIN_TABS,
  INS_FEED_TAB,
  INS_SAVED_TAB,
  InsTabConflictError,
  resolveTabs,
  type InsTabContribution,
} from "./composition";

function contribution(overrides: Partial<InsTabContribution> = {}): InsTabContribution {
  return {
    id: "gallery",
    label: "相册",
    ariaLabel: "相册视图",
    order: 30,
    render: () => null,
    ...overrides,
  };
}

describe("resolveTabs", () => {
  it("没有注入时只有内置页签（动态 + 收藏）", () => {
    const tabs = resolveTabs();
    expect(tabs.map((tab) => tab.id)).toEqual([INS_FEED_TAB, INS_SAVED_TAB]);
    expect(tabs.every((tab) => tab.builtin)).toBe(true);
  });

  it("注入的页签按 order 排在后面，并保留自己的渲染函数", () => {
    const gallery = contribution({ id: "gallery", label: "相册", order: 30 });
    const messages = contribution({ id: "messages", label: "消息", order: 40 });
    const tabs = resolveTabs([messages, gallery]);
    expect(tabs.map((tab) => tab.id)).toEqual([INS_FEED_TAB, INS_SAVED_TAB, "gallery", "messages"]);
    expect(tabs.find((tab) => tab.id === "gallery")?.builtin).toBe(false);
    expect(typeof tabs.find((tab) => tab.id === "gallery")?.render).toBe("function");
  });

  it("isAvailable() 为 false 的页签**完全不出现**（不是禁用按钮）", () => {
    const tabs = resolveTabs([
      contribution({ id: "gallery", isAvailable: () => false }),
      contribution({ id: "messages", order: 40, isAvailable: () => true }),
    ]);
    expect(tabs.map((tab) => tab.id)).not.toContain("gallery");
    expect(tabs.map((tab) => tab.id)).toContain("messages");
  });

  it("占用内置页签 id 会立刻报错，而不是静默覆盖", () => {
    expect(() => resolveTabs([contribution({ id: INS_FEED_TAB })])).toThrow(InsTabConflictError);
    expect(() => resolveTabs([contribution({ id: INS_SAVED_TAB })])).toThrow(InsTabConflictError);
  });

  it("重复注入同一个 id 也会报错（否则选中状态无法表达）", () => {
    expect(() =>
      resolveTabs([contribution({ id: "gallery" }), contribution({ id: "gallery", order: 31 })]),
    ).toThrow(InsTabConflictError);
  });

  it("内置页签常量没有被外部注入改变（不可变）", () => {
    resolveTabs([contribution()]);
    expect(BUILTIN_TABS.map((tab) => tab.id)).toEqual([INS_FEED_TAB, INS_SAVED_TAB]);
  });
});
