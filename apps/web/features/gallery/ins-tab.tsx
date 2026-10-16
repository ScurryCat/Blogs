"use client";

/**
 * INS 页签贡献（T06 → T00 接线，本包**不修改** `InsApp` / `InsShell`）。
 *
 * 用法（T00 在 INS 的独立页与手机视图里各传一次同一个对象）：
 *
 * ```tsx
 * import { galleryTabContribution } from "@/features/gallery/ins-tab";
 * import { useGalleryTab } from "@/features/gallery/ins-tab-availability";
 *
 * const gallery = useGalleryTab({ initialAvailable: initialGalleryAvailable });
 * <InsShell tabContributions={[galleryTabContribution(gallery.available)]} … />
 * ```
 *
 * 三条硬规则（`features/ins/composition.ts` 的契约）：
 *
 *  1. `id` 不得占用内置页签 `feed` / `saved`（用了会抛 `InsTabConflictError`）；
 *     这里用 `gallery`。
 *  2. `order` 从 30 起（内置是 10 / 20），保证内置页签在最前。
 *  3. `isAvailable()` 返回 false 时该页签**完全不渲染** —— 没有任何公开相册时
 *     就让这个页签不存在，而不是显示一个空页签或「敬请期待」。
 *     `isAvailable` 是同步谓词，所以它读的是**传进来的** `available`
 *     （由 `useGalleryTab()` 在挂载后确认），不是模块级可变状态 ——
 *     后者在 SSR 下是跨请求共享的，两个渲染会互相污染。
 */

import { useMemo } from "react";

import type { InsTabContribution, InsTabContext } from "@/features/ins/composition";

import { InsGalleryView } from "./ins-gallery-view";
import { GALLERY_ROUTES } from "./paths";

export function GalleryTabPanel({ tag }: InsTabContext): ReturnType<typeof InsGalleryView> {
  return <InsGalleryView tag={tag ?? null} />;
}

/**
 * 构造相册页签贡献。
 *
 * `available` 为 false 时 T03 的 `resolveTabs()` 会把这一项过滤掉，页签栏里
 * 连按钮都不会出现（验收「未接入不显示坏按钮」）。
 */
export function galleryTabContribution(available: boolean): InsTabContribution {
  return {
    id: GALLERY_ROUTES.insTabId,
    label: GALLERY_ROUTES.insTabLabel,
    ariaLabel: GALLERY_ROUTES.insTabAriaLabel,
    order: GALLERY_ROUTES.insTabOrder,
    isAvailable: () => available,
    render: GalleryTabPanel,
  };
}

/**
 * 把相册页签注册进**客户端**组合层（React 不允许把函数从服务端组件传给客户端组件，
 * 而 `render` / `isAvailable` 都是函数 —— T08 的 `ins-integration.tsx` 用同样的做法）。
 *
 * 用法（T00 在 `InsAppWithMessages` 那一层再加一个）：
 *
 * ```tsx
 * const gallery = useGalleryTabContribution(initialGalleryAvailable);
 * const contributions = [MESSAGES_TAB, ...(gallery ? [gallery] : [])];
 * ```
 */
export function useGalleryTabContribution(available: boolean): InsTabContribution | null {
  return useMemo(() => (available ? galleryTabContribution(true) : null), [available]);
}

/** 页签 id / 文案 / 顺序的路由映射，供 T00 复核（不要在多处各写一份字面量）。 */
export const GALLERY_TAB_META = Object.freeze({
  id: GALLERY_ROUTES.insTabId,
  label: GALLERY_ROUTES.insTabLabel,
  ariaLabel: GALLERY_ROUTES.insTabAriaLabel,
  order: GALLERY_ROUTES.insTabOrder,
});
