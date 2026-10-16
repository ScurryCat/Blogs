"use client";

/**
 * INS 接线（T06 提供的**最小侵入**组合件；与 T08 的 `features/messaging/ins-integration.tsx`
 * 同形且**可以叠加**）。
 *
 * 为什么需要这一层：`InsTabContribution.render` 与 `isAvailable` 都是**函数**，
 * React 不允许把函数从服务端组件传给客户端组件（会报
 * 「Functions cannot be passed directly to Client Components」），而 T03 的
 * `app/apps/ins/page.tsx` 是服务端组件。因此页签必须在客户端这一侧注入。
 *
 * T00 接线方式（与 T08 已经做过的完全一致，只多包一层）：
 *
 * ```tsx
 * // app/apps/ins/page.tsx
 * - import { InsAppWithMessages } from "@/features/messaging/ins-integration";
 * + import { InsAppWithGalleryAndMessages } from "@/features/gallery/ins-integration";
 * - <InsAppWithMessages … />
 * + <InsAppWithGalleryAndMessages … />
 * ```
 *
 * 本文件只做「组合」：不复制 T03 的 INS 实现，也不修改 T08 的文件。
 * 两个页签的 id 与顺序都不同（gallery = 35、messages = 40），可以共存。
 */

import { type ReactNode } from "react";

import { InsApp, type InsAppProps } from "@/features/ins/ins-app";
import { MESSAGES_TAB } from "@/features/messaging/messages-tab";

import { galleryTabContribution } from "./ins-tab";
import { useGalleryTab } from "./ins-tab-availability";

export interface GalleryAvailabilityProps {
  /**
   * 服务端已经读过第一页相册时把结论传进来（`true` = 有公开相册）。
   * 不传 / 传 null 时由客户端确认一次（首屏没有相册页签，确认后出现）。
   */
  initialGalleryAvailable?: boolean | null;
}

/**
 * INS 的组合壳：**消息页签（T08）+ 相册页签（T06）**。
 *
 * 相册页签的可用性由 `useGalleryTab()` 权威确认：没有任何公开相册时
 * `isAvailable()` 返回 false，T03 的 `resolveTabs()` 会把这一项**完全不渲染**，
 * 因此不会出现点了没内容的空页签（验收「未接入不显示坏按钮」）。
 */
export function InsAppWithGalleryAndMessages({
  initialGalleryAvailable = null,
  tabContributions = [],
  ...props
}: InsAppProps & GalleryAvailabilityProps): ReactNode {
  const gallery = useGalleryTab(
    initialGalleryAvailable === null
      ? {}
      : { initialAvailable: initialGalleryAvailable },
  );
  // 页签顺序由 T03 的 `resolveTabs()` 按 order 排：feed(10) → saved(20) →
  // gallery(35) → messages(40)。这里只负责把两项都递进去。
  const contributions = [
    ...tabContributions,
    MESSAGES_TAB,
    ...(gallery.available ? [galleryTabContribution(true)] : []),
  ];
  return <InsApp {...props} tabContributions={contributions} />;
}

/**
 * 手机里的 INS 只要相册页签（消息页签由 T08 的 `phone-view.tsx` 单独注入）。
 *
 * 用法（T00 在 T08 的 `phone-view.tsx` 里改一行，见交付单 §集成申请）：
 *
 * ```tsx
 * const gallery = useGalleryTabContribution(initialGalleryAvailable);
 * tabContributions={[...(gallery ? [gallery] : []), messagesTab]}
 * ```
 */
export { useGalleryTabContribution } from "./ins-tab";
