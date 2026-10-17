/**
 * 站内链接的点击判定（供 HTML 与 SVG 两种 `<a>` 共用）。
 *
 * 规则（02 §8）：
 *  - 只有**普通左键点击**才走站内过场；
 *  - Ctrl / Cmd / Shift / Alt、中键、`target`、`download` 一律放行给浏览器；
 *  - 站外地址不接管；
 *  - 键盘 Enter 触发的就是同一次 click，因此与鼠标点击等价。
 *
 * 单独成模块是因为地图 SVG 里的 `<a>` 是 `SVGAElement`，不能复用 HTML 锚点的类型，
 * 但两者必须走**完全一致**的判定 —— 否则地图图标、出发与顶部导航会出现行为差异。
 */

import type {
  NavigationIntent,
  NavigationRequest,
  NavigationSource,
} from "@/features/phone/types";

/** 点击事件里与「是否接管」有关的最小字段。 */
export interface ClickContext {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** 锚点元素里与「是否接管」有关的最小字段（HTML 与 SVG 都有）。 */
export interface AnchorContext {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export function navigationRequestFromClick(
  event: ClickContext,
  anchor: AnchorContext,
  href: string,
  source: NavigationSource,
  intent?: NavigationIntent,
): NavigationRequest | null {
  if (event.defaultPrevented) return null;
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.getAttribute("target") || anchor.hasAttribute("download")) return null;

  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;

  return intent
    ? { destination: `${url.pathname}${url.search}${url.hash}`, source, intent }
    : { destination: `${url.pathname}${url.search}${url.hash}`, source };
}
