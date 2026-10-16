/**
 * 放课后的展示规则（验收 3 的前端部分）。
 *
 * 核心断言：
 *  - 总数未知 → 「看到第 6 集」且 `completionRatio` 是 `null`（**不是 0，也不是 1**）；
 *  - 未评分显示「未评分」，不是 0 分；
 *  - 通关与全成就彼此独立，没有任何互相推导；
 *  - 本地规则与后端 `rules.py` 完全一致（同一组样例在两边都有断言）。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  LEISURE_SCREENS,
  completionRatio,
  crossKindFields,
  episodesLabel,
  filterEntries,
  isLeisureScreen,
  playtimeLabel,
  progressLabel,
  ratingLabel,
  reviewHref,
} from "./paths";
import type { LeisureEntry } from "./types";

function entry(overrides: Partial<LeisureEntry> = {}): LeisureEntry {
  return {
    id: "e1",
    kind: "anime",
    title: "某部番",
    progress: "watching",
    progress_label: "在看",
    rating: null,
    notes: "",
    notes_have_spoilers: false,
    cover: null,
    anime: null,
    game: null,
    review: null,
    updated_at: "2026-10-16T00:00:00Z",
    ...overrides,
  };
}

describe("进度标签（与后端 rules.episodes_label 同规则）", () => {
  it("总数未知时只说「看到第 6 集」，不带百分比", () => {
    expect(episodesLabel(6, null)).toBe("看到第 6 集");
    expect(episodesLabel(6, null)).not.toContain("%");
  });

  it("总数已知时给出分数形式", () => {
    expect(episodesLabel(6, 12)).toBe("看到第 6 / 12 集");
    expect(episodesLabel(null, 12)).toBe("共 12 集");
    expect(episodesLabel(null, null)).toBe("还没记录进度");
  });
});

describe("完成率（总数未知不算）", () => {
  it("总数未知 / 非正 / 集数未知 → null", () => {
    expect(completionRatio(6, null)).toBeNull();
    expect(completionRatio(null, 12)).toBeNull();
    expect(completionRatio(0, 0)).toBeNull();
  });

  it("已知时给出比例（并夹紧不超过 1）", () => {
    expect(completionRatio(6, 12)).toBe(0.5);
    expect(completionRatio(99, 12)).toBe(1);
  });
});

describe("时长与评分", () => {
  it("未记录时长不显示 0 小时", () => {
    expect(playtimeLabel(null)).toBe("未记录时长");
    expect(playtimeLabel(45)).toBe("45 分");
    expect(playtimeLabel(60)).toBe("1 小时");
    expect(playtimeLabel(95)).toBe("1 小时 35 分");
  });

  it("未评分 ≠ 0 分", () => {
    expect(ratingLabel(null)).toBe("未评分");
    expect(ratingLabel(8)).toBe("8 / 10");
    expect(ratingLabel(null)).not.toContain("0");
  });
});

describe("进度文案分类型", () => {
  it("追番说「看完 / 在看」，游戏说「通关 / 在玩」", () => {
    expect(progressLabel("anime", "finished")).toBe("看完");
    expect(progressLabel("anime", "watching")).toBe("在看");
    expect(progressLabel("game", "cleared")).toBe("通关");
    expect(progressLabel("game", "playing")).toBe("在玩");
    expect(progressLabel("anime", "dropped")).toBe("弃坑");
    expect(progressLabel("game", "on_hold")).toBe("搁置");
  });
});

describe("筛选", () => {
  const entries = [
    entry({ id: "a", progress: "watching", rating: 8 }),
    entry({ id: "b", progress: "dropped", rating: null }),
    entry({ id: "c", progress: "watching", rating: null }),
  ];

  it("默认全部通过", () => {
    expect(filterEntries(entries, DEFAULT_FILTERS).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("按状态筛选", () => {
    expect(
      filterEntries(entries, { progress: "dropped", rated: "all" }).map((item) => item.id),
    ).toEqual(["b"]);
  });

  it("按「已评分 / 未评分」筛选（未评分是 null，不是 0）", () => {
    expect(filterEntries(entries, { progress: "", rated: "rated" }).map((i) => i.id)).toEqual(["a"]);
    expect(filterEntries(entries, { progress: "", rated: "unrated" }).map((i) => i.id)).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("类型字段归属（与后端 CHECK 同规则）", () => {
  it("追番不接受游戏字段", () => {
    expect(crossKindFields("anime", { platform: "PC" })).toEqual(["平台"]);
    expect(crossKindFields("anime", { platform: "", playtime_minutes: null })).toEqual([]);
  });

  it("游戏不接受追番字段", () => {
    expect(crossKindFields("game", { total_episodes: 12 })).toEqual(["总集数"]);
    expect(crossKindFields("game", { season: "   " })).toEqual([]);
  });
});

describe("长评与屏幕", () => {
  it("只有存在公开文章引用时才有链接", () => {
    expect(reviewHref(null)).toBeNull();
    expect(reviewHref({ id: "p", slug: "a b", title: "长评" })).toBe("/posts/a%20b");
  });

  it("只有 anime / game 是合法屏幕", () => {
    expect([...LEISURE_SCREENS]).toEqual(["anime", "game"]);
    expect(isLeisureScreen("anime")).toBe(true);
    expect(isLeisureScreen("game")).toBe(true);
    expect(isLeisureScreen("wish")).toBe(false);
    expect(isLeisureScreen(null)).toBe(false);
  });
});
