"use client";

/**
 * 手机桌面 manifest（10 个字段，SHARED-CONTRACTS §4）。
 *
 * 这是**交给 T00 登记**的清单：`features/phone/registry.ts` 归 T00 所有，
 * 本包不往宿主里塞条件分支。T00 直接把下面这个对象加进 `PHONE_APPS` 即可。
 *
 * `icon` 说明（第三轮 N6 素材清理后）：原先用的 `icon/crow.webp` 是角色「Crow /
 * 明智吾郎」的独立头像，按第三轮任务书 §5 必须从活动素材库与网站公开目录移除；
 * 现改用旧站**既有**的配对图标 `app/coop.png`（T02 已迁入、画面复核为两个并肩的人形，
 * 无角色、无文字），语义就是「协助者 / 友链」，不新增 AI 素材。
 * 图标只表示应用功能，**不代表**该角色是真实友链：角色消息属于同人剧情
 * （05 §11「真实友链与虚构角色分别建模」）。记录见
 * `docs/design-references/persona-assets-allowlist.md`。
 */

import type { PhoneAppManifest } from "@/features/phone/types";

export const COOP_PHONE_ICON = "/assets/legacy/img/app/coop.png";

export const COOP_PHONE_MANIFEST: PhoneAppManifest = {
  id: "coop",
  name: "协助者",
  subtitle: "友链通讯录",
  icon: COOP_PHONE_ICON,
  // 07 §7 的首屏顺序是 INS / 手记 / 放课后 / **COOP** / 异世界导航 / 音乐。
  // T00 集成时按设计**统一预留序位**：ins(10) / 手记(20) / 放课后(30) / coop(40) / metanav(50)
  // —— 本包最初建议的 30 会让 COOP 排在导航之后，与设计相反，故改为 40。
  order: 40,
  kind: "embedded",
  canonical_path: "/apps/coop",
  loader: () => import("@/features/coop/phone-app"),
  feature_flag: null,
  // 与 footprint / 本机筛选状态的存储键版本一致，便于将来迁移旧键。
  state_version: 1,
};

/** 本机状态分区键（`host.state` 用）：标签筛选是应用内状态。 */
export const COOP_STATE_KEY = "filter";
