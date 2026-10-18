"use client";

/**
 * 勒布朗的站主快捷入口（P5 第一批 · C4；契约 §4.6 / §9.5）。
 *
 * 三个动作：选择发布动态 / 写手记 / 更新进度。
 * 只在 `useOwnerSession` 确认站主后渲染；链接都带 `returnTo`（勒布朗当前路径 +
 * 手机上下文），从编辑器返回时回到这里。普通访客的「勒布朗」布局不变。
 */

import type { ReactNode } from "react";

import { OwnerEntryLink } from "@/features/journal/owner-entry";

import styles from "./leblanc.module.css";

export function LeblancOwnerActions(): ReactNode {
  return (
    <nav
      className={styles.ownerLinks}
      aria-label="站主快捷操作"
      data-owner-actions="leblanc"
    >
      <p className={styles.ownerKicker}>{"// Owner"}</p>
      <OwnerEntryLink
        entry="leblanc-start-moment"
        href="/admin/moments/new"
        label="发布动态"
        className={styles.button}
      />
      <OwnerEntryLink
        entry="leblanc-start-journal"
        href="/admin/journal/new"
        label="写手记"
        className={styles.button}
      />
      <OwnerEntryLink
        entry="leblanc-start-leisure"
        href="/admin/leisure?quick=1"
        label="更新进度"
        className={styles.button}
      />
    </nav>
  );
}
