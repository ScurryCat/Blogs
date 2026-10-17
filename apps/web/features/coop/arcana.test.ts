/**
 * 阿卡那装饰映射（第二轮 §4.5）。
 *
 * 断言两件事：认得的写法给出罗马数字/英文/中文；**认不出的写法只能原样显示**，
 * 不能编数字、也不能被当成关系数值（卡面文案里明确写「装饰分类 · 非等级」）。
 */

import { describe, expect, it } from "vitest";

import { ARCANA_LIST, arcanaOf, normalizeArcana } from "./arcana";

describe("阿卡那规整与查表", () => {
  it("常见写法都能查到罗马数字和中文名", () => {
    expect(arcanaOf("STAR")).toEqual({ numeral: "XVII", en: "STAR", cn: "星" });
    expect(arcanaOf("star")).toEqual({ numeral: "XVII", en: "STAR", cn: "星" });
    expect(arcanaOf("  Hierophant ")).toEqual({ numeral: "V", en: "HIEROPHANT", cn: "教皇" });
    expect(arcanaOf("fool")).toEqual({ numeral: "0", en: "FOOL", cn: "愚者" });
    expect(arcanaOf("world")).toEqual({ numeral: "XXI", en: "WORLD", cn: "世界" });
  });

  it("接受空格/连字符/下划线与常见别名", () => {
    expect(arcanaOf("high priestess")?.en).toBe("PRIESTESS");
    expect(arcanaOf("hanged-man")?.numeral).toBe("XII");
    expect(arcanaOf("judgment")?.en).toBe("JUDGEMENT");
    expect(normalizeArcana("  the   moon ")).toBe("THE_MOON");
    expect(arcanaOf("the moon")).toBeNull(); // 没登记「the」前缀 → 原样展示，不猜
  });

  it("未知/空值不编造：返回 null，由调用方原样显示", () => {
    expect(arcanaOf("whatever")).toBeNull();
    expect(arcanaOf("")).toBeNull();
    expect(arcanaOf(null)).toBeNull();
    expect(arcanaOf(undefined)).toBeNull();
  });

  it("完整列表 22 张、罗马数字不重复且从 0 开始", () => {
    expect(ARCANA_LIST).toHaveLength(22);
    const numerals = ARCANA_LIST.map((item) => item.numeral);
    expect(new Set(numerals).size).toBe(22);
    expect(numerals[0]).toBe("0");
    expect(numerals.at(-1)).toBe("XXI");
  });
});
