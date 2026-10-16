"use client";

/**
 * 角色消息的手机模块（`PhoneAppModule` 形状；供 T00 把它并入 INS 的 loader）。
 *
 * 宿主读取的是模块的 **`default` 导出**并读同一模块里的 `screens` 枚举
 * （`features/phone/types.ts` / T03 的 `phone-app.tsx`）。
 *
 * ⚠️ 本包**不修改** `features/ins/phone-app.tsx`（T03 所有）。接线方式是 T00 在
 * INS 的 loader 里按屏幕名分派，具体差异见交付单 §6 的集成申请：
 *
 * ```ts
 * // features/ins/phone-app.tsx（T00 改，约 6 行）
 * import MessagingPhoneView, { screens as MESSAGING_SCREENS } from "@/features/messaging/phone-app";
 *
 * function InsPhoneRoot(props: PhoneViewProps) {
 *   if (MESSAGING_SCREENS.includes(props.screen)) return <MessagingPhoneView {...props} />;
 *   return <InsPhoneView {...props} />;
 * }
 * export default InsPhoneRoot;
 * export const screens = [...INS_APP_SCREENS, ...MESSAGING_SCREENS];
 * ```
 *
 * 在那之前，`screen=messages` 会被宿主正确回退桌面（不显示坏按钮），
 * 而 `/apps/ins/messages` 这个 canonical 路由已经可用。
 */

import { MessagingPhoneView, MESSAGING_APP_SCREENS } from "./phone-view";

export default MessagingPhoneView;

export const screens = MESSAGING_APP_SCREENS;
