/**
 * 首页排版变体选择（2026-10-17 · 用户反馈 R4）。
 *
 * 规则：`?home=a|b|c` 合法才切换；缺省/非法一律回 `a`（旧链接行为不变）。
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_HOME_VARIANT, HOME_VARIANTS, pickHomeVariant } from "@/features/legacy/pages/home-variant";

describe("pickHomeVariant", () => {
  it("默认是 a，缺省值回 a", () => {
    expect(DEFAULT_HOME_VARIANT).toBe("a");
    expect(pickHomeVariant(undefined)).toBe("a");
    expect(pickHomeVariant("")).toBe("a");
  });

  it("a / b / c 都合法", () => {
    for (const variant of HOME_VARIANTS) {
      expect(pickHomeVariant(variant)).toBe(variant);
    }
  });

  it("非法值与数组取第一个；未知值回 a", () => {
    expect(pickHomeVariant("z")).toBe("a");
    expect(pickHomeVariant(["c", "b"])).toBe("c");
    expect(pickHomeVariant(["nope"])).toBe("a");
  });
});
