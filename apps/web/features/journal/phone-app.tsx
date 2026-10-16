"use client";

/**
 * 手机内置应用模块（`PhoneAppModule` 形状，供集成方写进 `features/phone/registry.ts`）。
 *
 * ```ts
 * {
 *   id: "journal",
 *   kind: "embedded",
 *   canonical_path: "/apps/journal",
 *   loader: () => import("@/features/journal/phone-app"),
 *   screens: JOURNAL_SCREENS,   // ["list", "calendar"]
 * }
 * ```
 *
 * 宿主协议（02 §4）：
 *  - 只通过 `PhoneViewProps` 拿到 `screen` / `item` / `mode` / `host`；
 *    不读全局 `window`、不碰 DOM、不加音频、不锁 body；
 *  - 换屏用 `host.navigateScreen`（`phone-internal`：**不遮盖全站**）；
 *  - 打开某篇手记用 `host.openSiteContent({source:"phone-link"})` 进入 canonical 页面
 *    （过场由共享协调器决定，本模块不播动画）；
 *  - `dispose()` 取消未完成请求（见 `inflight.ts`）。
 */

import type { ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { JournalView } from "./journal-view";
import { JOURNAL_SCREENS, type JournalHost } from "./host";
import { abortAll } from "./inflight";

/** 本应用允许的屏幕集合；不在其中的 `screen` 由宿主回退到桌面。 */
export const screens = JOURNAL_SCREENS;

/** 宿主在应用退出时调用：取消未完成的请求。 */
export function dispose(): void {
  abortAll();
}

export default function JournalPhoneView({ screen, host }: PhoneViewProps): ReactNode {
  const journalHost: JournalHost = {
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

  return <JournalView screen={screen} host={journalHost} screens={screens} />;
}
