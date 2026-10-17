"use client";

/**
 * 手记主视图（第三轮任务书 §3）：**默认是游戏存档式列表**，日历降为辅助定位。
 *
 * 手机内置应用与独立页渲染的是**同一个** `JournalView`，只是宿主不同
 * （见 `phone-app.tsx` / `standalone.tsx`）；手机紧凑视图的宽度与字号由 CSS 处理，
 * 业务逻辑不复制第二套。
 *
 * 硬规则：
 *  - 列表与日历都用公开端点，因此天然看不到草稿与私密记录（服务端条件，不是前端过滤）；
 *  - 只有真实公开记录才有存档槽与编号，**不补空存档、不造等级 / 地点 / 游玩时长**；
 *  - 日历只标记真正有公开记录的日期；空日期不做任何装饰（验收 2）；
 *  - 日期按 `entry_date` 字符串渲染，不经过 `new Date(iso)` 的时区换算（不会错一天）；
 *  - 屏幕、年份筛选与选中槽位都记在本机状态里，切屏 / 从正文返回时恢复。
 */

import { useState, type ReactNode } from "react";

import { getCalendar, listAllEntries } from "./api";
import { CalendarPanel } from "./calendar-panel";
import { EntryCard } from "./entry-card";
import { useLoader, type JournalHost } from "./host";
import styles from "./journal.module.css";
import { formatMonthLabel, isJournalScreen } from "./paths";
import { SaveScreen } from "./save-screen";
import { lastYear, rememberScreen, rememberYear } from "./state";
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
  // 日历与存档列表共用的「日期定位」：从日历选中的某一天。
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // 年份筛选提升到这一层：切到日历再回来时保持筛选（返回位置的一部分）。
  const [year, setYear] = useState<string>(() => lastYear(host.state) ?? "");

  const changeScreen = (next: string) => {
    rememberScreen(host.state, next);
    host.changeScreen(next);
  };

  const changeYear = (next: string) => {
    setYear(next);
    rememberYear(host.state, next);
  };

  return (
    <div className={styles.wrap} data-journal-screen={active} data-journal-mode={host.mode}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Journal"}</p>
          <h2 className={styles.title}>手记</h2>
          <p className={styles.lead}>
            以游戏存档的方式翻手记：编号只是列表顺序，选中后先看预览，再「读取手记」进入完整正文。
            只有已发布且设为公开的手记会出现在这里；草稿与私密记录不会露出条数或占位。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="浏览方式">
          {allowed.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.tab}
              aria-current={item === active ? "true" : undefined}
              onClick={() => changeScreen(item)}
            >
              {item === "list" ? "存档列表" : "日历"}
            </button>
          ))}
        </nav>
      </header>

      {active === "calendar" ? (
        <CalendarScreen
          host={host}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onBackToList={() => changeScreen("list")}
        />
      ) : (
        <SaveScreen
          host={host}
          year={year}
          onYearChange={changeYear}
          onLocateDay={(day) => {
            setSelectedDay(day);
            changeScreen("calendar");
          }}
        />
      )}
    </div>
  );
}

function CalendarScreen({
  host,
  selectedDay,
  onSelectDay,
  onBackToList,
}: {
  host: JournalHost;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onBackToList: () => void;
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
      <div className={styles.actions}>
        <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={onBackToList}>
          返回存档列表
        </button>
        <span className={styles.hint}>日历只用来定位日期；读取仍在存档列表或下方条目里。</span>
      </div>
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
