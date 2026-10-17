"use client";

/**
 * 游戏存档式手记列表（第三轮任务书 §3.2 / 验收 §8.1）。
 *
 * 布局与数据规则：
 *  - **默认就是存档列表**：每行对应一篇真实公开手记（日期 / 标题 / 摘要），
 *    左侧 `No.01…` 只是**当前显示顺序**，不是数据库 ID，也不限制为游戏里的固定数量；
 *  - 选中槽位后在右侧（窄屏在下方）显示预览；「读取手记」才进入现有完整正文页，
 *    访客不会在这里看到发布 / 编辑入口（那是管理端的事）；
 *  - 不补空存档、不造等级 / 地点 / 游玩时长：真实缺失的信息（没写心情、没放图）
 *    直接不渲染，或用明确的空态说明；
 *  - 日期沿用 `parseCalendarDate` 的字符串语义，**不经过 `new Date(iso)` 的时区换算**，
 *    因此不会因为本地时区错一天；
 *  - 选中位置与年份筛选写进宿主本机状态（`state.ts`），从正文返回时恢复；
 *  - 手机紧凑视图与独立页渲染同一个组件，差别只由 `host.mode` 决定读取入口的宿主调用。
 */

import { useScrollMemory } from "@/features/runtime/scroll-memory";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { listAllEntries } from "./api";
import { useLoader, type JournalHost } from "./host";
import styles from "./journal.module.css";
import { entryPath, imageUrl, parseCalendarDate } from "./paths";
import { lastEntry, lastYear, rememberEntry, rememberYear } from "./state";
import type { JournalEntrySummary } from "./types";

