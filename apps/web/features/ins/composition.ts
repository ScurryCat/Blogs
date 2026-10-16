"use client";

/**
 * INS 组合接口（T03 交付的接线契约，T00 在集成时使用）。
 *
 * 背景（SHARED-CONTRACTS §4、03 §8、08 §2）：INS 最终是「动态 / 相册 / 消息」三页签，
 * 外加头像区的 COOP 入口。但相册属 T06、消息属 T08，本包**不能 import 尚不存在的模块**
 * （会直接编译失败），也不能放假按钮（验收：未接入的能力不显示坏按钮）。
 *
 * 因此这里定义的是**注入点而不是实现**：
 *
 *   - `INS_TABS`：内置页签（动态 / 本机收藏）。永远存在。
 *   - `InsTabContribution`：外部包（T06 / T08）要接进来的页签描述。
 *   - `resolveTabs()`：把内置页签与注入页签合并。 **未注入的页签不会出现在结果里** ——
 *     没有「敬请期待」占位，也没有点了报错的按钮。
 *   - `InsProfileSlots.coop`：头像区的 COOP 入口插槽。T07 提供组件，T00 接线；
 *     未注入时不渲染任何友链入口。
 *
 * T00 集成时的用法（示意，不在本包内实现）：
 *
 * ```tsx
 * // app/apps/ins/page.tsx 已经支持这些参数
 * <InsShell tabs={[galleryTab, messagesTab]} profile={{ coop: <CoopEntry /> }} />
 * ```
 *
 * 手机宿主里的等价用法是把同一个 `tabs` 数组传给 phone 视图的 `InsApp`。
 */

import type { ComponentType, ReactNode } from "react";

export type InsTabId = string;

/** 内置页签 id。外部包**不得**复用这两个 id（会与内置页签冲突并被拒绝）。 */
export const INS_FEED_TAB = "feed";
export const INS_SAVED_TAB = "saved";

export interface InsTabContext {
  /** 当前筛选标签（页签可据此保留自己的筛选）。 */
  tag: string | null;
  /** 合入后续页签渲染。 */
  children?: ReactNode;
}

export interface InsTabContribution {
  id: InsTabId;
  /** 页签按钮文字。 */
  label: string;
  /** 无障碍标签（屏幕阅读器读这个，不是读装饰性文字）。 */
  ariaLabel: string;
  /** 排序：内置页签是 10 / 20，外部页签用 30 起，保证内置页签在最前。 */
  order: number;
  /**
   * 是否可用。返回 false 时该页签**不显示**（例如相册还没有任何照片）。
   * 默认视为可用。
   */
  isAvailable?: () => boolean;
  render: ComponentType<InsTabContext>;
}

export interface InsBuiltinTab {
  id: InsTabId;
  label: string;
  ariaLabel: string;
  order: number;
  builtin: true;
}

export interface ResolvedTab {
  id: InsTabId;
  label: string;
  ariaLabel: string;
  builtin: boolean;
  render: ComponentType<InsTabContext> | null;
}

export const BUILTIN_TABS: readonly InsBuiltinTab[] = Object.freeze([
  { id: INS_FEED_TAB, label: "动态", ariaLabel: "图文动态信息流", order: 10, builtin: true },
  { id: INS_SAVED_TAB, label: "收藏", ariaLabel: "此浏览器收藏的图文", order: 20, builtin: true },
]);

export class InsTabConflictError extends Error {}

/**
 * 合并内置页签与注入页签。
 *
 * 规则：
 *  - 冲突 id（外部页签想占用 `feed` / `saved`）→ 立刻报错，不静默覆盖内置页签；
 *  - 重复 id → 立刻报错，避免出现两个同 id 页签导致选中状态无法表达；
 *  - `isAvailable()` 返回 false 的页签被过滤掉 —— **未接入就不显示**。
 */
export function resolveTabs(contributions: readonly InsTabContribution[] = []): ResolvedTab[] {
  const builtinIds = new Set(BUILTIN_TABS.map((tab) => tab.id));
  const seen = new Set<InsTabId>();
  const resolved: ResolvedTab[] = BUILTIN_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    ariaLabel: tab.ariaLabel,
    builtin: true,
    render: null,
  }));
  for (const tab of [...contributions].sort((a, b) => a.order - b.order)) {
    if (builtinIds.has(tab.id)) {
      throw new InsTabConflictError(`页签 id ${tab.id} 与 INS 内置页签冲突`);
    }
    if (seen.has(tab.id)) {
      throw new InsTabConflictError(`页签 id ${tab.id} 重复注入`);
    }
    seen.add(tab.id);
    if (tab.isAvailable && !tab.isAvailable()) continue;
    resolved.push({
      id: tab.id,
      label: tab.label,
      ariaLabel: tab.ariaLabel,
      builtin: false,
      render: tab.render,
    });
  }
  return resolved;
}

/** 头像区插槽。未提供时不渲染任何入口（不放假按钮）。 */
export interface InsProfileSlots {
  /** COOP 友链快捷入口（T07 提供组件）。 */
  coop?: ReactNode;
  /** 站主简介文案；未提供时用默认说明。 */
  bio?: ReactNode;
}

/** 页面标题与自述。独立页标注「ScurryCat 的图文动态」，不暗示接入了真实 Instagram。 */
export const INS_TITLE = "ScurryCat 的图文动态";
export const INS_SUBTITLE = "本站图文手记 · 不使用真实 Instagram 登录，也不接入其数据";
