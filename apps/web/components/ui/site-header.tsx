/**
 * 页头 HUD —— 旧站 `core.js` 的 `chrome()` 页头部分迁移。
 *
 * 顶部导航一律用 `top-nav` 来源 → **Joker 帷幕**（用户明确要求：地图三类入口用人群，
 * 顶部导航用 Joker，不能按当前页面猜）。
 */

import type { ReactNode } from "react";

import { HeaderCalendar } from "./header-calendar";
import { SoundToggle } from "@/features/runtime/legacy-fx";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { site } from "@/features/legacy/config";

export interface NavItem {
  href: string;
  en: string;
  cn: string;
  key: string;
}

export const MAIN_NAV: readonly NavItem[] = [
  { href: "/#posts", en: "Posts", cn: "文章", key: "posts" },
  { href: "/map", en: "Map", cn: "地图", key: "map" },
  { href: "/weather", en: "Weather", cn: "天气", key: "weather" },
  { href: "/guestbook", en: "Guestbook", cn: "留言", key: "guestbook" },
  { href: "/about", en: "About", cn: "关于", key: "about" },
];

/** 当前页面 key → `aria-current`；由各页面把自己的 key 传进来。 */
export function SiteHeader({ page }: { page?: string }): ReactNode {
  return (
    <header className="hud" id="hud">
      <SiteLink
        className="brand"
        href="/"
        source="top-nav"
        aria-label={`${site.name} ${site.nameB} 首页`}
      >
        <span className="b-mark" aria-hidden="true">
          P
        </span>
        <span className="b-t" aria-hidden="true">
          {site.name}
          <em>{site.nameB}</em>
        </span>
      </SiteLink>
      <nav className="hud-nav" aria-label="主导航">
        {MAIN_NAV.map((item) => (
          <SiteLink
            href={item.href}
            source="top-nav"
            data-k={item.key}
            key={item.key}
            {...(page === item.key ? { "aria-current": "page" as const } : {})}
          >
            {item.en}
            <i>{item.cn}</i>
          </SiteLink>
        ))}
      </nav>
      <HeaderCalendar />
      <SoundToggle />
    </header>
  );
}
