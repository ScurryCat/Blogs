/**
 * 手机 URL 状态（02 §6）。
 *
 * 三个保留参数：`phone`（`home` 或内置应用 id）、`screen`（应用允许的屏幕）、
 * `item`（详情 UUID 或 slug）。**URL 是「当前打开什么」的唯一依据**，
 * 不再维护一份与 URL 无关的平行返回栈。
 *
 * 本模块是纯函数：只做解析 / 序列化与保留其他查询参数，
 * 合法性（应用是否注册、屏幕是否被允许）由宿主用注册表校验。
 */

import type { PhoneUrlState } from "./types";

export const PHONE_PARAMS = ["phone", "screen", "item"] as const;

export type PhoneSearchInput = string | URLSearchParams;

function toParams(input: PhoneSearchInput): URLSearchParams {
  if (typeof input !== "string") return new URLSearchParams(input);
  // `?phone=home` 与 `phone=home` 都要能解析。
  return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
}

/** 解析出手机状态；没有 `phone` 参数时返回 null（= 没打开手机）。 */
export function parsePhoneState(input: PhoneSearchInput): PhoneUrlState | null {
  const params = toParams(input);
  const phone = params.get("phone");
  if (!phone) return null;
  const screen = params.get("screen");
  const item = params.get("item");
  return { phone, screen: screen ?? null, item: item ?? null };
}

/** 去掉手机参数后的查询串（保留页面原有的其他参数）。 */
export function withoutPhoneParams(input: PhoneSearchInput): string {
  const params = toParams(input);
  for (const key of PHONE_PARAMS) params.delete(key);
  return params.toString();
}

/**
 * 生成带手机状态的地址。`base` 是当前页面路径（不含查询串），
 * 其他查询参数按原顺序保留，手机参数写在最后。
 */
export function buildPhoneUrl(
  basePath: string,
  currentSearch: PhoneSearchInput,
  state: PhoneUrlState | null,
): string {
  const params = toParams(currentSearch);
  for (const key of PHONE_PARAMS) params.delete(key);
  if (state) {
    params.set("phone", state.phone);
    if (state.screen) params.set("screen", state.screen);
    if (state.item) params.set("item", state.item);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * 计算「返回上一层」的手机状态：
 * 详情 → 应用首页 → 桌面。返回值 `null` 表示应关闭手机（桌面再往回退）。
 */
export function parentPhoneState(state: PhoneUrlState): PhoneUrlState | null {
  if (state.item) return { phone: state.phone, screen: state.screen, item: null };
  if (state.screen && state.phone !== "home") return { phone: state.phone, screen: null, item: null };
  if (state.phone !== "home") return { phone: "home", screen: null, item: null };
  return null;
}

/** 手机是否处于「桌面」状态。 */
export function isPhoneHome(state: PhoneUrlState | null): boolean {
  return state?.phone === "home";
}
