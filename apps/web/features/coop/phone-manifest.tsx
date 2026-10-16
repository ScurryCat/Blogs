"use client";

/**
 * 手机桌面 manifest（10 个字段，SHARED-CONTRACTS §4）。
 *
 * 这是**交给 T00 登记**的清单：`features/phone/registry.ts` 归 T00 所有，
 * 本包不往宿主里塞条件分支。T00 直接把下面这个对象加进 `PHONE_APPS` 即可。
 *
 * `icon` 说明：`crow.webp` 是仓库里**已存在**的迁移图标资源
 * （`apps/web/public/assets/legacy/img/icon/`，T02 从旧站迁入，已审核），
 * 不新增任何素材。它只是应用图标，**不代表**该角色是真实友链：
 * 角色消息属于同人剧情（05 §11「真实友链与虚构角色分别建模」）。
 */

import type { PhoneAppManifest } from "@/features/phone/types";

export const COOP_PHONE_ICON = "/assets/legacy/img/icon/crow.webp";

export const COOP_PHONE_MANIFEST: PhoneAppManifest = {
  id: "coop",
  name: "协助者",
  subtitle: "友链通讯录",
  icon: COOP_PHONE_ICON,
  // 07 §7 的首屏顺序是 INS / 手记 / 放课后 / COOP / 异世界导航 / 音乐；
  // metanav 目前是 20，因此这里取 30 表示「排在导航之后」。要严格照首屏顺序，
  // 由 T00 统一给各应用的 order 重排一次（注册表归 T00）。
  order: 30,
  kind: "embedded",
  canonical_path: "/apps/coop",
  loader: () => import("@/features/coop/phone-app"),
  feature_flag: null,
  // 与 footprint / 本机筛选状态的存储键版本一致，便于将来迁移旧键。
  state_version: 1,
};

/** 本机状态分区键（`host.state` 用）：标签筛选是应用内状态。 */
export const COOP_STATE_KEY = "filter";
