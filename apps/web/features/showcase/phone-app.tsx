"use client";

/**
 * 我的殿堂的手机内置模块（`PhoneAppModule` 形状）。
 *
 * 为什么单独一个文件：宿主 `PhoneRegistry.load()` 取模块的 **`default` 导出**，并读同一
 * 模块里的 `screens` 枚举（`features/phone/types.ts`）。T00 登记时只需要一行
 * `() => import("@/features/showcase/phone-app")`。
 *
 * `screens` 只列本应用真的实现的屏幕：
 *   - `projects` 作品列表（默认屏）
 *   - `project`  某件作品（`item` 是 **slug**；非 slug 的值显示「不存在」，不执行任意路径）
 *   - `photos`   照片墙（跨相册）
 *   - `album`    某个相册（`item` 是 **slug**）
 *
 * 手机与独立页读**同一份数据**（同一批公开端点），不复制内容（验收 4）。
 */

import { ShowcasePhoneView } from "./phone-view";

export default ShowcasePhoneView;

export const screens = ["projects", "project", "photos", "album"] as const;

/** 退出时取消在途请求（宿主在关闭手机 / 换 App 时调用）。 */
export { disposeShowcase as dispose } from "./inflight";
