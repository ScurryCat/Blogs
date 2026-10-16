/**
 * 手机应用平台：公开类型。
 *
 * 这是模块接入宿主的**唯一**入口（SHARED-CONTRACTS §3 / 02 §4）：
 * 应用只能使用这里导出的注册表、视图与宿主服务类型，
 * **不得直接操纵全局 DOM、不得自行锁 body、不得新增全局音频、不得独立决定主站转场**。
 *
 * 字段名沿用 02 §4 的 snake_case，与 API 的 JSON 命名保持一致，避免两套字段映射。
 */

import type { ComponentType } from "react";

/** 应用形态：内置视图，或指向站点内的普通页面。 */
export type PhoneAppKind = "embedded" | "site-link";

/** 导航来源。效果由宿主实现，模块只声明来源，不自己播放动画。 */
export type NavigationSource =
  | "top-nav"
  | "map-travel"
  | "phone-internal"
  | "phone-link"
  | "metaverse-entry";

/** 宿主展示模式。展开后进入 canonical 路由，恢复同一条内容。 */
export type PhoneDisplayMode = "compact" | "expanded";

/** URL 是「当前打开什么」的唯一依据；不再维护与之无关的平行返回栈。 */
export interface PhoneUrlState {
  /** "home" 或已注册的内置应用 id。 */
  phone: string;
  /** 应用内屏幕；由应用自己校验取值。 */
  screen: string | null;
  /** 详情标识（UUID 或 slug），由应用自己校验。 */
  item: string | null;
}

/** 供应用发起导航的请求：只有目的地与来源两个字段。 */
export interface NavigationRequest {
  /** 站内目的地（相对路径）。不接受外部 URL 或任意路径。 */
  destination: string;
  source: NavigationSource;
}

/**
 * 音频控制。**只暴露控制方法，不暴露音频元素** —— 宿主保留唯一的 audio，
 * 应用不能创建第二个播放器，也不能用换页/关闭手机来停止音乐。
 */
export interface PhoneAudioService {
  isPlaying(): boolean;
  play(): void;
  pause(): void;
  setVolume(volume: number): void;
  getVolume(): number;
}

/**
 * 版本化本机状态。按应用 id 分区，带容量上限；管理员会话等凭据**不放这里**。
 * 存储不可用时允许降级为内存，但要让调用方知道没能持久化。
 */
export interface PhoneStateService {
  get<T>(appId: string, key: string, fallback: T): T;
  set<T>(appId: string, key: string, value: T): { persisted: boolean };
  clear(appId: string): void;
}

/**
 * 宿主提供给应用的服务，共八项能力（02 §4）：
 * 打开应用、内部换屏、返回、关闭、打开站内内容、提示消息、音频控制、版本化本机状态。
 */
export interface PhoneHost {
  /** 打开另一个已注册应用；未注册的 id 不做任何事，不执行任意路径。 */
  openApp(appId: string, screen?: string | null, item?: string | null): void;
  /** 在当前应用内换屏。 */
  navigateScreen(screen: string, item?: string | null): void;
  /** 手机返回：与浏览器 Back 走同一条历史。 */
  back(): void;
  /** 关闭整个手机；有起点则回起点。 */
  close(): void;
  /** 跳转到站点内容，过场效果由来源决定。 */
  openSiteContent(request: NavigationRequest): void;
  /** 轻提示。 */
  toast(message: string, options?: { tone?: "info" | "error" }): void;
  audio: PhoneAudioService;
  state: PhoneStateService;
}

/** 传给应用视图的属性。视图不得假设自己独占页面，也不得读取全局 window。 */
export interface PhoneViewProps {
  /** 当前屏幕。 */
  screen: string;
  /** 详情标识，可能为空。 */
  item: string | null;
  mode: PhoneDisplayMode;
  host: PhoneHost;
}

/** 内置应用懒加载后得到的模块形状。 */
export interface PhoneAppModule {
  default: ComponentType<PhoneViewProps>;
  /** 该应用允许的屏幕集合；未列出的 screen 回退桌面，不执行任意路径。 */
  screens: readonly string[];
  /** 退出时清理订阅、定时器与未完成请求；晚到的响应不得写回状态。 */
  dispose?: () => void;
}

/** 应用注册字段：固定 10 个，不额外扩展（SHARED-CONTRACTS §4）。 */
export interface PhoneAppManifest {
  /** 稳定 id（如 ins / metanav），不随中文名称改变。 */
  id: string;
  name: string;
  subtitle: string;
  /** 已审核的图标资源路径。 */
  icon: string;
  /** 桌面排序。 */
  order: number;
  kind: PhoneAppKind;
  /** 独立页或站点目的地；用于展开、直接访问与无脚本回退。 */
  canonical_path: string;
  /** 受信任的构建期懒加载入口；**仅内置应用拥有**。 */
  loader?: () => Promise<PhoneAppModule>;
  /**
   * 编译期可用性开关。仅控制是否出现在桌面，
   * **不是鉴权** —— 被手动打开的接口仍须验证站主会话。
   * null 表示始终可用。
   */
  feature_flag: string | null;
  /** 本机状态结构版本，用于旧键迁移。 */
  state_version: number;
}
