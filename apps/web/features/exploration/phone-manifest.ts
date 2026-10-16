"use client";

/**
 * 问题记录的手机应用清单（T09 交付给 T00 登记的 10 字段 manifest）。
 *
 * 说明：
 *  - `icon` 用仓库里**真实存在**的迁移图标（`public/assets/legacy/img/icon/crow.webp`），
 *    不新增任何素材。已占用：ins=joker、journal=morgana、leisure=fox、showcase=violet、
 *    metanav=oracle、velvet=queen；`crow` / `noir` / `panther` / `skull` 仍未被占用。
 *  - `loader` 指向本包的 `phone-app.tsx`。
 *  - `state_version` 为 1：本应用不写本机状态。
 *  - `canonical_path` 是 `/apps/metanav/mementos`（任务卡指定的路径）。
 *  - **order 待定（集成申请）**：07 §7 的首屏清单没有「印象空间」这一项
 *    （它是异世界导航内部的一层）。这里给 80，排在所有既有应用之后；
 *    若 T00 认为它不该单独占一个桌面图标，**不登记即可** ——
 *    独立页 `/apps/metanav/mementos` 与 T04 导航内的入口都不依赖它。
 */

import type { PhoneAppManifest } from "@/features/phone/types";

export const EXPLORATION_MANIFEST: PhoneAppManifest = {
  id: "mementos",
  name: "印象空间",
  subtitle: "问题记录",
  icon: "/assets/legacy/img/icon/crow.webp",
  order: 80,
  kind: "embedded",
  canonical_path: "/apps/metanav/mementos",
  loader: () => import("@/features/exploration/phone-app"),
  feature_flag: null,
  state_version: 1,
};
