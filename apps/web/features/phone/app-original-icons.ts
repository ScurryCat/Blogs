/**
 * 已审核原版手机桌面图标（第三轮 P4 桌面 / 交接验收 F2 返工）。
 *
 * 背景：桌面此前默认用第二轮 AI 生成位图（`app/<id>.png`），原版图标要求未完成。
 * 本轮只接入**已核对身份/版本/画面且来源可追溯**的两个原版图标：
 *  - `metanav`：异世界导航经典红眼（红眼 + 星形瞳孔 + 黑色外刺）；
 *  - `ins`：原版消息标识（IM 红色对话框）。
 * 其余应用暂时保留适配设计（AI 位图 / 自绘 SVG），逐项标记见
 * `docs/design-references/original-app-icons.md` 与 `docs/design-references/icon-mapping.md`。
 *
 * 资源是本地静态文件（随仓库发布），不是外链；来源 / 哈希 / 裁切记录见上述文档。
 */

/** app id → 已审核原版图标公开路径（缺失的 app 走适配设计回退）。 */
export const ORIGINAL_APP_ICONS: Readonly<Record<string, string>> = {
  ins: "/assets/legacy/img/app/original/ins-original.png",
  metanav: "/assets/legacy/img/app/original/metanav-original.png",
};

export function originalAppIcon(appId: string): string | undefined {
  return ORIGINAL_APP_ICONS[appId];
}