/** 显示编号：`No.01`（补零只是为了对齐好看，不是 ID、也不封顶）。 */
export function slotNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** 只有真实公开记录才有编号；空列表不生成「空存档位」。 */
export function SaveScreen({
  host,
  year,
  onYearChange,
  onLocateDay,
}: {
  host: JournalHost;
  year: string;
  onYearChange: (year: string) => void;
  /** 「在日历中定位」：切到日历并选中这一天（任务书 §3.2 的日期定位）。 */
  onLocateDay: (day: string) => void;
}): ReactNode {
  const { state, reload } = useLoader((signal) => listAllEntries({}, signal), ["list"]);
  // 「返回位置」只在首次渲染读一次：之后由用户选择覆盖，不在 effect 里 setState。
  const [rememberedId] = useState<string | null>(() => lastEntry(host.state));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  // 存档列表的滚动位置：打开一条记录再返回时回到原处（任务书 §3.3）。
  useScrollMemory("journal.save.v1", state.status === "ready", {
    enabled: true,
    consume: true,
    containerRef: listRef,
  });

  const items = useMemo(() => (state.status === "ready" ? state.data : []), [state]);
  const years = useMemo(
    () => [...new Set(items.map((item) => item.entry_date.slice(0, 4)))].sort().reverse(),
    [items],
  );
  const filtered = useMemo(
    () => (year ? items.filter((item) => item.entry_date.startsWith(year)) : items),
    [items, year],
  );

  // 默认选中第一篇；从正文返回时优先恢复记忆里的那篇（仍在当前筛选结果里才算数）。
  const preferredId = selectedId ?? rememberedId;
  const selected =
    (preferredId ? filtered.find((entry) => entry.id === preferredId) : undefined) ??
    filtered[0] ??
    null;
  const selectedIndex = selected
    ? filtered.findIndex((entry) => entry.id === selected.id)
    : -1;

  const selectedForEffect = selected?.id ?? null;
  useEffect(() => {
    if (selectedForEffect) rememberEntry(host.state, selectedForEffect);
  }, [selectedForEffect, host.state]);

  const focusSlot = useCallback((index: number) => {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    nodes?.[index]?.focus();
  }, []);

  const openReading = useCallback(
    (entry: JournalEntrySummary) => {
      rememberEntry(host.state, entry.id);
      host.openContent({
        destination: entryPath(entry.id),
        source: host.mode === "phone" ? "phone-link" : "top-nav",
      });
    },
    [host],
  );

  /** 指针选中时，窄屏把预览带进视口（键盘选中不滚动，焦点留在槽位上）。 */
  const selectByPointer = useCallback((entry: JournalEntrySummary) => {
    setSelectedId(entry.id);
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    previewRef.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      if (!filtered.length) return;
      const current = selected ? filtered.findIndex((entry) => entry.id === selected.id) : -1;
      let next: number | null = null;
      if (event.key === "ArrowDown") next = Math.min(filtered.length - 1, current + 1);
      else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = filtered.length - 1;
      else if (event.key === "Enter" || event.key === " ") {
        if (!selected) return;
        event.preventDefault();
        openReading(selected);
        return;
      } else {
        return;
      }
      event.preventDefault();
      const target = filtered[next];
      if (!target) return;
      setSelectedId(target.id);
      focusSlot(next);
    },
    [filtered, selected, openReading, focusSlot],
  );

  if (state.status === "loading") {
    return (
      <p className={styles.empty} role="status">
        正在读取手记…
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

  if (!items.length) {
    return (
      <p className={styles.empty}>
        还没有公开的手记。站主可以在 <code>/admin/journal</code> 写下第一篇 ——
        新建的默认是草稿且仅自己可见，要发布并设为公开后才会出现在这里。
        没有记录时这里不会有任何空存档位。
      </p>
    );
  }

  return (
    <>
      <div className={styles.saveToolbar}>
        <div className={styles.saveHeading} aria-hidden="true">
          <span className={styles.saveKicker}>SAVE DATA</span>
          <span className={styles.saveTitle}>存档列表</span>
        </div>
        <div className={styles.actions}>
          <label className={styles.label} htmlFor="journal-year">
            年份
          </label>
          <select
            id="journal-year"
            className={styles.select}
            value={year}
            onChange={(event) => onYearChange(event.target.value)}
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
      </div>

      <p className={styles.hint} id="journal-save-help">
        编号只是当前显示顺序（不是数据库 ID）。点选或用 <kbd>↑</kbd> <kbd>↓</kbd>{" "}
        选择，<kbd>Enter</kbd> 读取手记；日期按记录本身的日历日期显示。
      </p>

      {filtered.length ? (
        <div className={styles.saveLayout}>
          <div className={styles.saveListCol}>
            <ul
              ref={listRef}
              className={styles.saveList}
              role="listbox"
              aria-label="手记存档列表"
              aria-describedby="journal-save-help"
              onKeyDown={onListKeyDown}
            >
              {filtered.map((entry, index) => (
                <SaveSlot
                  key={entry.id}
                  entry={entry}
                  index={index}
                  total={filtered.length}
                  selected={selected?.id === entry.id}
                  onSelect={selectByPointer}
                />
              ))}
            </ul>
          </div>
          <div className={styles.savePreviewCol}>
            <SavePreview
              previewRef={previewRef}
              host={host}
              entry={selected}
              index={selectedIndex}
              total={filtered.length}
              onRead={openReading}
              onLocateDay={onLocateDay}
            />
          </div>
        </div>
      ) : (
        <p className={styles.empty}>
          这个筛选条件下没有公开的手记。切换年份或选择「全部」看看，没有记录时不显示空存档位。
        </p>
      )}
    </>
  );
}

/** 一档存档槽：编号 + 日期 + 标题 + 摘要。`role="option"` 由 `<li>` 承担。 */
function SaveSlot({
  entry,
  index,
  total,
  selected,
  onSelect,
}: {
  entry: JournalEntrySummary;
  index: number;
  total: number;
  selected: boolean;
  onSelect: (entry: JournalEntrySummary) => void;
}): ReactNode {
  const parts = parseCalendarDate(entry.entry_date);

  return (
    <li
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={total}
      tabIndex={selected ? 0 : -1}
      className={`${styles.slot} ${selected ? styles.slotSelected : ""}`}
      data-journal-slot=""
      data-slot-number={slotNumber(index)}
      data-slot-id={entry.id}
      data-slot-date={entry.entry_date}
      onClick={() => onSelect(entry)}
    >
      <span className={styles.slotNo} aria-hidden="true">
        <span className={styles.slotNoPrefix}>No.</span>
        {slotNumber(index)}
      </span>
      <span className={styles.slotDateBox}>
        <span className={styles.slotDay}>{parts ? parts.day : "--"}</span>
        <span className={styles.slotYm}>{parts ? `${parts.year}.${parts.month}` : entry.entry_date}</span>
        <span className={styles.slotWeekday}>{parts ? parts.weekday : ""}</span>
      </span>
      <span className={styles.slotBody}>
        <span className={styles.slotTitle}>{entry.title || "（无标题）"}</span>
        {entry.excerpt ? <span className={styles.slotExcerpt}>{entry.excerpt}</span> : null}
        <span className={styles.slotMeta}>
          {entry.mood ? <span className={styles.slotChip}>{entry.mood}</span> : null}
          {entry.location ? <span className={styles.slotChip}>{entry.location}</span> : null}
          {entry.images.length ? (
            <span className={styles.slotChip}>{entry.images.length} 张图</span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

/** 选中项的预览：真实字段（日期 / 标题 / 摘要 / 心情 / 地点 / 图片），没有就不显示。 */
function SavePreview({
  previewRef,
  host,
  entry,
  index,
  total,
  onRead,
  onLocateDay,
}: {
  previewRef: React.RefObject<HTMLElement | null>;
  host: JournalHost;
  entry: JournalEntrySummary | null;
  index: number;
  total: number;
  onRead: (entry: JournalEntrySummary) => void;
  onLocateDay: (day: string) => void;
}): ReactNode {
  if (!entry) return null;
  const parts = parseCalendarDate(entry.entry_date);
  const thumbs = entry.images
    .map((image) => ({ image, url: imageUrl(image) }))
    .filter((item): item is { image: JournalEntrySummary["images"][number]; url: string } =>
      Boolean(item.url),
    );

  return (
    <section
      ref={previewRef}
      className={styles.preview}
      aria-label="选中手记预览"
      aria-live="polite"
      data-journal-preview=""
    >
      <header className={styles.previewHead}>
        <p className={styles.previewKicker}>SAVE DATA</p>
        <p className={styles.previewNo}>
          No.{slotNumber(Math.max(index, 0))} / {slotNumber(Math.max(total - 1, 0))}
        </p>
      </header>

      <div className={styles.previewDate}>
        <span className={styles.previewDay}>{parts ? parts.day : "--"}</span>
        <span className={styles.previewYm}>
          {parts ? `${parts.year}.${parts.month}` : entry.entry_date}
        </span>
        <span className={styles.previewWeekday}>{parts ? parts.weekday : ""}</span>
      </div>
      <p className={styles.previewDateLine}>{parts ? parts.label : entry.entry_date}</p>

      <h3 className={styles.previewTitle}>{entry.title || "（无标题）"}</h3>

      <p className={styles.previewMeta}>
        {entry.mood ? <span className={styles.slotChip}>心情：{entry.mood}</span> : null}
        {entry.location ? <span className={styles.slotChip}>地点：{entry.location}</span> : null}
        <span className={styles.slotChip}>
          {entry.images.length ? `${entry.images.length} 张图` : "无配图"}
        </span>
      </p>

      {thumbs.length ? (
        <ul className={styles.previewThumbs} aria-label="这篇手记的图片">
          {thumbs.map(({ image, url }) => (
            <li key={image.media_id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 变体地址由 API 给出，首版不共享缓存，不用 next/image。 */}
              <img className={styles.previewThumb} src={url} alt={image.alt} loading="lazy" />
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.previewExcerpt}>
        {entry.excerpt || "这一篇没有摘要 —— 点「读取手记」看完整正文。"}
      </p>

      <div className={styles.previewActions}>
        {host.mode === "phone" ? (
          <button type="button" className={styles.readButton} onClick={() => onRead(entry)}>
            读取手记 <span aria-hidden="true">▸</span>
          </button>
        ) : (
          <SiteLink
            className={styles.readButton}
            href={entryPath(entry.id)}
            source="top-nav"
            onClick={() => rememberEntry(host.state, entry.id)}
          >
            读取手记 <span aria-hidden="true">▸</span>
          </SiteLink>
        )}
        <button
          type="button"
          className={`${styles.button} ${styles.buttonGhost}`}
          onClick={() => onLocateDay(entry.entry_date)}
        >
          在日历中定位
        </button>
      </div>
      <p className={styles.hint}>
        「读取手记」进入这一篇的完整正文；发布与编辑仍在管理端，访客界面不提供写入口。
      </p>
    </section>
  );
}
