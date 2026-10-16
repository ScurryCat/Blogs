"use client";

/**
 * 手机内置应用模块（`PhoneAppModule` 形状，供 T00 写进 `features/phone/registry.ts`）。
 *
 * ```ts
 * {
 *   id: "metanav",
 *   kind: "embedded",
 *   canonical_path: "/apps/metanav",
 *   loader: () => import("@/features/metanav/phone-app"),
 *   screens: METANAV_SCREENS,   // ["palaces", "resolve", "search", "mugen"]
 * }
 * ```
 *
 * 宿主协议（02 §4）：
 *  - 只通过 `PhoneViewProps` 拿到 `screen` / `item` / `mode` / `host`，不读全局 `window`、
 *    不碰 DOM、不加音频、不锁 body；
 *  - 换屏用 `host.navigateScreen`（phone-internal：**不遮盖全站**）；
 *  - 只有明确点「进入殿堂」才用 `host.openSiteContent({source:"metaverse-entry"})`
 *    离开手机进入 canonical 专题页（动画由共享协调器执行，本模块不做遮罩、不用人群）；
 *  - 本机足迹用 `host.state`（版本化分区），因此与独立页共享同一份记录；
 *  - `dispose()` 取消全部未完成请求（见 `inflight.ts`）；足迹订阅与 `useLoader` 的读取
 *    则在各自组件卸载时清理，晚到的响应由 `isAbort()` 拦住，不写回状态。
 */

import type { ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { METANAV_SCREENS, type MetanavHost } from "./host";
import { abortAll } from "./inflight";
import { MetanavView } from "./metanav-view";

/** 本应用允许的屏幕集合；不在其中的 `screen` 由宿主回退到桌面。 */
export const screens = METANAV_SCREENS;

/** 宿主在应用退出时调用：取消未完成的请求。 */
export function dispose(): void {
  abortAll();
}

export default function MetanavPhoneView({ screen, item, host }: PhoneViewProps): ReactNode {
  const metanavHost: MetanavHost = {
    mode: "phone",
    openContent(request) {
      host.openSiteContent(request);
    },
    changeScreen(next, nextItem) {
      host.navigateScreen(next, nextItem ?? null);
    },
    state: host.state,
    toast(message, options) {
      host.toast(message, options);
    },
  };

  return <MetanavView screen={screen} item={item} host={metanavHost} />;
}
