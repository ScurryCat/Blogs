"use client";

/**
 * 问题记录列表的浏览器端加载器（本地开发没有 `API_INTERNAL_URL` 时用）。
 *
 * 与 T09 的技能全书加载器同形：按 URL 里的 `work_status` 读同源 `/api/v1`，
 * 得到与生产完全一样的数据（同一条公开端点），不退化成假数据。
 * 可取消读取与「不在 effect 里同步 setState」由 `useFeatureFetch` 统一处理。
 */

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";

import { fetchRecords, fetchRecordStats } from "./api";
import { SERVICE_UNAVAILABLE } from "./failure";
import { MementosView } from "./mementos-view";
import {
  RECORD_PAGE_SIZE,
  isWorkStatus,
  type RecordPage,
  type RecordStats,
  type WorkStatus,
} from "./types";
import "@/features/exploration/exploration.css";

interface Loaded {
  page: RecordPage;
  stats: RecordStats | null;
}

export function MementosLoader(): ReactNode {
  const params = useSearchParams();
  const raw = params?.get("work_status") ?? null;
  const workStatus: WorkStatus | null = isWorkStatus(raw) ? raw : null;

  const { state } = useFeatureFetch<Loaded>(JSON.stringify({ workStatus }), async (signal) => {
    const page = await fetchRecords(
      { work_status: workStatus, limit: RECORD_PAGE_SIZE },
      signal,
    );
    // 统计是附属信息：读不到就返回 null，界面不显示计数（**不**显示 0）。
    const stats = await fetchRecordStats(signal).catch(() => null);
    return { page, stats };
  });

  if (state.status === "loading") {
    return (
      <p className="data-notice" role="status">
        正在读取问题记录…
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <MementosView
        initialRecords={[]}
        initialCursor={null}
        stats={null}
        loadError={SERVICE_UNAVAILABLE}
        workStatus={workStatus}
      />
    );
  }

  return (
    <MementosView
      initialRecords={state.data.page.items}
      initialCursor={state.data.page.next_cursor}
      stats={state.data.stats}
      loadError={null}
      workStatus={workStatus}
    />
  );
}
