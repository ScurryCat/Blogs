"use client";

/**
 * 技能全书的手机应用清单（T09 交付给 T00 登记的 10 字段 manifest）。
 *
 * 说明：
 *  - `icon` 用的是仓库里**真实存在**的迁移图标（`public/assets/legacy/img/icon/queen.webp`，
 *    T02 从旧站 `assets/img/icon/` 迁移过来的资源），不新增任何素材。
 *    已占用的图标：ins=joker、journal=morgana、leisure=fox、coop=?、showcase=violet、
 *    metanav=oracle；`queen` 与 `crow` / `noir` / `panther` / `skull` 仍未被占用。
 *    选 queen 是因为「冷光 / 审判」的气质最贴近天鹅绒房间的蓝黑场景，纯属视觉选择。
 *  - `loader` 指向本包的 `phone-app.tsx`（`export default` + `screens` + `dispose`）。
 *  - `state_version` 为 1：本应用**不写任何本机状态**（没有收藏 / 足迹），
 *    这个值只是契约要求的字段，留给将来扩展时的迁移空间。
 *  - `canonical_path` 是 `/velvet`：独立页与手机视图读同一份数据（验收 2）。
 *  - **order 待定（集成申请）**：07 §7 的首屏清单是 INS(10) / 手记(20) / 放课后(30) /
 *    COOP(40) / 异世界导航(50)；「我的殿堂」已占 60。天鹅绒房间在 07 §7 里
 *    **不在**首屏清单中（它是「档案 / 异世界导航的特殊入口」），因此这里给 70，
 *    排在既有顺序之后，不打断设计顺序。若 T00 认为它不该出现在桌面，
 *    不登记即可 —— 本包的功能不依赖手机入口（独立页 `/velvet` 已完整可用）。
 */

import type { PhoneAppManifest } from "@/features/phone/types";

export const VELVET_MANIFEST: PhoneAppManifest = {
  id: "velvet",
  name: "天鹅绒",
  subtitle: "技能全书",
  icon: "/assets/legacy/img/icon/queen.webp",
  order: 70,
  kind: "embedded",
  canonical_path: "/velvet",
  loader: () => import("@/features/velvet/phone-app"),
  feature_flag: null,
  state_version: 1,
};
