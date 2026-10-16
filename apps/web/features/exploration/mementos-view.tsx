"use client";

/**
 * 印象空间 · 问题记录列表（07 §6；任务卡文件边界
 * `apps/web/app/apps/metanav/mementos/page.tsx`）。
 *
 * 这是站主维护的**问题日志**，不是公开请求板（验收 4）：
 *
 *   - 没有「提交问题」「认领」「预计完成时间」之类的控件；
 *   - 每条记录都写着工作状态（待探索 / 调查中 / 已解决 / 暂搁置），
 *     状态是**事实描述**，不是对读者的承诺；
 *   - 关联的文章 / 作品只在当前公开时出现，撤回后引用整条消失，
 *     界面上不留「（已隐藏）」占位 —— 那本身就是泄漏。
 *
 * 与 T04 的**分类探索**并存而不替代（任务卡执行清单）：分类印象空间仍在
 * `/apps/metanav?screen=mugen` 按文章分类往下翻，这里多给一个入口而不是取代它。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchRecords } from "./api";
import { isAbort, SERVICE_UNAVAILABLE } from "./failure";
import "@/features/exploration/exploration.css";
import {
  CATEGORY_EXPLORATION_PATH,
  MEMENTOS_PATH,
  mementosHref,
  recordHref,
} from "./paths";
import {
  RECORD_PAGE_SIZE,
  truncateBackground,
  WORK_STATUSES,
  type RecordStats,
  type RecordSummary,
  type WorkStatus,
} from "./types";

export interface MementosViewProps {
  initialRecords: readonly RecordSummary[];
  initialCursor: string | null;
  /** 公开工作状态统计；服务端读不到时为 null（界面不显示计数，而不是显示 0）。 */
  stats: RecordStats | null;
  loadError?: string | null;
  workStatus?: WorkStatus | null;
}

export function MementosView({
  initialRecords,
  initialCursor,
  stats,
  loadError = null,
  workStatus = null,
}: MementosViewProps): ReactNode {
  const [records, setRecords] = useState<readonly RecordSummary[]>(initialRecords);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(loadError);
  const inflight = useRef<AbortController | null>(null);

  /**
   * 服务端结果变化（切换工作状态筛选后重新渲染）时重置本地列表。
   * 用「记住上一次的键」而不是 `useEffect`：在 effect 体里同步 `setState`
   * 会触发级联渲染（`react-hooks/set-state-in-effect`）。
   */
  const incomingKey = `${workStatus ?? ""}|${initialCursor ?? ""}|${loadError ?? ""}|${
    initialRecords.length
  }|${initialRecords[0]?.id ?? ""}`;
  const [syncedKey, setSyncedKey] = useState(incomingKey);
  if (syncedKey !== incomingKey) {
    setSyncedKey(incomingKey);
    setRecords(initialRecords);
    setCursor(initialCursor);
    setFailure(loadError);
  }

  useEffect(() => () => inflight.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    try {
      const page = await fetchRecords(
        { cursor, work_status: workStatus, limit: RECORD_PAGE_SIZE },
        controller.signal,
      );
      setRecords((previous) => [...previous, ...page.items]);
      setCursor(page.next_cursor);
      setFailure(null);
    } catch (error) {
      if (isAbort(error)) return;
      setFailure(SERVICE_UNAVAILABLE);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [cursor, workStatus]);

  return (
    <div className="pme-wrap" data-mementos-root="">
      <header className="pme-bar">
        <div>
          <p className="pme-kicker">{"// MEMENTOS · LOG"}</p>
          <h1 className="pme-title">问题记录</h1>
          <p className="pme-lead">
            这里是<b>站主自己整理</b>的问题日志：发现的问题、背景、尝试与结果。
            它不是公开的请求板，也不承诺处理访客的任务 ——
            记录里出现的文章与作品都是本站真实内容，撤回后就不再显示。
            {" "}
            <SiteLink href={CATEGORY_EXPLORATION_PATH} source="phone-link">
              也可以按文章分类探索（分类印象空间）
            </SiteLink>
            。
          </p>
        </div>
      </header>

      {stats && stats.total > 0 ? (
        <ul className="pme-stats" aria-label="当前公开记录的工作状态分布">
          <li className="pme-stat">
            全部<b>{stats.total}</b>
          </li>
          {WORK_STATUSES.map((option) => (
            <li className="pme-stat" key={option.value}>
              {option.label}
              <b>{stats.by_work_status[option.value] ?? 0}</b>
            </li>
          ))}
        </ul>
      ) : null}

      <nav className="pme-filters" aria-label="按工作状态筛选">
        <SiteLink
          className="pme-chip"
          href={mementosHref()}
          source="phone-link"
          aria-current={workStatus === null ? "true" : undefined}
        >
          全部
        </SiteLink>
        {WORK_STATUSES.map((option) => (
          <SiteLink
            key={option.value}
            className="pme-chip"
            href={mementosHref({ work_status: option.value })}
            source="phone-link"
            aria-current={workStatus === option.value ? "true" : undefined}
          >
            {option.label}
          </SiteLink>
        ))}
      </nav>

      {failure ? (
        <p className="pme-alert" role="alert">
          {failure}
        </p>
      ) : null}

      {!failure && records.length === 0 ? (
        <p className="pme-empty" role="status" data-mementos-empty="">
          {workStatus
            ? "这个工作状态下还没有公开的问题记录。"
            : "目前还没有公开的问题记录。"}
          {" "}没有记录时这里就是空的 —— 不会生成虚构的问题来撑满列表。
        </p>
      ) : null}

      {records.length ? (
        <ul className="pme-list" data-mementos-list="">
          {records.map((record) => (
            <li key={record.id}>
              <SiteLink
                className="pme-card"
                href={recordHref(record.slug)}
                source="phone-link"
                data-record={record.slug}
              >
                <span className="pme-card-head">
                  <span className="pme-card-title">{record.title}</span>
                  <span className="pme-badge" data-work-status={record.work_status}>
                    {record.work_status_label}
                  </span>
                </span>
                {record.excerpt ? (
                  <span className="pme-excerpt">{truncateBackground(record.excerpt)}</span>
                ) : null}
                <span className="pme-card-meta">
                  <span>{record.published_at.slice(0, 10)}</span>
                  {record.post_count ? <span>相关文章 {record.post_count}</span> : null}
                  {record.project_count ? <span>相关作品 {record.project_count}</span> : null}
                  {record.work_status === "resolved" && record.resolved_at ? (
                    <span>解决于 {record.resolved_at.slice(0, 10)}</span>
                  ) : null}
                </span>
              </SiteLink>
            </li>
          ))}
        </ul>
      ) : null}

      {cursor ? (
        <div className="pme-actions">
          <button
            className="pme-button pme-button-ghost"
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading ? "正在读取…" : "读取更多记录"}
          </button>
        </div>
      ) : null}

      <p className="pme-hint" data-mementos-path={MEMENTOS_PATH}>
        每条记录都有自己的地址（<code>/apps/metanav/mementos/&lt;slug&gt;</code>），
        可以直接分享或用键盘返回。
      </p>
    </div>
  );
}
