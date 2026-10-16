"use client";

/**
 * INS 的手机内置模块（`PhoneAppModule` 形状）。
 *
 * 为什么单独一个文件：宿主 `PhoneRegistry.load()` 取的是模块的 **`default` 导出**，
 * 并读同一模块里的 `screens` 枚举（`features/phone/types.ts`）。把这件事和视图实现
 * 分开，T00 登记时只需要一行 `() => import("@/features/ins/phone-app")`。
 *
 * `screens` 只列本应用真的实现的屏幕：
 *   - `feed`   信息流（默认屏）
 *   - `detail` 某一条动态（`item` 必须是 UUID，否则视图显示「不存在」）
 *   - `saved`  本机收藏
 *
 * **不列 `messages`**：那是 T08 的应用子路由，未接入就不放进枚举 ——
 * 宿主对未列出的 screen 会正确回退桌面，而不是渲染一个空壳（验收用例 5）。
 */

import type { PhoneViewProps } from "@/features/phone/types";
import MessagingPhoneView, { screens as MESSAGING_SCREENS } from "@/features/messaging/phone-app";

import { InsPhoneView } from "./phone-view";

/**
 * 手机根：把消息屏分派给 T08 的实现，其余屏仍由 INS 自己处理。
 *
 * 不做这一步的后果是**明确的**：`screen=messages` 会被宿主正确回退桌面（不显示坏按钮），
 * 但消息功能在手机上就进不去 —— 不是坏体验，是缺功能。
 */
/** INS 自己实现的屏幕（原来的 `screens` 导出）。 */
const INS_APP_SCREENS = ["feed", "detail", "saved"] as const;

function InsPhoneRoot(props: PhoneViewProps) {
  if ((MESSAGING_SCREENS as readonly string[]).includes(props.screen)) {
    return <MessagingPhoneView {...props} />;
  }
  return <InsPhoneView {...props} />;
}

export default InsPhoneRoot;

export const screens = [...INS_APP_SCREENS, ...MESSAGING_SCREENS] as const;
