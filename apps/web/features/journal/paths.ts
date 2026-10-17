/**
 * 手记的路径工具与日期展示（**纯函数**，服务端组件也能安全导入）。
 *
 * ⚠️ 这个模块**不导入 React**。上一轮（T04）的教训：服务端组件导入一个含 Hook 的模块
 * 会让 `next build` 直接失败，而 `tsc` 不报错。需要 Hook 的部分放在 `host.ts`。
 *
 * 日期规则（验收 2）：`entry_date` 是 `YYYY-MM-DD` 字符串，**不经过 `new Date()`**。
 * 用 `Date.UTC(...)` 构造只为了算「星期几」这一个与时刻无关的属性 —— UTC 与本地
 * 时区对同一个日历日期的星期几结论一致，因此不会错一天。
 */

import type { JournalImage, MediaVariant } from "./types";

/** 独立页的 canonical 路径。 */
export const JOURNAL_PATH = "/apps/journal";

/** 手机与独立页共用的屏幕集合。 */
export const JOURNAL_SCREENS = ["list", "calendar", "reading"] as const;
export type JournalScreen = (typeof JOURNAL_SCREENS)[number];

export function isJournalScreen(value: string | null | undefined): value is JournalScreen {
  // 按屏幕集合判断，避免新增屏幕时忘了同步这里（加 reading 时踩过一次：URL 对了但视图
  // 仍判定为非法、回退到 list）。
  return typeof value === "string" && (JOURNAL_SCREENS as readonly string[]).includes(value);
}

export function entryPath(entryId: string): string {
  return `${JOURNAL_PATH}/${encodeURIComponent(entryId)}`;
}

/** `YYYY-MM-DD` → 拆好的展示片段。非法输入原样返回，界面不因为脏数据崩掉。 */
export interface CalendarParts {
  year: string;
  month: string;
  day: string;
  weekday: string;
  /** 「2026 年 10 月 16 日 周五」 */
  label: string;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function parseCalendarDate(value: string): CalendarParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const [, year, month, day] = match as unknown as [string, string, string, string];
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return null;
  // 只用于取星期几：UTC 与本地时区对同一个日历日期的星期结论一致。
  const stamp = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
  if (Number.isNaN(stamp.getTime())) return null;
  const weekday = WEEKDAYS[stamp.getUTCDay()] ?? "";
  return {
    year,
    month,
    day,
    weekday,
    label: `${numericYear} 年 ${numericMonth} 月 ${numericDay} 日 ${weekday}`,
  };
}

/** 展示用的短日期：`10/16 周五`。 */
export function formatEntryDate(value: string): string {
  const parts = parseCalendarDate(value);
  if (!parts) return value;
  return `${Number(parts.month)}/${Number(parts.day)} ${parts.weekday}`;
}

/** 月份标题：`2026-10` → `2026 年 10 月`。 */
export function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec((month ?? "").trim());
  if (!match) return month;
  return `${Number(match[1])} 年 ${Number(match[2])} 月`;
}

/** 月份里的日期网格（周一起始），`null` 表示空位。 */
export function monthGrid(month: string): (string | null)[] {
  const match = /^(\d{4})-(\d{2})$/.exec((month ?? "").trim());
  if (!match) return [];
  const year = Number(match[1]);
  const numericMonth = Number(match[2]);
  if (numericMonth < 1 || numericMonth > 12) return [];
  const first = new Date(Date.UTC(year, numericMonth - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, numericMonth, 0)).getUTCDate();
  // 周一 = 0：把 JS 的「周日 = 0」平移过来。
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`);
  }
  // 末尾补齐到整周：否则最后一行会比上面几行少几格，网格视觉上会错位。
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 图片的最佳可用变体：`w640` → `w320` → `w1280` → 第一个。 */
export function bestVariant(image: JournalImage): MediaVariant | null {
  const byName = new Map(image.variants.map((variant) => [variant.name, variant]));
  for (const name of ["w640.webp", "w320.webp", "w1280.webp"]) {
    const found = byName.get(name);
    if (found) return found;
  }
  return image.variants[0] ?? null;
}

export function imageUrl(image: JournalImage): string | null {
  const variant = bestVariant(image);
  return variant ? variant.url : null;
}

/** 把图片顺序规整成 0..n-1（服务端要求连续唯一；界面拖动后本地也保持这个不变量）。 */
export function normalizePositions(
  images: { media_id: string; alt: string }[],
): { media_id: string; position: number; alt: string }[] {
  return images.map((image, index) => ({ ...image, position: index }));
}
