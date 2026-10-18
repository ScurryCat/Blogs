"use client";

/**
 * 编辑器外壳（P5 第一批 · 契约 §4.2 / §4.8 / §9.7）。
 *
 * 两类宿主：
 *  - 桌面：渲染在现有 `.admin-shell` 里（普通文档流，带 sticky 头部）；
 *  - 真实手机浏览器（`≤620px`）：固定全视口层（CSS `position:fixed; inset:0; 100dvh`，
 *    `env(safe-area-inset-*)` 留白，`overscroll-behavior:contain`），并用 `useOverlay` 锁滚动。
 *    关键操作（保存/发布/返回）在 sticky 头部，软键盘弹出后仍可见、可达。
 *
 * 约定：`data-editor` / `data-editor-return` 是 e2e 钩子（契约 §9.5）；保存/发布按钮由页面在
 * `actions` 里渲染并自己带 `data-editor-save` / `data-editor-publish`。
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useOverlay } from "@/features/runtime/overlay-manager";

import { safeInternalPath } from "./return-context";
import type { ContentType } from "./types";

export interface EditorShellProps {
  title: string;
  subtitle?: string;
  /** 已校验或未校验的来源路径；非法/为空时返回创作台 `/admin`。 */
  returnTo: string | null;
  children: ReactNode;
  /** 保存 / 发布等主操作（由编辑器页面提供，自带 data-editor-* 属性）。 */
  actions: ReactNode;
  /** 同步状态槽（通常放 `<SyncStatus />`）。 */
  status?: ReactNode;
  /** 可选：内容类型 —— 传了才有 `data-editor="moment|journal"`（e2e 依赖）。 */
  contentType?: ContentType;
}

const COMPACT_QUERY = "(max-width: 620px)";

export function EditorShell({
  title,
  subtitle,
  returnTo,
  children,
  actions,
  status,
  contentType,
}: EditorShellProps): ReactNode {
  const router = useRouter();
  const backTarget = safeInternalPath(returnTo) ?? "/admin";
  const [compact, setCompact] = useState(false);

  // 只在真实浏览器里跟随媒体查询；jsdom/旧环境没有 matchMedia 时按桌面处理。
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // 手机全屏层锁滚动（OverlayManager 计数锁；桌面不锁）。
  useOverlay({ id: "workspace-editor", lockScroll: true }, compact);

  const goBack = useCallback(() => {
    // replace 而不是 push：编辑器不留在后退栈里（契约 §9.5）。
    router.replace(backTarget);
  }, [backTarget, router]);

  return (
    <div
      className="ws-editor"
      data-editor={contentType}
      data-editor-shell
      data-editor-compact={compact ? "true" : undefined}
    >
      <header className="ws-editor-head">
        <button type="button" className="ws-btn ws-btn-ghost ws-editor-back" onClick={goBack} data-editor-return>
          ← 返回
        </button>
        <div className="ws-editor-titles">
          <h1 className="ws-editor-title">{title}</h1>
          {subtitle ? <p className="ws-editor-subtitle">{subtitle}</p> : null}
        </div>
        {status ? <div className="ws-editor-status">{status}</div> : null}
        <div className="ws-editor-actions">{actions}</div>
      </header>
      <div className="ws-editor-body">{children}</div>
    </div>
  );
}
