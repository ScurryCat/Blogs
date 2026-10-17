/**
 * `/posts` —— 独立文章索引（任务书 §2.2）。
 *
 * 这是文章列表的**正式位置**（顶部「文章 / 情报档案」与地图神保町都指向这里）；
 * 首页只保留摘要，旧 `/#posts` 锚点落到首页摘要并有入口转到本页。
 *
 * 数据继续走项目现有链路 `readPublishedPosts()`（默认迁移基线，显式打开 API 时读 FastAPI），
 * 不为迁移索引退回只读旧静态文章；API 打开后读取失败会如实提示，不伪装成「没有文章」。
 *
 * `?view=archive` 打开归档视图：在服务端解析，刷新 / 分享都能回到同一视图。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PostsView } from "@/features/navigation/posts-view";
import { readPublishedPosts } from "@/lib/api/posts";

export const metadata: Metadata = {
  title: "情报档案",
  description: "完整文章索引：搜索标题 / 标签 / 正文，按塔罗分类筛选，归档视图按年份排列。",
};

interface PostsPageProps {
  searchParams: Promise<{ view?: string | string[] }>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function PostsPage({ searchParams }: PostsPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const view = firstValue(params.view) === "archive" ? "archive" : "list";
  const read = await readPublishedPosts();
  return (
    <section className="shell idx">
      <PostsView
        items={read.items}
        initialView={view}
        degraded={read.apiEnabled && read.degraded ? read.detail : null}
      />
    </section>
  );
}
