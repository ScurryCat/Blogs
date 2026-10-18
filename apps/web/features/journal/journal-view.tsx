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

import { useRef, useState, type ReactNode } from "react";

import { getCalendar, listAllEntries } from "./api";
import { CalendarPanel } from "./calendar-panel";
import { useScrollMemory } from "@/features/runtime/scroll-memory";
import { EntryCard } from "./entry-card";
import { EntryReadingLoader } from "./entry-reading-loader";
import { useLoader, type JournalHost } from "./host";
import styles from "./journal.module.css";
import { formatMonthLabel, isJournalScreen, parseCalendarDate } from "./paths";
import { JournalOwnerNewEntry } from "./owner-entry";
import { SaveScreen } from "./save-screen";
import { lastYear, rememberScreen, rememberYear } from "./state";
import type { JournalCalendar, JournalEntrySummary } from "./types";

const DEFAULT_SCREENS = ["list", "calendar"] as const;

export function JournalView({
  screen,
  item = null,
  host,
  screens = DEFAULT_SCREENS,
}: {
  screen: string | null;
  /** 详情标识：`screen="reading"` 时是要读的那篇手记 id。 */
  item?: string | null;
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

  // 「读取手记」作为**手机内屏幕**：留在手机里，不再跳独立路由（§3.3 手机内导航一致性）。
  if (active === "reading" && item) {
    return (
      <div className={styles.wrap} data-journal-screen="reading">
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.buttonGhost}`}
            type="button"
            onClick={() => changeScreen("list")}
          >
            返回存档列表
          </button>
        </div>
        <EntryReadingLoader entryId={item} />
      </div>
    );
  }

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
          {/* 页签只列「浏览方式」两屏；`reading` 是详情屏，不是页签。
              手机宿主允许的屏幕里含 reading，之前会把第三个页签也画成「日历」（重复且会切到没有 id 的详情屏）。 */}
          {allowed
            .filter((item) => item === "list" || item === "calendar")
            .map((item) => (
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
        {/* 站主快捷入口：仅 useOwnerSession 确认 owner 后渲染（匿名访客连占位都没有）。 */}
        <div className={styles.ownerActions} data-owner-actions="journal">
          <JournalOwnerNewEntry date={active === "calendar" ? selectedDay : null} />
        </div>
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
  // 列表滚动位置：从存档打开一条记录再返回时回到原处（任务书 §3.3/§4.3）。
  // 手机里滚的是 `.pw-screen`、独立页滚窗口 —— 容器判定由 useScrollMemory 统一处理。
  const listRef = useRef<HTMLUListElement | null>(null);
  useScrollMemory("journal.calendar.v1", state.status === "ready", {
    enabled: true,
    consume: true,
    containerRef: listRef,
  });

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

  /**
   * 日期锚点（第二轮 §4.3「让日期成为主要视觉锚点」）：
   * 选中日优先；没选中时锚定最近一篇公开手记的日期。它同时驱动右侧的大日期面板
   * 与日历里的高亮 —— 不新增第二次取数，也不改 URL/权限语义。
   */
  const anchorDay = selectedDay ?? entries[0]?.entry_date ?? null;
  const anchorParts = anchorDay ? parseCalendarDate(anchorDay) : null;
  const anchorEntries = anchorDay
    ? entries.filter((entry) => entry.entry_date === anchorDay)
    : [];
  const anchor = anchorEntries[0] ?? null;
  const openEntry = (entry: JournalEntrySummary) =>
    host.mode === "phone"
      ? host.changeScreen("reading", entry.id)
      : host.openContent({
          destination: `/apps/journal/${encodeURIComponent(entry.id)}`,
          source: "top-nav",
        });

  return (
    <>
      <div className={styles.actions}>
        <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={onBackToList}>
          返回存档列表
        </button>
        <span className={styles.hint}>日历只用来定位日期；读取仍在存档列表或下方条目里。</span>
      </div>
      <div className={styles.calendarLayout}>
        <aside
          className={styles.dayHero}
          data-journal-anchor={anchorDay ?? ""}
          aria-label="日期锚点"
        >
          <p className={styles.heroKicker}>{"// Date"}</p>
          {anchorParts ? (
            <>
              <div className={styles.heroDate}>
                <span className={styles.heroDay} aria-hidden="true">
                  {anchorParts.day}
                </span>
                <span className={styles.heroYm}>
                  {anchorParts.year}.{anchorParts.month}
                </span>
                <span className={styles.heroWeekday}>{anchorParts.weekday}</span>
              </div>
              <p className={styles.heroDateLine}>{anchorParts.label}</p>
              <p className={styles.heroMeta} role="status">
                {selectedDay
                  ? `选中日期 · ${anchorEntries.length} 篇公开手记`
                  : `最近记录 · 共 ${entries.length} 篇公开手记`}
              </p>
              {anchor ? (
                <>
                  <p className={styles.heroTitle}>{anchor.title}</p>
                  {anchor.excerpt ? (
                    <p className={styles.heroExcerpt}>{anchor.excerpt}</p>
                  ) : null}
                  <div className={styles.heroActions}>
                    <button
                      className={styles.readButton}
                      type="button"
                      onClick={() => openEntry(anchor)}
                    >
                      读取手记 <span aria-hidden="true">▸</span>
                    </button>
                    {selectedDay ? (
                      <button
                        className={`${styles.button} ${styles.buttonGhost}`}
                        type="button"
                        onClick={() => onSelectDay(null)}
                      >
                        显示全部
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className={styles.heroEmpty}>这一天没有公开的手记。</p>
              )}
            </>
          ) : (
            <p className={styles.heroEmpty}>
              还没有公开的手记：日期会保持空白，不会生成空存档或占位记录。
            </p>
          )}
        </aside>
        <div className={styles.calendarPane}>
          <CalendarPanel
            calendar={calendar}
            selectedDay={anchorDay}
            onPickDay={(day) => onSelectDay(day === selectedDay ? null : day)}
          />
        </div>
      </div>
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
        <ul className={styles.list} ref={listRef}>
          {visible.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onOpen={(target) =>
                host.mode === "phone"
                  ? host.changeScreen("reading", target.id)
                  : host.openContent({
                      destination: `/apps/journal/${encodeURIComponent(target.id)}`,
                      source: "top-nav",
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
