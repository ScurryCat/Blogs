"use client";

/**
 * INS 的手机应用清单与模块（**供 T00 登记，本包不修改 `registry.ts`**）。
 *
 * T00 在 `features/phone/registry.ts` 里加一项即可（`loader` 必须是构建期静态 import）：
 *
 * ```ts
 * import { INS_MANIFEST } from "@/features/ins/phone-manifest";
 * export const PHONE_APPS: readonly PhoneAppManifest[] = Object.freeze([INS_MANIFEST]);
 * ```
 *
 * 宿主的 `createPhoneRegistry` 会校验十字段 manifest（`load()` 只接受 embedded +
 * `loader`），因此不需要改宿主或加条件分支（02 §164、SHARED-CONTRACTS §4）。
 *
 * `screens` 只列本应用真的实现的屏幕：`feed` 与 `detail`。
 * **不列 `messages`** —— 那是 T08 的应用子路由，未接入就不放在枚举里，
 * 于是宿主对 `screen=messages` 会正确回退桌面，而不是渲染一个空壳（验收用例 5）。
 */

import type { PhoneAppManifest, PhoneAppModule } from "@/features/phone/types";

import InsPhoneRoot, { screens as INS_PHONE_SCREENS } from "./phone-app";

export const INS_APP_ID = "ins";

export const INS_MANIFEST: PhoneAppManifest = {
  id: INS_APP_ID,
  name: "INS",
  subtitle: "图文动态 · 相册与消息后续接入",
  icon: "/assets/legacy/img/icon/joker.webp",
  order: 10,
  kind: "embedded",
  canonical_path: "/apps/ins",
  // 必须用 phone-app 里的分派根：消息屏由 T08 的实现渲染，其余屏由 INS 自己渲染。
  // 之前这里写的是 InsPhoneView、screens 也只有 INS 自己的三个 —— 于是手机里点角色后
  // `screen=conversation` 不被识别，宿主回退桌面（表现为「离开手机」）。
  loader: async (): Promise<PhoneAppModule> => ({
    default: InsPhoneRoot,
    screens: INS_PHONE_SCREENS,
  }),
  feature_flag: null,
  state_version: 1,
};
