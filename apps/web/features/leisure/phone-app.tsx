"use client";

/**
 * 手机内置应用模块（`PhoneAppModule` 形状，供集成方写进 `features/phone/registry.ts`）。
 *
 * ```ts
 * {
 *   id: "leisure",
 *   kind: "embedded",
 *   canonical_path: "/apps/leisure",
 *   loader: () => import("@/features/leisure/phone-app"),
 *   screens: LEISURE_SCREENS,   // ["anime", "game"]
 * }
 * ```
 *
 * 宿主协议（02 §4）：只通过 `PhoneViewProps` 拿参数；换屏用 `host.navigateScreen`
 * （`phone-internal`，不遮盖全站）；不读全局 `window`、不碰 DOM、不加音频、不锁 body；
 * `dispose()` 取消未完成请求。
 */

import type { ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { abortAll } from "./inflight";
import { LeisureView } from "./leisure-view";
import { LEISURE_SCREENS, type LeisureHost } from "./host";

/** 本应用允许的屏幕集合；不在其中的 `screen` 由宿主回退到桌面。 */
export const screens = LEISURE_SCREENS;

/** 宿主在应用退出时调用：取消未完成的请求。 */
export function dispose(): void {
  abortAll();
}

export default function LeisurePhoneView({ screen, host }: PhoneViewProps): ReactNode {
  const leisureHost: LeisureHost = {
    mode: "phone",
    openContent(request) {
      host.openSiteContent(request);
    },
    changeScreen(next) {
      host.navigateScreen(next);
    },
    state: host.state,
    toast(message, options) {
      host.toast(message, options);
    },
  };

  return <LeisureView screen={screen} host={leisureHost} screens={screens} />;
}
