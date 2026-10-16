/**
 * P5 日历 / 时段标签 —— 旧站 `assets/js/core.js` 的 `cal` / `slotOf` 迁移。
 * DOM 形状与类名保持一致（`.cal` / `.cal-md` / `.cal-wd` / `.cal-slot`），样式沿用旧站 CSS。
 */

import type { ReactNode } from "react";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** `2026-10-16` → 本地日期（不做时区换算，与旧站一致）。 */
export function toDate(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** 按小时落到 P5 的时间段。 */
export function slotOf(hour: number): string {
  if (hour < 5) return "LATE NIGHT";
  if (hour < 8) return "EARLY MORNING";
  if (hour < 12) return "MORNING";
  if (hour < 15) return "LUNCHTIME";
  if (hour < 18) return "AFTER SCHOOL";
  return "EVENING";
}

export interface CalendarProps {
  /** `YYYY-MM-DD` 或 Date。 */
  date: string | Date;
  /** 覆盖时段文字（旧站用分类名代替时段）。 */
  slot?: string;
}

export function Calendar({ date, slot }: CalendarProps): ReactNode {
  const value = typeof date === "string" ? toDate(date) : date;
  const weekday = value.getDay();
  const label = `${value.getFullYear()} 年 ${value.getMonth() + 1} 月 ${value.getDate()} 日`;
  return (
    <time className="cal" dateTime={toIso(value)}>
      <span className="sr-only">{label}</span>
      <span className="cal-md" aria-hidden="true">
        {value.getMonth() + 1}
        <s>/</s>
        {value.getDate()}
      </span>
      <span className={`cal-wd${weekday % 6 === 0 ? " we" : ""}`} aria-hidden="true">
        {WEEKDAYS[weekday]}
      </span>
      <span className="cal-slot" aria-hidden="true">
        {slot ?? slotOf(value.getHours())}
      </span>
    </time>
  );
}
