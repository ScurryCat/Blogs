/**
 * 根布局（**Server Component**，所有权 T02）。
 *
 * 结构（01 §4）：
 *
 * ```text
 * RootLayout（服务端）
 * ├─ 跳转链接 / 页头 HUD / main children（文章等服务端内容）/ 页脚
 * └─ SiteRuntime（客户端，跨普通站内路由保留）
 * ```
 *
 * 红线：
 *  - **不把整棵树改成 `use client`**：文章正文等仍在服务端渲染；
 *  - 样式沿用旧站 `assets/css/*.css` 的迁移副本（逐字节 + 仅静态路径改写，见
 *    `styles/legacy/PROVENANCE.md`），因此全站美术方向没有被「顺手升级」；
 *  - 旧站资源经 `tools/legacy-migration/migrate.mjs` 复制到 `public/assets/legacy/`，
 *    仓库根目录的旧站保持只读、仍是当前正式站点。
 */

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "../styles/legacy/base.css";
import "../styles/legacy/chrome.css";
import "../styles/legacy/poll.css";
import "../styles/legacy/phone.css";
import "../styles/legacy/home.css";
import "../styles/legacy/post.css";
import "../styles/legacy/map.css";
import "../styles/legacy/about.css";
import "../styles/legacy/weather.css";
import "../styles/legacy/guestbook.css";
import "./globals.css";

import { SiteFooter } from "@/components/ui/site-footer";
import { SiteHeader } from "@/components/ui/site-header";
import { site } from "@/features/legacy/config";
import { SiteRuntime } from "@/features/runtime/site-runtime";

export const metadata: Metadata = {
  title: {
    default: `${site.name} LOG · ${site.nameCn}`,
    template: `%s · ${site.name} LOG`,
  },
  description:
    "ScurryCat 的 Persona 5 主题个人博客。信息工程专业大三在读，有过 ACM 竞赛经历，记录技术学习、游戏与生活。",
  icons: { icon: "/assets/legacy/img/icon/joker.webp" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- 旧站就是这么引的：
            App Router 的根布局本来就作用于每个页面；字体候选与旧站一致，未新增外链。 */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anton&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;700;900&family=Noto+Serif+SC:wght@900&family=ZCOOL+QingKe+HuangYou&display=swap"
        />
      </head>
      <body>
        {/*
          SiteRuntime 是客户端组件，但它包住的是**服务端渲染的插槽**：
          页头 / 正文 / 页脚仍然是服务端组件，只是位置在 providers 之内。
          这样做是必须的 —— 页头、正文与地图里的链接都要用同一个导航协调器，
          在 providers 之外的链接只能整页跳转（过场与音乐连续都会失效）。
        */}
        <SiteRuntime>
          <a className="skip" href="#main">
            跳到正文
          </a>
          <SiteHeader />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </SiteRuntime>
      </body>
    </html>
  );
}
