"use client";

/**
 * 问题记录的手机内置模块（`PhoneAppModule` 形状，T09）。
 *
 * 宿主 `PhoneRegistry.load()` 取模块的 **`default` 导出**，并读同一模块里的 `screens`
 * 枚举。T00 登记时只需要一行 `() => import("@/features/exploration/phone-app")`。
 *
 * `screens` 只列本应用真的实现的屏幕：
 *   - `records` 问题记录列表（默认屏）
 *   - `record`  单条记录（`item` 是 **slug**；非 slug 显示「不存在」，不执行任意路径）
 */

import { ExplorationPhoneView } from "./phone-view";

export default ExplorationPhoneView;

export const screens = ["records", "record"] as const;

/** 退出时取消在途请求：每个屏幕的 effect 卸载时已 abort 自己的请求。 */
export function dispose(): void {
  /* 见上：请求由各屏幕组件持有并在卸载时取消。 */
}
