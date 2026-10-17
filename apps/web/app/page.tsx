/**
 * 首页 `/`（旧站 `index.html` + `assets/js/home.js`）。
 *
 * 第三轮（N1）调整：首页保留现有主题框架，但**只做摘要**——
 *  - 生活近况：`LeblancView`（手记 / 放课后 / 音乐，各自读取、各自失败）；
 *  - 最新文章：`HomeLatestPosts`（`id="posts"`，旧 `/#posts` 的兼容落点，带 `/posts` 入口）；
 *  - 精选作品：`HomeFeaturedWorks`（只展示 API 真实返回的作品；读不到时如实说明）；
 *  - 归档入口：`HomeArchiveEntry`（`id="archive"`，旧 `/#archive` 的兼容落点）。
 *
 * 完整搜索、分类与归档集中在 `/posts`；`#latest` 锚点仍由 `CallingCard` 保留。
 *
 * 2026-10-17（用户验证反馈）：新增 `?home=a|b|c` 三套排版并存，默认 `a`（现状精修）；
 * `b` = 杂志版，`c` = 应用枢纽版。用户选定后再把所选设为默认并移除切换参数。
 *
 * 数据来源：文章走 `readPublishedPosts()`（默认迁移基线，显式打开 API 时读 FastAPI，
 * 读取失败会提示而不伪装成「没有文章」）；作品走 `fetchProjectsOnServer()`，
 * 同样如实处理失败。首页不再复制整份文章列表与归档。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { HomeHero } from "@/features/legacy/pages/home-hero";
import {
  HOME_FEATURED_COUNT,
  HomeArchiveEntry,
  HomeFeaturedWorks,
  HomeLatestPosts,
} from "@/features/legacy/pages/home-index";
import { CallingCard, HomeTicker } from "@/features/legacy/pages/home-static";
import { HomeAppHub } from "@/features/legacy/pages/home-app-hub";
import { pickHomeVariant } from "@/features/legacy/pages/home-variant";
import { LeblancView } from "@/features/leblanc/leblanc-view";
import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { readPublishedPosts } from "@/lib/api/posts";
import { fetchProjectsOnServer } from "@/features/showcase/server-api";
import type { ProjectSummary } from "@/features/showcase/types";

import "@/features/navigation/navigation.css";
import "./home-refresh.css";

export const metadata: Metadata = {
  title: "PHANTOM LOG · 怪盗手记",
};

/** 首页「精选作品」读取失败时给访客看的真实原因（不伪造作品、不吞错误）。 */
function featuredFailureReason(error: unknown): string {
  if (error instanceof ApiClientError) return `读取作品失败（HTTP ${error.status}）`;
  if (error instanceof ApiTransportError) return "连不上接口服务，暂时无法读取作品";
  if (error instanceof Error && error.message.includes("API_INTERNAL_URL")) {
    return "接口服务尚未配置，暂时无法读取作品";
  }
  if (error instanceof Error && error.message) return `读取作品失败：${error.message}`;
  return "读取作品失败";
}

interface HomePageProps {
  searchParams: Promise<{ home?: string | string[] }>;
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<ReactNode> {
  const params = await searchParams;
  const variant = pickHomeVariant(params.home);
  const read = await readPublishedPosts();

  let featured: ProjectSummary[] = [];
  let featuredError: string | null = null;
  try {
    const page = await fetchProjectsOnServer({ limit: HOME_FEATURED_COUNT });
    featured = page.items;
  } catch (error) {
    featuredError = featuredFailureReason(error);
  }

  const latestAndFeatured = (
    <div className="home-cols">
      <HomeLatestPosts items={read.items} />
      <HomeFeaturedWorks projects={featured} error={featuredError} />
    </div>
  );

  return (
    <div className={`home home--${variant}`} data-home-variant={variant}>
      {read.apiEnabled && read.degraded ? (
        <p className="data-notice" role="status">
          数据未更新：{read.detail}
        </p>
      ) : null}
      <HomeHero variant={variant} />
      <HomeTicker />
      {variant === "b" ? (
        <>
          {latestAndFeatured}
          <CallingCard post={read.items[0]} />
          <LeblancView />
        </>
      ) : variant === "c" ? (
        <>
          <HomeAppHub />
          {latestAndFeatured}
          <CallingCard post={read.items[0]} />
          <LeblancView />
        </>
      ) : (
        <>
          <CallingCard post={read.items[0]} />
          {/*
            勒布朗近况（T05 交付，T00 接线）。位置按 07 §3「先为现有首页增加勒布朗式的内容组织」：
            在 Hero/Ticker/CallingCard 之后、文章摘要之前。
            内部各块**各自读取、各自失败** —— 任一 API 故障不影响音乐与整页（验收第 5 条）。
          */}
          <LeblancView />
          <HomeLatestPosts items={read.items} />
          <HomeFeaturedWorks projects={featured} error={featuredError} />
        </>
      )}
      <HomeArchiveEntry items={read.items} />
    </div>
  );
}
