/**
 * 站点自适配 App 的 AI 绘制图标（2026-10-18 站主授权）。
 *
 * 背景：原版 P5/P5R 手机桌面只有 IM / 地图 / 天气 / 相机等少数 App；本站的
 * 手记、放课后、协助者、我的殿堂、天鹅绒房间、印象空间、情报档案、档案属于
 * **站点自适配**，不存在可引用的原作图标。站主 2026-10-18 明确授权：
 * 「若游戏中不存在的 app，允许通过 ai 绘图绘制相同风格的 app 图标」。
 *
 * 因此这些图标是 **AI 生成的同风格适配图标**，不是 Atlus 原作素材：
 *  - 使用火山方舟 Seedream 生成，P5 红/黑/纸白 + 硬边/网点风格提示词；
 *  - 产物已裁成 256×256 PNG，路径固定、随仓库分发；
 *  - 渲染时带 `data-app-icon="ai-adapted"`，与已审核原版图标（`original`）区分；
 *  - 不冒充原作、不声称逐像素还原；生成记录见 `docs/design-references/ai-app-icons.md`。
 */

export const AI_APP_ICONS: Record<string, string> = {
  journal: "/assets/legacy/img/app/ai/journal.png",
  leisure: "/assets/legacy/img/app/ai/leisure.png",
  coop: "/assets/legacy/img/app/ai/coop.png",
  showcase: "/assets/legacy/img/app/ai/showcase.png",
  velvet: "/assets/legacy/img/app/ai/velvet.png",
  mementos: "/assets/legacy/img/app/ai/mementos.png",
  palace: "/assets/legacy/img/app/ai/palace.png",
  profile: "/assets/legacy/img/app/ai/profile.png",
  tokyo: "/assets/legacy/img/app/ai/tokyo.png",
  cast: "/assets/legacy/img/app/ai/cast.png",
};

/** 没有已审核原版图标、但有站主授权的 AI 同风格图标时返回其路径。 */
export function aiAppIcon(id: string): string | null {
  return AI_APP_ICONS[id] ?? null;
}

export const AI_APP_ICON_IDS = Object.keys(AI_APP_ICONS);
