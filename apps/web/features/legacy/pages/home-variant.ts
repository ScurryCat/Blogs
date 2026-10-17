/**
 * 首页排版变体（2026-10-17 · 用户验证反馈 R4）。
 *
 * 三套排版先在**同一个页面**里用 `?home=a|b|c` 并存，方便用户对照截图后选择：
 *   - `a` 现状精修（默认）——保持既有区块顺序，只修 Hero 栏目可读性与首屏适配；
 *   - `b` 杂志版——Hero 紧凑 +「最新文章 / 精选作品」两栏摘要；
 *   - `c` 应用枢纽版——Hero 短版 + 9 个视觉还原应用入口网格；
 *   - `d` 精修·人物卡片版——A 的顺序不变，把主角卡缩小、右移、略降。
 *
 * 用户选定后再把所选变体设为默认（并移除未选变体与切换参数）。
 * 非法/缺省一律回 `a`，保证旧链接行为不变。
 */

export type HomeVariant = "a" | "b" | "c" | "d";

export const HOME_VARIANTS: readonly HomeVariant[] = ["a", "b", "c", "d"] as const;

export const DEFAULT_HOME_VARIANT: HomeVariant = "a";

export function pickHomeVariant(
  value: string | readonly string[] | undefined,
): HomeVariant {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "a" || raw === "b" || raw === "c" || raw === "d") return raw;
  return DEFAULT_HOME_VARIANT;
}
