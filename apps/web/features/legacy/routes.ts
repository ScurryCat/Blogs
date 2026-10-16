/**
 * 旧 URL → 新路由的映射表与重定向目标计算。
 *
 * 旧站 7 条路由（见 T00-baseline §5）里，6 条有对应的 Next 路由；`poll-demo.html`
 * 是组件演示页，只在开发 / 测试环境保留，不进公开导航（01 §5）。
 *
 * ⚠️ **真正的重定向由 next.config.ts 的 `redirects()` 执行，而该文件归 T00。**
 * 本模块只提供可测试的映射事实（供 T00 接线、供回归测试断言），
 * 不假装重定向已经生效：`/post.html?p=…` 在集成前会 404。
 *
 * 保留规则（01 §5）：
 *  - 有效内容永久重定向；**无效 slug 返回真正的 404**，不统一跳回首页掩盖错误；
 *  - `index.html#posts` / `#archive` 的锚点保留，不额外播放动画
 *    （新站里由 `LegacyHashLanding` 在同页恢复滚动，不制造历史记录）。
 */

export interface LegacyRoute {
  /** 旧站入口。 */
  legacy: string;
  /** 目标路由（含查询或 hash 时写成模板）。 */
  target: string;
  /** 说明。 */
  note: string;
}

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { legacy: "index.html", target: "/", note: "首页；保留 hash" },
  { legacy: "index.html#posts", target: "/#posts", note: "宫殿索引锚点" },
  { legacy: "index.html#archive", target: "/#archive", note: "归档锚点" },
  { legacy: "post.html?p=<slug>", target: "/posts/<slug>", note: "查询参数转路径；缺失 slug 真 404" },
  { legacy: "map.html", target: "/map", note: "保留地点 ID 与目的地映射" },
  { legacy: "about.html", target: "/about", note: "保留简介与友链" },
  { legacy: "weather.html", target: "/weather", note: "保留默认城市与定位选择" },
  { legacy: "guestbook.html", target: "/guestbook", note: "本机留言仍是本地示例" },
  { legacy: "poll-demo.html", target: "(无公开路由)", note: "组件演示页，仅开发/测试" },
];

/**
 * 把站点配置里的旧站站内链接（如 `index.html#posts`）转成新站路径。
 * 外部链接与已是新站绝对路径的链接原样返回。
 */
export function legacyHrefToNext(href: string): string {
  if (!href) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("/")) return href;
  if (href.startsWith("#")) return href;

  const [path = "", hash = ""] = href.split("#");
  const suffix = hash ? `#${hash}` : "";
  const [file = "", query = ""] = path.split("?");

  if (file === "index.html" || file === "") return `/${suffix}`;
  if (file === "map.html") return `/map${suffix}`;
  if (file === "about.html") return `/about${suffix}`;
  if (file === "weather.html") return `/weather${suffix}`;
  if (file === "guestbook.html") return `/guestbook${suffix}`;
  if (file === "post.html") {
    const slug = new URLSearchParams(query).get("p");
    return slug ? `/posts/${encodeURIComponent(slug)}${suffix}` : `/posts${suffix}`;
  }
  return href;
}

/** 旧站首页 hash 锚点（新站用于同页滚动恢复）。 */
export const HOME_ANCHORS = ["posts", "archive", "latest"] as const;
export type HomeAnchor = (typeof HOME_ANCHORS)[number];

export function isHomeAnchor(value: string): value is HomeAnchor {
  return (HOME_ANCHORS as readonly string[]).includes(value);
}
