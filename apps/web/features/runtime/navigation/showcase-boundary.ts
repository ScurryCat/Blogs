/**
 * 「我的殿堂」（作品）边界判定 —— 供导航意图与手机 `openApp` 共用。
 *
 * 任务书 §6.1 要求判定的是**主动跨入作品殿堂边界**，而不是「监听到 /showcase 就播放」：
 *
 *  - 殿堂外进入 `/showcase`（顶部导航、地图上野、手机桌面图标、首页卡片、外部详情链接）
 *    才产生 `enter-showcase` 意图；
 *  - 殿堂内部（当前已在 `/showcase/...`，或手机正停在 showcase 应用里）不再产生意图，
 *    因此切换作品、回列表、展开同一内容不会重播过场；
 *  - 旧照片地址 `/showcase/photos`（第三轮起重定向进生活图库）**不属于**殿堂边界，
 *    不能因为路径里带 showcase 就播殿堂过场；
 *  - `/apps/metanav/palaces/...` 等名字里含 palace 的既有内容不经这里判定，也不得自动归类为作品集。
 */

import type { NavigationIntent } from "@/features/phone/types";

/** 作品殿堂根路径。 */
export const SHOWCASE_ROOT = "/showcase";

/** 已迁出殿堂、保留兼容重定向的旧路径前缀（不算殿堂边界）。 */
const SHOWCASE_LEGACY_PREFIXES = ["/showcase/photos"] as const;

function normalize(pathname: string): string {
  // 去掉查询 / 哈希；统一去掉结尾斜杠（保留根路径）。
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path;
}

/** 该路径是否属于作品殿堂内容边界。 */
export function isShowcasePath(pathname: string): boolean {
  const path = normalize(pathname);
  if (path === SHOWCASE_ROOT) return true;
  if (!path.startsWith(`${SHOWCASE_ROOT}/`)) return false;
  return !SHOWCASE_LEGACY_PREFIXES.some(
    (legacy) => path === legacy || path.startsWith(`${legacy}/`),
  );
}

/**
 * 当前是否已经在殿堂内部。
 *
 * `phoneApp` 是手机 URL 里的 `phone` 参数：手机停在 showcase 应用里时，
 * 之后「展开查看」到 canonical 页面属于同一内容的展开，不能重播过场。
 */
export function isInsideShowcase(pathname: string, phoneApp?: string | null): boolean {
  if (phoneApp === "showcase") return true;
  return isShowcasePath(pathname);
}

/**
 * 把「目的地 + 当前上下文」换算成导航意图；不在殿堂边界内时返回 `null`。
 *
 * 纯粹做**意图判定**，不改目的地：真实 href、历史记录与子页面高亮都不受影响。
 */
export function showcaseEntryIntent(
  destination: string,
  origin: { pathname: string; phoneApp?: string | null },
): NavigationIntent | null {
  if (!destination.startsWith("/")) return null;

  let target: URL;
  try {
    target = new URL(destination, "http://site.invalid");
  } catch {
    return null;
  }
  if (!isShowcasePath(target.pathname)) return null;
  if (isInsideShowcase(origin.pathname, origin.phoneApp)) return null;
  return "enter-showcase";
}
