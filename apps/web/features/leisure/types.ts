/**
 * 放课后：前端类型（与 `contracts/openapi.json` 的 leisure 端点一致）。
 *
 * 字段名沿用 API 的 snake_case（05 §2）。三条与验收 3 直接相关的展示约定由
 * **服务端**给出结论，前端只搬运，不自己算：
 *
 *  - `anime.episodes_label`：总数未知时是「看到第 6 集」，不带百分比；
 *  - `anime.completion_ratio`：总数未知时是 `null` —— 前端**不得**用 0 或 1 代替；
 *  - `rating: null` 表示**未评分**，不是 0 分。
 *
 * 另外：`completed_on`（通关）与 `all_achievements`（全成就）是两个独立字段，
 * 界面不得由一个推导另一个（07 §3）。
 */

export type LeisureKind = "anime" | "game";
export type LeisureStatus = "draft" | "published";

export interface MediaVariant {
  name: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface LeisureCover {
  id: string;
  width: number;
  height: number;
  variants: MediaVariant[];
}

export interface AnimeProgress {
  season: string | null;
  episodes_watched: number | null;
  total_episodes: number | null;
  last_watched_on: string | null;
  airing: boolean | null;
  /** 人类可读的进度标签（总数未知时不带百分比）。 */
  episodes_label: string;
  /** 总数未知 → null。前端**不得**把 null 显示成 0%。 */
  completion_ratio: number | null;
}

export interface GameProgress {
  platform: string;
  started_on: string | null;
  completed_on: string | null;
  playtime_minutes: number | null;
  playtime_label: string;
  /** `null` = 没有记录（不是「明确没拿到」）。 */
  all_achievements: boolean | null;
}

export interface ReviewRef {
  id: string;
  slug: string;
  title: string;
}

export interface LeisureEntry {
  id: string;
  kind: LeisureKind;
  title: string;
  progress: string;
  progress_label: string;
  rating: number | null;
  notes: string;
  notes_have_spoilers: boolean;
  cover: LeisureCover | null;
  anime: AnimeProgress | null;
  game: GameProgress | null;
  review: ReviewRef | null;
  updated_at: string;
}

export interface LeisureList {
  items: LeisureEntry[];
  next_cursor: string | null;
}

// --- 管理 DTO（只在 /admin/leisure 使用） -----------------------------------

export interface LeisureAdminEntry extends LeisureEntry {
  review_post_id: string | null;
  status: LeisureStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  public: boolean;
}

export interface LeisureWriteInput {
  kind: LeisureKind;
  title: string;
  progress?: string | null;
  rating?: number | null;
  notes?: string;
  notes_have_spoilers?: boolean;
  cover_media_id?: string | null;
  review_post_id?: string | null;
  season?: string | null;
  total_episodes?: number | null;
  episodes_watched?: number | null;
  last_watched_on?: string | null;
  airing?: boolean | null;
  platform?: string;
  playtime_minutes?: number | null;
  started_on?: string | null;
  completed_on?: string | null;
  all_achievements?: boolean | null;
}

export type LeisurePatch = Partial<Omit<LeisureWriteInput, "kind">>;

// --- 界面枚举与上限（与后端一致，避免两处各写一套） -------------------------

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const TITLE_MAX_CODEPOINTS = 200;
export const NOTES_MAX_CODEPOINTS = 1000;
export const PLATFORM_MAX_CODEPOINTS = 80;
export const EPISODES_MAX = 10000;
export const PLAYTIME_MAX_MINUTES = 100000;

export const PROGRESS_OPTIONS: Record<LeisureKind, readonly { value: string; label: string }[]> = {
  anime: [
    { value: "wish", label: "想看" },
    { value: "watching", label: "在看" },
    { value: "finished", label: "看完" },
    { value: "on_hold", label: "搁置" },
    { value: "dropped", label: "弃坑" },
  ],
  game: [
    { value: "wish", label: "想玩" },
    { value: "playing", label: "在玩" },
    { value: "cleared", label: "通关" },
    { value: "on_hold", label: "搁置" },
    { value: "dropped", label: "弃坑" },
  ],
};

export const KIND_LABELS: Record<LeisureKind, string> = {
  anime: "追番",
  game: "游戏",
};
