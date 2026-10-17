"use client";

/**
 * 顶部五栏目的链接栏（客户端边界，只为读取当前路径做**内容归属高亮**）。
 *
 * 为什么单独一个文件：`SiteHeader` 仍留在服务端（页脚等其它服务端区块还从它
 * 转出 `MAIN_NAV`），而 `usePathname()` 只能在客户端组件里用。
 * 这里不复制任何栏目数组——数据全部来自 `features/navigation/site-nav.ts`。
 *
 * 顶部导航来源一律 `source="top-nav"` → Joker 帷幕（用户明确要求：地图三类入口用人群，
 * 顶部导航用 Joker，不能按当前页面猜）。
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { MAIN_NAV, activeSection } from "./site-nav";
import "./navigation.css";

export function SiteNavLinks(): ReactNode {
  const pathname = usePathname();
  const current = activeSection(pathname);

  return (
    <nav className="hud-nav" aria-label="主导航">
      {MAIN_NAV.map((item) => {
        const active = current === item.key;
        return (
          <SiteLink
            href={item.href}
            source="top-nav"
            intent={item.intent}
            data-k={item.key}
            {...(active ? { "aria-current": "page" as const } : {})}
            key={item.key}
          >
            <span className="nav-name">{item.label}</span>
            <i className="nav-sub">{item.sub}</i>
          </SiteLink>
        );
      })}
    </nav>
  );
}
