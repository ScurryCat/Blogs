"use client";

/**
 * 手记正文的客户端加载器（独立页在**没有服务端 API 配置**时使用）。
 *
 * 为什么需要它：本地开发没有 `API_INTERNAL_URL`，服务端读不到 API；这时页面渲染
 * 这个加载器，由浏览器走同源 `/api/v1` 读取。它把三种情况分清楚：
 *  - 404 → 「这篇手记现在不可读」（可能撤回或撤下），**与「服务不可用」文案不同**；
 *  - 5xx / 网络 → 「手记暂时不可用」+ 重试；
 *  - 读取中 → 明确的加载态。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { getEntry } from "./api";
import { EntryReading } from "./entry-reading";
import { useLoader } from "./host";
import styles from "./journal.module.css";

export function EntryReadingLoader({ entryId }: { entryId: string }): ReactNode {
  const { state, reload } = useLoader((signal) => getEntry(entryId, signal), [entryId]);

  if (state.status === "loading") {
    return (
      <p className={styles.empty} role="status">
        正在读取手记…
      </p>
    );
  }

  if (state.status === "failed") {
    const gone = state.failure.kind === "not_found";
    return (
      <div className={styles.empty} role={gone ? "status" : "alert"}>
        <p>{state.failure.message}</p>
        <div className={styles.actions}>
          {gone ? (
            <SiteLink className={styles.button} href="/apps/journal" source="top-nav">
              回到手记列表
            </SiteLink>
          ) : (
            <button className={styles.button} type="button" onClick={reload}>
              重新读取
            </button>
          )}
          {gone ? null : (
            <SiteLink className={`${styles.button} ${styles.buttonGhost}`} href="/apps/journal" source="top-nav">
              回到列表
            </SiteLink>
          )}
        </div>
      </div>
    );
  }

  return <EntryReading entry={state.data} />;
}
