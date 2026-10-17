/**
 * 页头 HUD —— 顶部固定五栏目（任务书 §2.1）。
 *
 * 与第二轮旧结构的差别：
 *  - 栏目改由 `features/navigation/site-nav.ts` 的**唯一配置**驱动，
 *    桌面与移动端渲染同一份 DOM（响应式只影响样式，不换数组）；
 *  - 子页面高亮按**内容归属**计算（`activeSection(pathname)`），不再靠页面手动传 key，
 *    也不只比较 URL 完全相等——高亮在客户端子组件 `SiteNavLinks` 里完成；
 *  - 天气不再是一级栏目；留言从生活页与地图进入；COOP 归「关于」（配置里明确）；
 *  - Logo 返回首页；「作品」链接显式带 `intent="enter-showcase"`（主动跨入殿堂边界）。
 *
 * 本文件保持**服务端组件**：页脚等其它服务端区块仍从这里转出 `MAIN_NAV`，
 * 不能把一个「use client」模块的普通数组导出当值用。
 */

import type { ReactNode } from "react";

import { SiteNavLinks } from "@/features/navigation/site-nav-links";
import { HeaderCalendar } from "./header-calendar";
import { SoundToggle } from "@/features/runtime/legacy-fx";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { site } from "@/features/legacy/config";

export { MAIN_NAV } from "@/features/navigation/site-nav";
export type { MainNavItem, NavSectionKey } from "@/features/navigation/site-nav";

export function SiteHeader(): ReactNode {
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
      <SiteNavLinks />
      <HeaderCalendar />
      <SoundToggle />
    </header>
  );
}
