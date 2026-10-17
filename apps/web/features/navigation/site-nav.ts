/**
 * 顶部固定五栏目 —— **站点唯一**的主导航配置（任务书 §2.1）。
 *
 * 为什么集中在 `features/navigation/`：
 *  - 页头（桌面与移动端同一份 DOM）与页脚都从这里读，不再各写一份数组；
 *  - 子页面高亮按**内容归属**计算（例如文章详情归「文章」、手记归「生活」），
 *    不是拿 URL 做完全相等比较；
 *  - COOP 的归属只在这里定义一次（`COOP_SECTION_KEY`），页面不自行猜测。
 *
 * 与导航意图的关系（任务书 §2.1 / §6.2）：`intent` 只是「主动跨入作品殿堂」的
 * 增强信号，不改变 href、历史与高亮；真实过场仍由 `features/runtime/navigation/`
 * 的共享协调器决定。N0 已冻结那边的契约，本文件只做调用方声明。
 */

import type { NavigationIntent } from "@/features/phone/types";

/** 顶部五个主栏目的稳定标识（也用作页脚的 `data-k`）。 */
export type NavSectionKey = "posts" | "life" | "showcase" | "map" | "about";

export interface MainNavItem {
  key: NavSectionKey;
  /** 主栏目名（页头主标签）。 */
  label: string;
  /** P5 风格副标题（页头次级标签）。 */
  sub: string;
  /** 英文短名（页脚 / 测试 / 辅助文案用，不是第二套栏目）。 */
  en: string;
  /** 目的地。 */
  href: string;
  /** 可选导航意图：目前只有「主动进入我的殿堂」。 */
  intent?: NavigationIntent;
}

/**
 * 顶部五栏目（任务书 §2.1 已确认的产品选择，不再重新提问）。
 *
 * 天气**不在**这里：它保留手机与地图入口（`WEATHER_PATH`），不占一级导航。
 */
export const MAIN_NAV: readonly MainNavItem[] = [
  { key: "posts", label: "文章", sub: "情报档案", en: "Posts", href: "/posts" },
  { key: "life", label: "生活", sub: "勒布朗", en: "Life", href: "/apps/leblanc" },
  {
    key: "showcase",
    label: "作品",
    sub: "我的殿堂",
    en: "Showcase",
    href: "/showcase",
    intent: "enter-showcase",
  },
  { key: "map", label: "地图", sub: "东京漫游", en: "Map", href: "/map" },
  { key: "about", label: "关于", sub: "人物档案", en: "About", href: "/about" },
];

/** 天气页仍存在，只是不再是一级栏目（手机 / 地图入口保留）。 */
export const WEATHER_PATH = "/weather";

/** COOP（友链）不新增第六个栏目：归入「关于」（任务书 §2.1 末段）。 */
export const COOP_PATH = "/apps/coop";
export const COOP_SECTION_KEY: NavSectionKey = "about";

/** 生活页里的留言入口（归属「生活」，任务书 §2.1）。 */
export const GUESTBOOK_PATH = "/guestbook";

/** 生活图库（由 N4 交付；此处只做导航归属，不复制图库实现）。 */
export const GALLERY_PATH = "/gallery";

interface SectionOwnership {
  key: NavSectionKey;
  /** 该栏目拥有的内容路径前缀；第一个命中的归属生效。 */
  prefixes: readonly string[];
}

/**
 * 内容归属表：子页面高亮**按内容归属**，不是 URL 完全相等。
 *
 * 顺序有意义：`/showcase/photos`（旧照片地址，第三轮起重定向进生活图库）
 * 必须先归「生活」，否则会被 `/showcase` 前缀抢走。它与
 * `features/runtime/navigation/showcase-boundary.ts` 的判定一致：旧照片地址不属于
 * 作品殿堂边界。
 */
const SECTION_OWNERSHIP: readonly SectionOwnership[] = [
  { key: "posts", prefixes: ["/posts"] },
  {
    key: "life",
    prefixes: [
      "/apps/leblanc",
      "/apps/journal",
      "/apps/ins",
      "/apps/leisure",
      GALLERY_PATH,
      GUESTBOOK_PATH,
      "/showcase/photos",
    ],
  },
  { key: "showcase", prefixes: ["/showcase"] },
  { key: "map", prefixes: ["/map"] },
  // COOP 由「关于」承担；关于页提供清楚入口（已在 /about 的友链段落地）。
  { key: "about", prefixes: ["/about", COOP_PATH] },
];

/** 去掉查询 / 哈希与结尾斜杠；根路径保留 `/`。 */
export function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  const path = pathname.split(/[?#]/)[0] ?? "/";
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "");
  return path || "/";
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 当前路径属于哪个主栏目；不属于五个栏目时返回 `null`（不强行高亮）。
 *
 * - 文章详情 `/posts/<slug>` → 文章；
 * - 手记 / INS / 放课后 / 图库 / 留言 → 生活；
 * - 作品详情 `/showcase/projects/<slug>` → 作品；旧 `/showcase/photos` → 生活；
 * - `/apps/coop` → 关于（COOP 归属在统一配置里明确）；
 * - `/weather`、`/`、`/apps/metanav` 等不占一级栏目，返回 `null`。
 */
export function activeSection(pathname: string | null | undefined): NavSectionKey | null {
  const path = normalizePathname(pathname);
  for (const rule of SECTION_OWNERSHIP) {
    if (rule.prefixes.some((prefix) => matchesPrefix(path, prefix))) return rule.key;
  }
  return null;
}

/** 按 key 取栏目配置（页脚 / 测试用，避免再写一份数组）。 */
export function navItem(key: NavSectionKey): MainNavItem {
  const found = MAIN_NAV.find((item) => item.key === key);
  if (!found) throw new Error(`未知的顶部栏目：${key}`);
  return found;
}
