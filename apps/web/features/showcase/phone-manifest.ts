"use client";

/**
 * 我的殿堂的手机应用清单（T06 交付给 T00 登记的 10 字段 manifest）。
 *
 * 说明：
 *  - `icon` 用的是仓库里**真实存在**的迁移图标（`public/assets/legacy/img/icon/fox.webp`，
 *    T02 从旧站 `assets/img/icon/` 迁移过来的资源），不新增任何素材；
 *    选狐狸（祐介 / EMPEROR）是因为「画廊 / 美术」的角色气质最贴近展厅。
 *  - `loader` 指向本包的 `phone-app.tsx`（`export default` + `screens` + `dispose`）。
 *  - `state_version` 为 1：本应用**不写任何本机状态**（没有收藏 / 足迹），
 *    这个值只是契约要求的字段，保持与将来扩展时的迁移空间。
 *  - `canonical_path` 是 `/showcase`：独立页与手机视图读同一份数据（验收 4）。
 */

import type { PhoneAppManifest } from "@/features/phone/types";

export const SHOWCASE_MANIFEST: PhoneAppManifest = {
  id: "showcase",
  name: "殿堂",
  subtitle: "作品与照片",
  icon: "/assets/legacy/img/icon/fox.webp",
  order: 30,
  kind: "embedded",
  canonical_path: "/showcase",
  loader: () => import("@/features/showcase/phone-app"),
  feature_flag: null,
  state_version: 1,
};
