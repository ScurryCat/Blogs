"use client";

/**
 * 手记主视图（07 §3）：列表 / 日历两种浏览方式，同一份数据。
 *
 * 手机内置应用与独立页渲染的是**同一个** `JournalView`，只是宿主不同
 * （见 `phone-app.tsx` / `standalone.tsx`）。
 *
 * 硬规则：
 *  - 列表与日历都用公开端点，因此天然看不到草稿与私密记录（服务端条件，不是前端过滤）；
 *  - 日历只标记真正有公开记录的日期；空日期不做任何装饰（验收 2）；
 *  - 默认落在**有内容的浏览方式**上，而不是一个需要先猜的空屏：有公开记录就是列表。
 */

import { useMemo, useState, type ReactNode } from "react";

import { getCalendar, listAllEntries } from "./api";
import { CalendarPanel } from "./calendar-panel";
import { EntryCard } from "./entry-card";
import { useLoader, type JournalHost } from "./host";
import styles from "./journal.module.css";
import { formatMonthLabel, isJournalScreen } from "./paths";
import type { JournalCalendar, JournalEntrySummary } from "./types";

const DEFAULT_SCREENS = ["list", "calendar"] as const;

export function JournalView({
  screen,
  host,
  screens = DEFAULT_SCREENS,
}: {
  screen: string | null;
  host: JournalHost;
  /** 允许的屏幕集合（手机宿主用它回退非法值，独立页也可以收窄）。 */
  screens?: readonly string[];
}): ReactNode {
  const allowed = screens.length ? screens : DEFAULT_SCREENS;
  const active = isJournalScreen(screen) && allowed.includes(screen) ? screen : allowed[0];
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  return (
    <div className={styles.wrap} data-journal-screen={active}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Journal"}</p>
          <h2 className={styles.title}>手记</h2>
          <p className={styles.lead}>
            按日期记下这一天：心情、地点、一段话，可以配几张照片。列表与日历读的是同一份记录，
            只有已发布且设为公开的手记会出现在这里。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="浏览方式">
          {allowed.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.tab}
              aria-current={item === active ? "true" : undefined}
              onClick={() => host.changeScreen(item)}
            >
              {item === "list" ? "存档卡列表" : "日历"}
            </button>
          ))}
        </nav>
      </header>

      {active === "calendar" ? (
        <CalendarScreen host={host} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      ) : (
        <ListScreen host={host} />
      )}
    </div>
  );
}

function ListScreen({ host }: { host: JournalHost }): ReactNode {
  const { state, reload } = useLoader((signal) => listAllEntries({}, signal), ["list"]);
  const [year, setYear] = useState<string>("");

  const items = useMemo(() => (state.status === "ready" ? state.data : []), [state]);
  const years = useMemo(
    () => [...new Set(items.map((item) => item.entry_date.slice(0, 4)))].sort().reverse(),
    [items],
  );
  const filtered = year ? items.filter((item) => item.entry_date.startsWith(year)) : items;
  const grouped = groupByMonth(filtered);

  return (
    <>
      {state.status === "loading" ? (
        <p className={styles.empty} role="status">
          正在读取手记…
        </p>
      ) : null}

      {state.status === "failed" ? (
        <div className={styles.empty} role="alert">
          <p>{state.failure.message}</p>
          <button className={styles.button} type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      ) : null}

      {state.status === "ready" && !items.length ? (
        <p className={styles.empty}>
          还没有公开的手记。站主可以在 <code>/admin/journal</code> 写下第一篇 ——
          新建的默认是草稿且仅自己可见，要发布并设为公开后才会出现在这里。
        </p>
      ) : null}

      {items.length ? (
        <div className={styles.actions}>
          <label className={styles.label} htmlFor="journal-year">
            年份
          </label>
          <select
            id="journal-year"
            className={styles.select}
            value={year}
            onChange={(event) => setYear(event.target.value)}
            style={{ maxWidth: "10em" }}
          >
            <option value="">全部</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <span className={styles.hint}>共 {filtered.length} 篇</span>
        </div>
      ) : null}

      {grouped.map(([month, entries]) => (
        <section key={month} aria-label={formatMonthLabel(month)}>
          <h3 className={styles.monthTitle}>{formatMonthLabel(month)}</h3>
          <ul className={styles.cards}>
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onOpen={(target) =>
                  host.openContent({
                    destination: `/apps/journal/${encodeURIComponent(target.id)}`,
                    source: "phone-link",
                  })
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function CalendarScreen({
  host,
  selectedDay,
  onSelectDay,
}: {
  host: JournalHost;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}): ReactNode {
  const { state, reload } = useLoader(
    (signal) => Promise.all([getCalendar({}, signal), listAllEntries({}, signal)]),
    ["calendar"],
  );

  if (state.status === "loading") {
    return (
      <p className={styles.empty} role="status">
        正在读取日历…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div className={styles.empty} role="alert">
        <p>{state.failure.message}</p>
        <button className={styles.button} type="button" onClick={reload}>
          重新读取
        </button>
      </div>
    );
  }

  const [calendar, entries]: [JournalCalendar, JournalEntrySummary[]] = state.data;
  const visible = selectedDay
    ? entries.filter((entry) => entry.entry_date === selectedDay)
    : entries;

  return (
    <>
      <CalendarPanel
        calendar={calendar}
        onPickDay={(day) => onSelectDay(day === selectedDay ? null : day)}
      />
      {selectedDay ? (
        <div className={styles.actions}>
          <p className={styles.hint} role="status">
            只看 {selectedDay}（{visible.length} 篇）
          </p>
          <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={() => onSelectDay(null)}>
            显示全部
          </button>
        </div>
      ) : null}
      {visible.length ? (
        <ul className={styles.cards}>
          {visible.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onOpen={(target) =>
                host.openContent({
                  destination: `/apps/journal/${encodeURIComponent(target.id)}`,
                  source: "phone-link",
                })
              }
            />
          ))}
        </ul>
      ) : selectedDay ? (
        <p className={styles.empty}>这一天没有公开的手记。</p>
      ) : null}
    </>
  );
}

function groupByMonth(items: readonly JournalEntrySummary[]): [string, JournalEntrySummary[]][] {
  const groups = new Map<string, JournalEntrySummary[]>();
  for (const item of items) {
    const month = item.entry_date.slice(0, 7);
    const bucket = groups.get(month);
    if (bucket) bucket.push(item);
    else groups.set(month, [item]);
  }
  return [...groups.entries()];
}
