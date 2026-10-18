"use client";

/**
 * 放课后的前台站主入口（P5 第一批 · C4；契约 §4.6 / §9.5）。
 *
 * 入口只在 `useOwnerSession` 确认站主后渲染：
 *  - 「快速更新进度」→ `/admin/leisure?quick=1`（快捷更新区，明确提交才写入）；
 *  - 「进入完整编辑」→ `/admin/leisure`（保留下来的现有完整编辑，名称/封面等）。
 * 两者都带 `returnTo`（放课后列表当前路径 + 筛选状态 + 手机上下文），返回时恢复。
 */

import type { ReactNode } from "react";

import { OwnerEntryLink } from "@/features/journal/owner-entry";

import styles from "./leisure.module.css";

export function LeisureOwnerActions(): ReactNode {
  return (
    <div className={styles.ownerActions} data-owner-actions="leisure">
      <OwnerEntryLink
        entry="leisure-quick"
        href="/admin/leisure?quick=1"
        label="快速更新进度"
        className={`${styles.button} ${styles.buttonGhost}`}
      />
      <OwnerEntryLink
        entry="leisure-edit"
        href="/admin/leisure"
        label="进入完整编辑"
        className={`${styles.button} ${styles.buttonGhost}`}
      />
    </div>
  );
}
