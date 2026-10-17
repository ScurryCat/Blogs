/**
 * 印象空间 · 问题记录（`/apps/metanav/mementos`，T09；07 §6）。
 *
 * 这是**服务端组件**：第一页记录与工作状态统计在服务端读（`API_INTERNAL_URL`），
 * 交给客户端视图 `MementosView`。没有配置内部地址时（本地只跑前端）
 * 渲染同源读取的加载器。
 *
 * **保留 T04 的分类探索**（任务卡执行清单）：分类屏仍在
 * `/apps/metanav?screen=mugen`，本页只链接过去，**不接管**那条路径，
 * 也不把 `MetanavView` 的 mugen 屏替换掉。
 *
 * 读取失败如实显示，绝不降级成「没有记录」；`stats` 读不到时也不显示 0
 * ——那会变成一句「这里什么都没有」的假话。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { MementosLoader } from "@/features/exploration/mementos-loader";
import { MementosView } from "@/features/exploration/mementos-view";
import {
  fetchRecordsOnServer,
  fetchRecordStatsOnServer,
} from "@/features/exploration/server-api";
import {
  isWorkStatus,
  RECORD_PAGE_SIZE,
  type RecordStats,
  type RecordSummary,
  type WorkStatus,
} from "@/features/exploration/types";
import "@/features/exploration/exploration.css";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "印象空间 · 问题记录",
  description:
    "站主整理的问题日志：发现的问题、背景、尝试与结果。不是公开请求板，也不承诺处理访客任务。",
};

export const dynamic = "force-dynamic";

function serverReadingEnabled(): boolean {
  return Boolean(process.env.API_INTERNAL_URL);
}

function failureReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `读取问题记录失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上接口服务，暂时无法读取问题记录。";
  }
  if (error instanceof Error && error.message) {
    return `读取问题记录失败：${error.message}`;
  }
  return "读取问题记录失败。";
}

interface PageProps {
  searchParams: Promise<{ work_status?: string | string[] }>;
}

export default async function MementosPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const raw = Array.isArray(params.work_status) ? params.work_status[0] : params.work_status;
  const workStatus: WorkStatus | null = isWorkStatus(raw) ? raw : null;

  if (!serverReadingEnabled()) {
    return (
      <AppPageShell>
        <MementosLoader />
      </AppPageShell>
    );
  }

  let records: RecordSummary[] = [];
  let cursor: string | null = null;
  let stats: RecordStats | null = null;
  let loadError: string | null = null;

  try {
    const page = await fetchRecordsOnServer({ work_status: workStatus, limit: RECORD_PAGE_SIZE });
    records = page.items;
    cursor = page.next_cursor;
  } catch (error) {
    loadError = failureReason(error);
  }

  if (!loadError) {
    try {
      stats = await fetchRecordStatsOnServer();
    } catch {
      // 统计是附属信息：读不到就不显示计数，**不**显示 0（那会变成假话）。
      stats = null;
    }
  }

  return (
    <AppPageShell>
      <MementosView
        initialRecords={records}
        initialCursor={cursor}
        stats={stats}
        loadError={loadError}
        workStatus={workStatus}
      />
    </AppPageShell>
  );
}
