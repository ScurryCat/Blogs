"use client";

/**
 * 放课后主视图（07 §3）：追番 / 游戏两个页签，共享封面、状态、短评与筛选交互，
 * 各自的进度字段照原样显示。
 *
 * 手机内置应用与独立页渲染的是**同一个** `LeisureView`，只是宿主不同。
 *
 * 硬规则：
 *  - 两个页签用**同一组端点**，只换 `kind`（不建两套接口）；
 *  - 不显示任何「同步自 Steam / Bangumi」的字样或在线状态：进度全部由站主手动维护；
 *  - 空结果就是正常空态，不虚构条目（验收 3 的「无第三方同步暗示」）。
 */

import { useMemo, useState, type ReactNode } from "react";

import { listAllEntries } from "./api";
import { EntryCard } from "./entry-card";
import { useLoader, type LeisureHost } from "./host";
import styles from "./leisure.module.css";
import { DEFAULT_FILTERS, filterEntries, isLeisureScreen } from "./paths";
import { PROGRESS_OPTIONS, type LeisureKind } from "./types";

const DEFAULT_SCREENS = ["anime", "game"] as const;

export function LeisureView({
  screen,
  host,
  screens = DEFAULT_SCREENS,
}: {
  screen: string | null;
  host: LeisureHost;
  screens?: readonly string[];
}): ReactNode {
  const allowed = screens.length ? screens : DEFAULT_SCREENS;
  const active: LeisureKind =
    isLeisureScreen(screen) && allowed.includes(screen) ? screen : (allowed[0] as LeisureKind);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const { state, reload } = useLoader(
    (signal) => listAllEntries(active, signal),
    [active],
  );

  const items = useMemo(() => (state.status === "ready" ? state.data : []), [state]);
  const visible = useMemo(() => filterEntries(items, filters), [items, filters]);
  const options = PROGRESS_OPTIONS[active];

  return (
    <div className={styles.wrap} data-leisure-screen={active}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// After School"}</p>
          <h2 className={styles.title}>放课后</h2>
          <p className={styles.lead}>
            在看什么、在玩什么：进度、评分与短评都由站主手动维护，不同步任何第三方账号。
            总集数不确定时就写「看到第几集」，不会算出一个假的完成率。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="类型">
          {allowed.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.tab}
              aria-current={item === active ? "true" : undefined}
              onClick={() => host.changeScreen(item)}
            >
              {item === "anime" ? "追番" : "游戏"}
            </button>
          ))}
        </nav>
      </header>

      <div className={styles.filters}>
        <label className={styles.field}>
          <span className={styles.label}>状态</span>
          <select
            className={styles.select}
            value={filters.progress}
            onChange={(event) => setFilters({ ...filters, progress: event.target.value })}
          >
            <option value="">全部状态</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>评分</span>
          <select
            className={styles.select}
            value={filters.rated}
            onChange={(event) =>
              setFilters({ ...filters, rated: event.target.value as typeof filters.rated })
            }
          >
            <option value="all">全部</option>
            <option value="rated">已评分</option>
            <option value="unrated">未评分</option>
          </select>
        </label>
        <span className={styles.hint}>共 {visible.length} 条</span>
      </div>

      {state.status === "loading" ? (
        <p className={styles.empty} role="status">
          正在读取…
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
          这个页签还没有已发布的记录。站主可以在 <code>/admin/leisure</code> 手动添加 ——
          首版不支持 Steam / Bangumi 同步，所有进度都是手填的真实记录。
        </p>
      ) : null}

      {items.length && !visible.length ? (
        <p className={styles.empty}>当前筛选没有匹配的记录。换个状态或评分条件试试。</p>
      ) : null}

      {visible.length ? (
        <ul className={styles.grid}>
          {visible.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
