/**
 * 手记：前端类型（与 `contracts/openapi.json` 的 journal 端点一致）。
 *
 * 字段名沿用 API 的 snake_case（05 §2：前端生成类型也遵守，不手写另一套字段映射）。
 *
 * 两条与验收直接相关的约定：
 *  - `entry_date` 是 **YYYY-MM-DD 的日历日期字符串**，不是时刻。前端按字符串渲染
 *    （拆出年 / 月 / 日 / 星期），**不经过 `new Date(iso)`**，因此不存在「UTC 转成本地
 *    时区后错一天」的问题（验收 2）。
 *  - 公开 DTO 里**没有** `status` / `visibility`：公开界面不可能因为拿到了字段而
 *    误显示草稿或私密内容；管理 DTO 才有它们。
 */

/** 图片变体（与 media 模块的 `MediaVariantOut` 同形）。 */
export interface MediaVariant {
  name: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface JournalImage {
  media_id: string;
  position: number;
  alt: string;
  width: number;
  height: number;
  variants: MediaVariant[];
}

/** 可选长文引用。公开端点只给公开文章；`post` 为 null 表示没有可展示的引用。 */
export interface JournalPostRef {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  public: boolean;
}

/** 存档卡式列表项。 */
export interface JournalEntrySummary {
  id: string;
  /** YYYY-MM-DD（日历日期）。 */
  entry_date: string;
  title: string;
  excerpt: string;
  mood: string;
  location: string;
  images: JournalImage[];
}

export interface JournalEntryDetail extends JournalEntrySummary {
  content_md: string;
  post: JournalPostRef | null;
}

export interface JournalEntryList {
  items: JournalEntrySummary[];
  next_cursor: string | null;
}

export interface JournalCalendarMonth {
  /** YYYY-MM。 */
  month: string;
  /** YYYY-MM-DD → 当天公开记录数。**只含真正公开的记录**。 */
  days: Record<string, number>;
}

export interface JournalCalendar {
  months: JournalCalendarMonth[];
  total_entries: number;
  /** 明确展示时区（服务端给出），界面会如实标注。 */
  timezone: string;
  /** 服务端按展示时区算出的「今天」（验收 2）。 */
  today: string;
}

// --- 管理 DTO（只在 /admin/journal 使用） -----------------------------------

export type JournalStatus = "draft" | "published";
export type JournalVisibility = "private" | "public";

export interface JournalAdminImage {
  media_id: string;
  position: number;
  alt: string;
  width: number;
  height: number;
  /** 这张图是否**仍然**有别的公开引用（切私密不会撤回它，05 §11）。 */
  still_public: boolean;
}

export interface JournalAdminEntry {
  id: string;
  entry_date: string;
  title: string;
  content_md: string;
  mood: string;
  location: string;
  status: JournalStatus;
  visibility: JournalVisibility;
  post: JournalPostRef | null;
  images: JournalAdminImage[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  /** 服务端按公开条件实时判定的结论，前端不自己算一套。 */
  public: boolean;
  /** 这些图即使本篇转私密也仍然公开（管理端必须如实提示）。 */
  shared_media: string[];
}

export interface JournalAdminList {
  items: JournalAdminEntry[];
  next_cursor: string | null;
}

export interface JournalWriteInput {
  entry_date: string;
  title: string;
  content_md: string;
  mood: string;
  location: string;
  post_id?: string | null;
  images: { media_id: string; position: number; alt: string }[];
}

/** PATCH：只提交出现过的字段。 */
export type JournalPatch = Partial<JournalWriteInput>;

// --- 心情与展示标签（界面共用一份，避免三处各写一遍） -----------------------

/** 站主可以自填心情；这几个只是快捷选项，不是枚举约束（后端是自由文本）。 */
export const MOOD_PRESETS: readonly string[] = [
  "平静",
  "不错",
  "疲惫",
  "兴奋",
  "低落",
  "专注",
];

export const WEEKDAY_LABELS: readonly string[] = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
];

export const MOOD_MAX_CODEPOINTS = 24;
export const TITLE_MAX_CODEPOINTS = 200;
export const LOCATION_MAX_CODEPOINTS = 80;
export const IMAGES_MAX = 9;
