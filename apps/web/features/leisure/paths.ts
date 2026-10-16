/**
 * 放课后的路径、筛选与**展示规则**（纯函数，服务端组件也能安全导入）。
 *
 * ⚠️ 这个模块**不导入 React**（T04 的教训：服务端组件导入含 Hook 的模块会让
 * `next build` 失败，而 `tsc` 不报错）。需要 Hook 的部分放在 `host.ts`。
 *
 * 这里的函数是**服务端结论的兜底镜像**，不是第二套权威：
 *  - 优先使用 API 给出的 `episodes_label` / `playtime_label` / `progress_label`；
 *  - 只有当 API 没有给（例如管理端本地预览）时才用这里的函数，且规则必须与
 *    `apps/api/app/modules/leisure/rules.py` 完全一致 —— 两边的用例钉住了同一条规则。
 */

import type { LeisureEntry, LeisureKind, ReviewRef } from "./types";

export const LEISURE_PATH = "/apps/leisure";
export const LEISURE_SCREENS = ["anime", "game"] as const;
export type LeisureScreen = (typeof LEISURE_SCREENS)[number];

export function isLeisureScreen(value: string | null | undefined): value is LeisureScreen {
  return value === "anime" || value === "game";
}

export function progressLabel(kind: LeisureKind, progress: string): string {
  const table: Record<LeisureKind, Record<string, string>> = {
    anime: { wish: "想看", watching: "在看", finished: "看完", on_hold: "搁置", dropped: "弃坑" },
    game: { wish: "想玩", playing: "在玩", cleared: "通关", on_hold: "搁置", dropped: "弃坑" },
  };
  return table[kind][progress] ?? progress;
}

/**
 * 集数标签。**总数未知时绝不产生百分比**（验收 3）。
 * 与后端 `rules.episodes_label` 同规则。
 */
export function episodesLabel(watched: number | null, total: number | null): string {
  if (watched === null && total === null) return "还没记录进度";
  if (watched === null) return `共 ${total} 集`;
  if (total === null) return `看到第 ${watched} 集`;
  return `看到第 ${watched} / ${total} 集`;
}

/** 完成率。总数未知 / 非正 / 集数未知 → `null`（界面不得显示 0%）。 */
export function completionRatio(watched: number | null, total: number | null): number | null {
  if (watched === null || total === null || total <= 0) return null;
  return Math.round((Math.min(watched, total) / total) * 10000) / 10000;
}

/** 时长标签。未填就是「未记录时长」，不显示 0 小时。与后端 `rules.playtime_label` 同规则。 */
export function playtimeLabel(minutes: number | null): string {
  if (minutes === null) return "未记录时长";
  const value = Math.max(0, Math.trunc(minutes));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours && rest) return `${hours} 小时 ${rest} 分`;
  if (hours) return `${hours} 小时`;
  return `${rest} 分`;
}

/** 评分展示：未评分就写「未评分」，**不写 0 分**。 */
export function ratingLabel(rating: number | null): string {
  return rating === null ? "未评分" : `${rating} / 10`;
}

/** 长评链接（只有公开文章才有 href）。 */
export function reviewHref(review: ReviewRef | null): string | null {
  return review ? `/posts/${encodeURIComponent(review.slug)}` : null;
}

/** 排序用：`updated_at` 新的在前（与后端一致）。 */
export function byUpdatedDesc(a: LeisureEntry, b: LeisureEntry): number {
  if (a.updated_at === b.updated_at) return a.id.localeCompare(b.id) > 0 ? -1 : 1;
  return a.updated_at < b.updated_at ? 1 : -1;
}

export interface LeisureFilters {
  /** 空字符串表示「全部状态」。 */
  progress: string;
  /** 只看有评分的 / 只看未评分的 / 全部。 */
  rated: "all" | "rated" | "unrated";
}

export const DEFAULT_FILTERS: LeisureFilters = { progress: "", rated: "all" };

export function filterEntries(
  entries: readonly LeisureEntry[],
  filters: LeisureFilters,
): LeisureEntry[] {
  return entries.filter((entry) => {
    if (filters.progress && entry.progress !== filters.progress) return false;
    if (filters.rated === "rated" && entry.rating === null) return false;
    if (filters.rated === "unrated" && entry.rating !== null) return false;
    return true;
  });
}

/** 这个类型的记录上，哪些字段是「另一类型专属」（与后端 CHECK 同规则，用于本地提示）。 */
export function crossKindFields(kind: LeisureKind, values: Record<string, unknown>): string[] {
  const animeOnly = ["season", "total_episodes", "episodes_watched", "last_watched_on", "airing"];
  const gameOnly = ["platform", "playtime_minutes", "started_on", "completed_on", "all_achievements"];
  const labels: Record<string, string> = {
    season: "季度",
    total_episodes: "总集数",
    episodes_watched: "已看集数",
    last_watched_on: "最近观看日期",
    airing: "连载中",
    platform: "平台",
    playtime_minutes: "时长",
    started_on: "开始日期",
    completed_on: "完成日期",
    all_achievements: "全成就",
  };
  const forbidden = kind === "anime" ? gameOnly : animeOnly;
  return forbidden
    .filter((name) => {
      const value = values[name];
      if (value === null || value === undefined) return false;
      return !(typeof value === "string" && value.trim() === "");
    })
    .map((name) => labels[name] ?? name);
}
