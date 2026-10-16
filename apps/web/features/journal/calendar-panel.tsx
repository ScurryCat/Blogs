"use client";

/**
 * 公开日历（07 §3、验收 2）。
 *
 * 硬规则：
 *  - **只有真正公开的记录才有标记**：数据来自 `GET /journal/calendar`，它只聚合
 *    `published + public + 未删除 + 日期不晚于展示时区今天` 的记录；
 *  - **空白日期就是空白**：不生成「未完成任务」，也不显示「有 N 篇隐藏记录」；
 *  - 与服务端一致，`today` 与 `timezone` 都由 API 给出并在界面上如实标注，
 *    前端不自己用本地时区猜「今天」。
 */

import type { ReactNode } from "react";

import { formatMonthLabel, monthGrid } from "./paths";
import styles from "./journal.module.css";
import type { JournalCalendar } from "./types";

const WEEKDAY_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarPanel({
  calendar,
  onPickDay,
  onReadEntry,
}: {
  calendar: JournalCalendar;
  onPickDay?: (day: string) => void;
  /** 点某个有记录的日期时，直接进入那一天的第一篇（可选）。 */
  onReadEntry?: (entryId: string) => void;
}): ReactNode {
  if (!calendar.months.length) {
    return (
      <p className={styles.empty} role="status">
        这段时间还没有公开的手记。空白日期不会显示成「未完成」—— 没有记录就是没有记录。
      </p>
    );
  }

  return (
    <div data-journal-calendar={calendar.timezone}>
      <p className={styles.hint}>
        标记只出现在真正有公开手记的日期上（共 {calendar.total_entries} 篇）。日期按{" "}
        <code>{calendar.timezone}</code> 计算，今天是 {calendar.today}。
      </p>
      <div className={styles.calendarMonths}>
        {calendar.months.map((month) => (
          <section className={styles.month} key={month.month} aria-label={formatMonthLabel(month.month)}>
            <h3 className={styles.monthTitle}>{formatMonthLabel(month.month)}</h3>
            <div className={styles.grid} role="grid">
              {WEEKDAY_HEADS.map((label) => (
                <span className={styles.weekday} key={label} role="columnheader">
                  {label}
                </span>
              ))}
              {monthGrid(month.month).map((day, index) => {
                if (!day) {
                  return <span className={styles.dayEmpty} key={`empty-${index}`} aria-hidden="true" />;
                }
                const count = month.days[day] ?? 0;
                const dayNumber = Number(day.slice(8, 10));
                const isToday = day === calendar.today;
                if (!count) {
                  return (
                    <span
                      className={`${styles.day} ${isToday ? styles.dayToday : ""}`}
                      key={day}
                      role="gridcell"
                      data-day={day}
                      data-count="0"
                    >
                      {dayNumber}
                    </span>
                  );
                }
                return (
                  <button
                    type="button"
                    className={`${styles.day} ${styles.dayHasEntry} ${isToday ? styles.dayToday : ""}`}
                    key={day}
                    role="gridcell"
                    data-day={day}
                    data-count={count}
                    aria-label={`${day}，${count} 篇公开手记`}
                    onClick={() => {
                      onPickDay?.(day);
                      onReadEntry?.(day);
                    }}
                  >
                    {dayNumber}
                    {count > 1 ? <span className={styles.dayCount}>{count}</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
