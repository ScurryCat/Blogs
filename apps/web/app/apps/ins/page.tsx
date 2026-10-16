/**
 * INS 图文动态独立页 `/apps/ins`（T03）。
 *
 * 这是**服务端组件**：第一页在服务端读（`API_INTERNAL_URL`），把可序列化的结果交给
 * 客户端壳 `InsApp`。这样：
 *  - 首屏就有内容，不需要客户端空转一圈再渲染；
 *  - 手机内置视图（`features/ins/phone-view.tsx`）复用同一套组件与同一条公开接口，
 *    因此手机与独立页展示同一份数据（03 §1、验收用例 1）。
 *
 * 读取失败的处理（01 §6）：把失败原因**如实显示**，绝不降级成「没有动态」。
 * `API_INTERNAL_URL` 未配置时同样给出明确原因，而不是抛 500 ——
 * 本项目允许在没有 API 的环境里预览其余页面（T02 的约定）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { CoopEntry } from "@/features/coop/coop-entry";
import { InsAppWithGalleryAndMessages } from "@/features/gallery/ins-integration";
import { fetchMomentsOnServer, fetchTagsOnServer } from "@/features/ins/server-api";
import { INS_SUBTITLE, INS_TITLE } from "@/features/ins/composition";
import { FEED_PAGE_SIZE, type Moment } from "@/features/ins/types";
import "@/features/ins/ins.css";

export const metadata: Metadata = {
  title: "INS 图文动态",
  description: `${INS_TITLE}：${INS_SUBTITLE}`,
};

// 公开动态数据首版不共享缓存（01 §6），也不预生成固定页面。
export const dynamic = "force-dynamic";

function failureReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `读取动态失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上接口服务，暂时无法读取图文动态。";
  }
  if (error instanceof Error && error.message) {
    return `读取动态失败：${error.message}`;
  }
  return "读取动态失败。";
}

interface PageProps {
  searchParams: Promise<{ tag?: string | string[] }>;
}

export default async function InsFeedPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const rawTag = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const tag = (rawTag ?? "").trim() || null;

  let initialFeed: Moment[] | null = null;
  let initialCursor: string | null = null;
  let feedError: string | null = null;

  try {
    const page = await fetchMomentsOnServer({ tag, limit: FEED_PAGE_SIZE });
    initialFeed = page.items;
    initialCursor = page.next_cursor;
  } catch (error) {
    feedError = failureReason(error);
  }

  // 标签筛选候选：只列**当前已加载动态里真的出现过**的标签。
  // `/tags` 也包含文章标签，这里不把它们伪装成动态筛选结果。
  const availableTags = await readAvailableTags(tag, initialFeed);

  return (
    <Suspense fallback={<p className="ins-loading">正在读取图文动态…</p>}>
      <InsAppWithGalleryAndMessages
        tag={tag}
        availableTags={availableTags}
        initialFeed={initialFeed}
        initialCursor={initialCursor}
        feedError={feedError}
        // T07 的头像区 COOP 入口（与 /about 第 02 区、COOP 独立页读同一份数据）。
        profile={{ coop: <CoopEntry /> }}
      />
    </Suspense>
  );
}

async function readAvailableTags(
  tag: string | null,
  feed: readonly Moment[] | null,
): Promise<string[]> {
  const names = new Set<string>();
  for (const moment of feed ?? []) {
    for (const item of moment.tags) names.add(item.name);
  }
  if (tag) names.add(tag);
  if (names.size > 0) return [...names].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  // 首屏为空（或读取失败）时，退回公开标签列表里**看起来像动态标签**的部分：
  // 仅在没有任何动态可依据时使用，避免筛选入口完全消失。
  try {
    const tags = await fetchTagsOnServer();
    return tags.map((item) => item.name).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  } catch {
    return [];
  }
}
