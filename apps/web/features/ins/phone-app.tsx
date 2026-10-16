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

import { InsPhoneView } from "./phone-view";

export default InsPhoneView;

export const screens = ["feed", "detail", "saved"] as const;
