/**
 * 手记的日期与展示纯函数（验收 2 的前端部分）。
 *
 * 核心断言：**日期按字符串处理，不经过 `new Date(iso)` 的本地时区换算**，
 * 因此不会出现「UTC 转成本地时区后错一天」。这些用例是可用性回归的护栏：
 * 谁把 `parseCalendarDate` 改成 `new Date(value)`，这里就会红。
 */

import { describe, expect, it } from "vitest";

import {
  bestVariant,
  entryPath,
  formatEntryDate,
  formatMonthLabel,
  imageUrl,
  isJournalScreen,
  monthGrid,
  normalizePositions,
  parseCalendarDate,
} from "./paths";
import type { JournalImage } from "./types";

describe("parseCalendarDate", () => {
  it("按字符串拆出年月日，与运行环境的时区无关", () => {
    const parts = parseCalendarDate("2026-10-16");
    expect(parts).not.toBeNull();
    expect(parts?.year).toBe("2026");
    expect(parts?.month).toBe("10");
    expect(parts?.day).toBe("16");
    expect(parts?.weekday).toBe("周五");
    expect(parts?.label).toBe("2026 年 10 月 16 日 周五");
  });

  it("跨年边界不会错一天（1 月 1 日与 12 月 31 日）", () => {
    expect(parseCalendarDate("2026-01-01")?.label).toBe("2026 年 1 月 1 日 周四");
    expect(parseCalendarDate("2026-12-31")?.label).toBe("2026 年 12 月 31 日 周四");
    // 闰日
    expect(parseCalendarDate("2024-02-29")?.weekday).toBe("周四");
  });

  it("非法输入返回 null，而不是「解析成一个别的日期」", () => {
    for (const value of ["", "2026-13-01", "2026-00-10", "2026-10-32", "20261016", "today"]) {
      expect(parseCalendarDate(value)).toBeNull();
    }
  });
});

describe("formatEntryDate", () => {
  it("输出易于阅读的短日期", () => {
    expect(formatEntryDate("2026-10-16")).toBe("10/16 周五");
  });

  it("非法输入原样返回，不抛错", () => {
    expect(formatEntryDate("坏数据")).toBe("坏数据");
  });
});

describe("formatMonthLabel", () => {
  it("YYYY-MM → 中文月份", () => {
    expect(formatMonthLabel("2026-10")).toBe("2026 年 10 月");
    expect(formatMonthLabel("nope")).toBe("nope");
  });
});

describe("monthGrid", () => {
  it("周一起始，长度是 7 的整数倍，日期连续", () => {
    const cells = monthGrid("2026-10");
    expect(cells.length % 7).toBe(0);
    const days = cells.filter((cell): cell is string => Boolean(cell));
    expect(days[0]).toBe("2026-10-01");
    expect(days[days.length - 1]).toBe("2026-10-31");
    expect(days).toHaveLength(31);
  });

  it("2026-10-01 是周四 → 前面有 3 个空位（周一、周二、周三）", () => {
    const cells = monthGrid("2026-10");
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells[3]).toBe("2026-10-01");
  });

  it("闰年二月有 29 天", () => {
    expect(monthGrid("2024-02").filter(Boolean)).toHaveLength(29);
    expect(monthGrid("2025-02").filter(Boolean)).toHaveLength(28);
  });

  it("非法月份返回空数组", () => {
    expect(monthGrid("2026-13")).toEqual([]);
    expect(monthGrid("x")).toEqual([]);
  });
});

describe("图片变体选择", () => {
  const image: JournalImage = {
    media_id: "m1",
    position: 0,
    alt: "照片",
    width: 800,
    height: 600,
    variants: [
      { name: "w320.webp", width: 320, height: 240, bytes: 10, url: "/api/v1/media/m1/w320.webp" },
      { name: "w640.webp", width: 640, height: 480, bytes: 20, url: "/api/v1/media/m1/w640.webp" },
    ],
  };

  it("优先 w640，其次 w320", () => {
    expect(bestVariant(image)?.name).toBe("w640.webp");
    expect(imageUrl(image)).toBe("/api/v1/media/m1/w640.webp");
  });

  it("没有已知变体名时退回第一个，完全没有变体时返回 null", () => {
    const odd: JournalImage = { ...image, variants: [{ ...image.variants[0]!, name: "x.webp" }] };
    expect(bestVariant(odd)?.name).toBe("x.webp");
    expect(imageUrl({ ...image, variants: [] })).toBeNull();
  });
});

describe("normalizePositions", () => {
  it("顺序规整成 0..n-1（服务端要求连续唯一）", () => {
    expect(
      normalizePositions([
        { media_id: "a", alt: "一" },
        { media_id: "b", alt: "二" },
      ]),
    ).toEqual([
      { media_id: "a", alt: "一", position: 0 },
      { media_id: "b", alt: "二", position: 1 },
    ]);
  });
});

describe("screen 与路径", () => {
  it("只有 list / calendar 是合法屏幕", () => {
    expect(isJournalScreen("list")).toBe(true);
    expect(isJournalScreen("calendar")).toBe(true);
    expect(isJournalScreen("draft")).toBe(false);
    expect(isJournalScreen(null)).toBe(false);
  });

  it("详情路径对 id 做 URL 编码", () => {
    expect(entryPath("a b")).toBe("/apps/journal/a%20b");
  });
});
