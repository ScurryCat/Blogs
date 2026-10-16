/**
 * 印象空间的路径（04 §4C）。
 *
 * 首版复用现有文章分类作为「路径」，**每条路径旁保留普通中文解释**，
 * 不做随机迷宫引擎、不按注册 / 访问天数 / 等级锁住技术文章。
 * 分类没有文章时给出空态（数据由 `/api/v1/posts?category=` 提供）。
 *
 * 分类取自迁移基线的真实分类（TECH / LIFE / TOOL / GAME / BOOK / INFO）；
 * 这里只是「路径的解释文案」，不代表文章内容本身。
 */

export interface MugenPath {
  category: string;
  label: string;
  hint: string;
}

export const MUGEN_PATHS: readonly MugenPath[] = [
  { category: "TECH", label: "技术", hint: "实现、可访问性与踩过的坑" },
  { category: "LIFE", label: "生活", hint: "旅行与日常里的观察" },
  { category: "TOOL", label: "工具", hint: "写作与工作流里用得到的东西" },
  { category: "GAME", label: "游戏", hint: "玩过的东西与记录" },
  { category: "BOOK", label: "阅读", hint: "读完之后的笔记" },
  { category: "INFO", label: "说明", hint: "站点自身的说明与素材来源" },
];

/** 「随便深入」：从当前**已加载的公开结果**里挑一条，不伪装成 AI 判断（04 §4C）。 */
export function pickRandom<T>(items: readonly T[], random: () => number = Math.random): T | null {
  if (!items.length) return null;
  const index = Math.floor(random() * items.length);
  return items[Math.min(Math.max(index, 0), items.length - 1)] ?? null;
}
