/**
 * 首页 `/`（旧站 `index.html` + `assets/js/home.js`）。
 *
 * 内容在服务端渲染（文章列表、归档、预告信），交互部分（暂停菜单、搜索筛选）是客户端组件。
 * `#latest` / `#posts` / `#archive` 三个锚点保留，旧链接 `index.html#posts` 因此仍有落点。
 *
 * 数据来源：`readPublishedPosts()` —— 默认是迁移基线（8 篇文章，slug 与正文原样）；
 * 配置 `API_INTERNAL_URL` 并设置 `PHANTOM_POSTS_SOURCE=api` 后改为读 FastAPI。
 * **API 打开后读取失败不会伪装成「没有文章」**：页面顶部明确提示数据未更新。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { HomeHero } from "@/features/legacy/pages/home-hero";
import { HomePalaceIndex } from "@/features/legacy/pages/home-index";
import { ArchiveSection, CallingCard, HomeTicker } from "@/features/legacy/pages/home-static";
import { LeblancView } from "@/features/leblanc/leblanc-view";
import { readPublishedPosts } from "@/lib/api/posts";

export const metadata: Metadata = {
  title: "PHANTOM LOG · 怪盗手记",
};

export default async function HomePage(): Promise<ReactNode> {
  const read = await readPublishedPosts();
  return (
    <>
      {read.apiEnabled && read.degraded ? (
        <p className="data-notice" role="status">
          数据未更新：{read.detail}
        </p>
      ) : null}
      <HomeHero />
      <HomeTicker />
      <CallingCard post={read.items[0]} />
      {/*
        勒布朗近况（T05 交付，T00 接线）。位置按 07 §3「先为现有首页增加勒布朗式的内容组织」
        与 T05 交付单 §8.8 的建议：在 Hero/Ticker/CallingCard 之后、文章索引之前。
        内部四块**各自读取、各自失败** —— 任一 API 故障不影响音乐与整页（验收第 5 条）。
        独立入口 `/apps/leblanc` 保留：站主可直接分享「近况」页。
      */}
      <LeblancView />
      <HomePalaceIndex items={read.items} />
      <ArchiveSection items={read.items} />
    </>
  );
}
