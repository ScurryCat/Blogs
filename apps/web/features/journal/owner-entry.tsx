"use client";

/**
 * 前台站主快捷入口（P5 第一批 · C4；契约 §4.6 / §9.5）。
 *
 * 规则（硬性）：
 *  - **只在 `useOwnerSession` 确认 `owner` 后渲染**。匿名访客连占位都不显示；
 *    隐藏入口不是授权 —— 真正的权限仍在后端（01 §3）。
 *  - 链接统一带 `returnTo=<当前站内路径+查询串>`（用 C2 的 `withReturnTo` 编码），
 *    返回时编辑器用 `router.replace(returnTo)` 恢复来源页、筛选与手机 App 上下文。
 *  - 从日历进入时，`date=YYYY-MM-DD` 作为**独立参数**追加在 `returnTo` 之后。
 *  - 点击时若手机浮层正打开（URL 带 `phone` 参数），先用 C2 的 `stripPhoneContext`
 *    去掉 phone/screen/item 再跳转，避免编辑器被 `.pw-wrap` 浮层遮挡。
 */

import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";
import {
  safeInternalPath,
  stripPhoneContext,
  withReturnTo,
} from "@/features/workspace/return-context";
import { useOwnerSession } from "@/features/workspace/session";

import styles from "./journal.module.css";

/** 契约 §9.5 的稳定入口名（C5 的 e2e 依赖，不要改）。 */
export type OwnerEntryName =
  | "journal-new"
  | "journal-edit"
  | "leisure-quick"
  | "leisure-edit"
  | "leblanc-start-moment"
  | "leblanc-start-journal"
  | "leblanc-start-leisure";

/**
 * 入口链接（纯函数，单测直接钉住编码规则）：
 * `withReturnTo` 负责 `?returnTo=` / `&returnTo=` 的分隔符，日期作为独立参数追加。
 */
export function buildOwnerEntryHref(
  href: string,
  returnTo: string | null | undefined,
  date?: string | null,
): string {
  const base = withReturnTo(href, returnTo);
  if (!date) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}date=${encodeURIComponent(date)}`;
}

/** 当前页面（路径 + 查询串）作为 returnTo；非法（不在白名单）时返回 null。 */
export function currentReturnTo(
  pathname: string | null | undefined,
  search: string | null | undefined,
): string | null {
  if (!pathname) return null;
  const query = search ? search.replace(/^\?/, "") : "";
  const path = query ? `${pathname}?${query}` : pathname;
  return safeInternalPath(path);
}

/**
 * React hook 版：读当前 URL（包含 phone/screen/item 手机上下文）。
 *
 * 刻意**不用 `useSearchParams()`**：owner 入口会出现在静态预渲染页面（`/apps/leblanc`、
 * 首页 Leblanc 区块、`/apps/journal`、`/apps/leisure` 的静态 shell）里，而
 * `useSearchParams()` 在静态页面上必须包 Suspense 边界，否则 `next build` 会失败
 * （C5 验收实测：`useSearchParams() should be wrapped in a suspense boundary`）。
 *
 * 因此这里用 SSR 安全的 `usePathname()` + 挂载后读 `window.location.search`：
 *  - 服务端/首帧 returnTo 为 null（入口本来也要等站主会话确认后才渲染，所以没有可见闪动）；
 *  - 水合后立刻用真实地址补齐（含手机三元组）；
 *  - 站内导航（pathname 变化）与浏览器前进/后退（popstate）时重新计算。
 */
export function useCurrentReturnTo(): string | null {
  const pathname = usePathname();
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setReturnTo(currentReturnTo(window.location.pathname, window.location.search));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [pathname]);

  return returnTo;
}

/**
 * 点击站主入口时先关闭手机浮层（URL 层兜底）：去掉 `phone` / `screen` / `item`。
 *
 * 契约 §9.5 的优先顺序是「手机宿主导航/浮层 API → URL 层」；入口组件拿不到宿主私有 API
 * 时用这个即可 —— 去掉参数后手机宿主会收起，编辑器随后的路由跳转就不会被浮层挡住。
 */
export function closePhoneOverlayBeforeNavigate(): void {
  if (typeof window === "undefined") return;
  const search = window.location.search;
  if (!search) return;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!params.get("phone")) return;
  const href = `${window.location.pathname}${search}`;
  try {
    window.history.replaceState(window.history.state, "", stripPhoneContext(href));
  } catch {
    // 隐私模式/沙箱里 history 可能不可写：退化为「不做 URL 处理」，跳转仍然会离开本页，
    // 手机上该浮层随路由卸载，不会遮挡编辑器。
  }
}

function handleEntryClick(event: MouseEvent<HTMLAnchorElement>): void {
  // 只处理普通左键；Ctrl/Cmd 点击、中键交给浏览器（与 SiteLink 的规则一致）。
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.button !== 0) return;
  closePhoneOverlayBeforeNavigate();
}

/**
 * 通用站主入口链接：确认 owner 才渲染，点击时先收起手机浮层。
 *
 * `className` 默认用各页面自己的按钮样式（调用方给）；`testId` 之外的一切都靠 data-*。
 */
export function OwnerEntryLink({
  entry,
  href,
  label,
  className,
  date,
}: {
  entry: OwnerEntryName;
  href: string;
  label: string;
  className?: string;
  date?: string | null;
}): ReactNode {
  const session = useOwnerSession();
  const returnTo = useCurrentReturnTo();
  if (session.status !== "owner") return null;
  return (
    <SiteLink
      className={className}
      href={buildOwnerEntryHref(href, returnTo, date)}
      source="top-nav"
      data-owner-entry={entry}
      data-owner-return-to={returnTo ?? ""}
      onClick={handleEntryClick}
    >
      {label}
    </SiteLink>
  );
}

/** 手记：写手记（日历进入时带上选中日期）。 */
export function JournalOwnerNewEntry({
  date = null,
  className,
}: {
  date?: string | null;
  className?: string;
}): ReactNode {
  return (
    <OwnerEntryLink
      entry="journal-new"
      href="/admin/journal/new"
      label="写手记"
      className={className ?? `${styles.button} ${styles.buttonGhost}`}
      date={date}
    />
  );
}

/** 手记正文：编辑当前手记。 */
export function JournalOwnerEditEntry({
  entryId,
  className,
}: {
  entryId: string;
  className?: string;
}): ReactNode {
  return (
    <OwnerEntryLink
      entry="journal-edit"
      href={`/admin/journal/${encodeURIComponent(entryId)}/edit`}
      label="编辑当前手记"
      className={className ?? `${styles.button} ${styles.buttonGhost}`}
    />
  );
}
