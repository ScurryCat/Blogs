"use client";

/**
 * 放课后管理页的「返回来源」条（P5 · C4；契约 §4.6 / §9.5）。
 *
 * 从前台「快速更新进度 / 进入完整编辑」进来时 URL 带 `returnTo=<来源页+筛选+手机上下文>`；
 * 这里按 C2 的白名单工具校验后，用 `router.replace` 返回来源页（不回退栈里留管理页），
 * 手机浮层上下文随 returnTo 一起恢复。没有合法 returnTo 时不渲染（直接访问本页）。
 */

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { readReturnTo } from "@/features/workspace/return-context";

import styles from "../leisure.module.css";

export function ReturnToBar(): ReactNode {
  const params = useSearchParams();
  const router = useRouter();
  const returnTo = readReturnTo(params);
  if (!returnTo) return null;
  return (
    <div className={styles.actions} data-leisure-return={returnTo}>
      <a
        className={`${styles.button} ${styles.buttonGhost}`}
        href={returnTo}
        onClick={(event) => {
          // 普通左键才接管；Ctrl/Cmd 点击保留浏览器默认（新标签页打开来源页）。
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (event.button !== 0) return;
          event.preventDefault();
          router.replace(returnTo);
        }}
      >
        ← 返回来源
      </a>
      <span className={styles.hint}>
        返回会恢复来源页、筛选与手机 App 上下文（只允许站内目标）。
      </span>
    </div>
  );
}
