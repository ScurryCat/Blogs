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
  // 原稿用 fox.webp，但 T00 集成时已把 fox 给了「放课后」（T05），改用仓库里同样真实存在
  // 且未被占用的 violet.webp，避免桌面上两个应用同图标。
  icon: "/assets/legacy/img/icon/violet.webp",
  // 07 §7 的手机首屏顺序是 INS(10) / 手记(20) / 放课后(30) / COOP(40) / 异世界导航(50) ——
  // 「我的殿堂」不在那份清单里，因此排在它们**之后**（60），保持设计顺序原样。
  order: 60,
  kind: "embedded",
  canonical_path: "/showcase",
  loader: () => import("@/features/showcase/phone-app"),
  feature_flag: null,
  state_version: 1,
};
