/**
 * 视图层的纯部分：宿主接口、屏幕枚举、路径与格式化。
 *
 * 这里**不导入任何 React Hook**：专题阅读页是服务端组件，它需要 `palacePath` /
 * `formatDate` 这些纯函数与类型；把 Hook 一起放进来的话，Server Component 会因为
 * 「导入了依赖 useEffect 的模块」直接构建失败（真实踩到过）。
 * React 侧（`useLoader`）在 `host.ts`，并从本文件再导出这些符号。
 */

import type { NavigationRequest } from "@/features/phone/types";

import type { Failure } from "./failure";
import type { StateAdapter } from "./footprint";

export type HostMode = "phone" | "site";

export interface MetanavHost {
  mode: HostMode;
  /** 站内跳转（进入殿堂 / 打开文章）。来源由调用方给出，效果由共享协调器决定。 */
  openContent(request: NavigationRequest): void;
  /** App 内换屏。 */
  changeScreen(screen: string, item?: string | null): void;
  state: StateAdapter;
  toast(message: string, options?: { tone?: "info" | "error" }): void;
}

export const METANAV_SCREENS = ["palaces", "resolve", "search", "mugen", "palace"] as const;
export type MetanavScreen = (typeof METANAV_SCREENS)[number];

export function isMetanavScreen(value: string | null | undefined): value is MetanavScreen {
  return !!value && (METANAV_SCREENS as readonly string[]).includes(value);
}

/** 专题的 canonical 地址（服务端搜索结果里的 href 也用同一条）。 */
export function palacePath(slug: string): string {
  return `/apps/metanav/palaces/${encodeURIComponent(slug)}`;
}

export function postPath(slug: string): string {
  return `/posts/${encodeURIComponent(slug)}`;
}

/** ISO 时间 → 本机展示用的短时间。 */
export function formatWhen(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

/**
 * 视图层共用的宿主接口与加载状态。
 *
 * 「同一内容在手机与 canonical 页面使用同一功能视图和数据」（SHARED-CONTRACTS §1）：
 * 手机里的内置应用与独立页渲染的是**同一个** `MetanavView`，差别只在注入的宿主：
 *
 * | 能力 | 手机（embedded） | 独立页（site） |
 * | --- | --- | --- |
 * | 明确进入殿堂 | `host.openSiteContent({source:"metaverse-entry"})` | `SiteLink` + 导航协调器 |
 * | App 内换屏 | `host.navigateScreen`（phone-internal，不遮盖全站） | push `?screen=&item=` |
 * | 本机状态 | `host.state`（版本化分区） | 同一套键的 `LocalStateService` |
 * | 提示 | `host.toast` | 全站 Toast |
 *
 * 应用**不直接碰全局 DOM、不加音频、不锁 body、不改 history**（02 §4）。
 */

