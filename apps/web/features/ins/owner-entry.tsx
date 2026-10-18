"use client";

/**
 * 前台 INS 的站主快捷入口（P5 第一批 · C3；契约 §4.6 / §9.5）。
 *
 * 规则：
 *  - **只在确认站主已登录后才渲染**（`useOwnerSession` 的 `status === "owner"`）。
 *    隐藏入口不是授权：即使直接访问编辑地址，后端仍会校验站主会话；
 *  - 链接统一带 `returnTo=<当前站内地址 + 查询串>`，把来源页、标签筛选与手机 App 上下文
 *    （`phone` / `screen` / `item`）一起保存，编辑完返回时用同一个 URL 恢复；
 *  - 手机浮层（`.pw-wrap`）打开时：目标地址本身不含 `phone` 参数，点击时用 `router.push`
 *    触发一次真实路由变化，手机宿主随 URL 卸载 → 编辑器不会被浮层遮挡；
 *  - `returnTo` 由 C2 的 `withReturnTo` 统一编码，校验由编辑器页的 `readReturnTo` 完成。
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { withReturnTo } from "@/features/workspace/return-context";
import { useOwnerSession } from "@/features/workspace/session";

export type InsOwnerEntryKind = "ins-new" | "ins-edit";

export interface InsOwnerEntryProps {
  /** `ins-new` = 发布动态；`ins-edit` = 编辑当前动态。 */
  kind: InsOwnerEntryKind;
  /** `ins-edit` 必填：当前动态 ID。 */
  momentId?: string | null;
  className?: string;
  children?: ReactNode;
}

/** 入口目标地址（`returnTo` 已编码）；测试也用它断言生成规则。 */
export function ownerEntryHref(
  kind: InsOwnerEntryKind,
  momentId: string | null | undefined,
  returnTo: string,
): string {
  const base =
    kind === "ins-new" ? "/admin/moments/new" : `/admin/moments/${momentId ?? ""}/edit`;
  return withReturnTo(base, returnTo);
}

/**
 * 当前站内地址（路径 + 查询串）：作为 returnTo 的来源。
 *
 * 如果地址里已经有 `returnTo`（例如从别处带进来的），保留它没有坏处：
 * 它只是一个普通的查询参数，编辑器返回时会回到这个地址本身。
 */
export function currentInsPath(pathname: string | null, search: string): string {
  const path = pathname && pathname.startsWith("/") ? pathname : "/apps/ins";
  return search ? `${path}?${search}` : path;
}

export function InsOwnerEntry({
  kind,
  momentId,
  className = "ins-owner-entry",
  children,
}: InsOwnerEntryProps): ReactNode {
  const session = useOwnerSession();
  const pathname = usePathname();
  const params = useSearchParams();

  // 只有确认站主才渲染（loading / anonymous / failed 一律不渲染，避免闪烁的假入口）。
  if (session.status !== "owner") return null;
  if (kind === "ins-edit" && !momentId) return null;

  const returnTo = currentInsPath(pathname, params?.toString() ?? "");
  // 目标地址本身**不含** phone/screen/item：点击后 URL 变化会卸载 `.pw-wrap` 手机浮层，
  // 编辑器不会被浮层遮挡；完整来源（含手机参数）只保存在编码后的 returnTo 里。
  const href = ownerEntryHref(kind, momentId, returnTo);
  return (
    <Link className={className} href={href} data-owner-entry={kind} prefetch={false}>
      {children ?? (kind === "ins-new" ? "发布动态" : "编辑当前动态")}
    </Link>
  );
}
