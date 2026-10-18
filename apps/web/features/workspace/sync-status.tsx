"use client";

/**
 * 工作草稿同步状态（P5 第一批 · 契约 §4.2 / §9.5）。
 *
 * 安静提示：不弹窗、不播提示音，只做一行状态文本；`data-sync-state` 是 e2e 的稳定钩子。
 * 只有 `synced` 且服务端确认过，文案里才会出现「可在另一设备继续编辑」（由 hook 给 message）。
 */

import type { ReactNode } from "react";

import type { SyncState } from "./types";

export interface SyncStatusProps {
  state: SyncState;
  message: string;
  lastSyncedAt?: string | null;
}

/** 把 ISO 时间格式化为本地 `HH:mm`（同步时间只用于辅助说明，不占主界面）。 */
function formatClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SyncStatus({ state, message, lastSyncedAt = null }: SyncStatusProps): ReactNode {
  // idle 且没有话要说时不占地方（编辑器刚打开、尚未改动）。
  if (state === "idle" && !message) return null;
  const clock = state === "synced" ? formatClock(lastSyncedAt) : null;
  return (
    <p className="ws-sync" data-sync-state={state} role="status" aria-live="polite">
      <span className="ws-sync-dot" aria-hidden="true" />
      <span className="ws-sync-text">{message}</span>
      {clock ? (
        <time className="ws-sync-time" dateTime={lastSyncedAt ?? undefined}>
          {clock}
        </time>
      ) : null}
    </p>
  );
}
