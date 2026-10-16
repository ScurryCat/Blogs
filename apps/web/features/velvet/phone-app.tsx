"use client";

/**
 * 技能全书的手机内置模块（`PhoneAppModule` 形状）。
 *
 * 为什么单独一个文件：宿主 `PhoneRegistry.load()` 取模块的 **`default` 导出**，并读同一
 * 模块里的 `screens` 枚举（`features/phone/types.ts`）。T00 登记时只需要一行
 * `() => import("@/features/velvet/phone-app")`。
 *
 * `screens` 只列本应用真的实现的屏幕：
 *   - `book`  技能全书（默认屏）
 *   - `skill` 某门技能（`item` 是 **slug**；非 slug 的值显示「不存在」，不执行任意路径）
 *
 * 手机与独立页读**同一份数据**（同一批公开端点），不复制内容（验收 2）。
 */

import { VelvetPhoneView } from "./phone-view";

export default VelvetPhoneView;

export const screens = ["book", "skill"] as const;

/**
 * 退出时取消在途请求。
 *
 * 本应用没有模块级的请求登记表（每个屏幕组件自己持有 `AbortController` 并在卸载时
 * abort），因此这里不需要额外动作 —— 保留一个显式的空实现，是为了让宿主契约
 * （`dispose` 可选）在阅读代码时可见，而不是让读者猜「为什么没有 dispose」。
 */
export function dispose(): void {
  /* 每个屏幕的 effect 卸载时已 abort 自己的请求。 */
}
