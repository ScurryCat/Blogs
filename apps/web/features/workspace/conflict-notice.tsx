"use client";

/**
 * 工作草稿版本冲突提示（P5 第一批 · 契约 §4.2 / §9.4）。
 *
 * 412 时自动保存已暂停（`useWorkDraft` 负责），这里只给用户两个**明确**选择：
 *  - 放弃本机修改，载入最新版本（`reload-latest`）；
 *  - 另存为新草稿（`save-as-new`，原草稿一行都不动）。
 *
 * 不提供「覆盖服务器」：冲突必须由用户显式选择，且保存策略里没有静默覆盖。
 */

import type { ReactNode } from "react";

export interface ConflictNoticeProps {
  onReload: () => void;
  onSaveAsNew: () => void;
  message?: string;
}

export function ConflictNotice({ onReload, onSaveAsNew, message }: ConflictNoticeProps): ReactNode {
  return (
    <section className="ws-conflict" data-workspace-conflict role="alert">
      <p className="ws-conflict-kicker">{"// Draft Conflict"}</p>
      <p className="ws-conflict-text">
        {message ??
          "草稿已在其他设备或标签页更新，自动保存已暂停。本机修改还没有丢失，请选择如何处理。"}
      </p>
      <div className="ws-conflict-actions">
        <button type="button" className="ws-btn" onClick={onReload} data-workspace-conflict-reload>
          放弃本机修改，载入最新版本
        </button>
        <button type="button" className="ws-btn ws-btn-primary" onClick={onSaveAsNew} data-workspace-conflict-save-as-new>
          另存为新草稿
        </button>
      </div>
    </section>
  );
}
