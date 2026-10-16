"use client";

/**
 * 手机内置应用模块（`PhoneAppModule` 形状，供 T00 写进 `features/phone/registry.ts`）。
 *
 * ```ts
 * {
 *   id: "coop",
 *   kind: "embedded",
 *   canonical_path: "/apps/coop",
 *   loader: () => import("@/features/coop/phone-app"),
 *   screens: COOP_SCREENS,   // ["links"]
 * }
 * ```
 *
 * 宿主协议（02 §4）：
 *  - 只通过 `PhoneViewProps` 拿到 `screen` / `item` / `mode` / `host`，不读全局 `window`、
 *    不碰 DOM、不加音频、不锁 body；
 *  - 展开一条友链用 `host.navigateScreen("links", id)`（phone-internal：**不遮盖全站**）。
 *    手机宿主的 URL 只有 `phone` / `screen` / `item`（02 §4），所以**标签筛选是应用内状态**：
 *    换屏或关掉手机会重置，独立页（`/apps/coop?tag=`）才把标签写进地址。
 *  - 外链是普通 `<a target="_blank">`，不经过宿主，也不改变手机状态；
 *  - `dispose()` 取消全部未完成请求（见 `inflight.ts`）。
 */

import { useState, type ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { CoopView } from "./coop-view";
import { abortAll } from "./inflight";

/** 本应用允许的屏幕集合；不在其中的 `screen` 由宿主回退到桌面。 */
export const COOP_SCREENS = ["links"] as const;

export const screens = COOP_SCREENS;

/** 宿主在应用退出时调用：取消未完成的请求，晚到的响应不写回状态。 */
export function dispose(): void {
  abortAll();
}

export default function CoopPhoneView({ screen, item, host }: PhoneViewProps): ReactNode {
  const [tag, setTag] = useState<string | null>(null);

  return (
    <CoopView
      mode="phone"
      tag={tag}
      item={item}
      onSelectTag={setTag}
      onSelectItem={(next) => host.navigateScreen(activeScreen(screen), next)}
      pageSize={8}
    />
  );
}

function activeScreen(screen: string): string {
  return (COOP_SCREENS as readonly string[]).includes(screen) ? screen : COOP_SCREENS[0];
}
