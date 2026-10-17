/**
 * 我的殿堂（`/showcase`，T06；第三轮任务书 §4.1 起**只保留作品**）。
 *
 * 这是**服务端组件**：第一页作品在服务端读（`API_INTERNAL_URL`），把可序列化的结果交给
 * 客户端视图 `ProjectGallery`。这样首屏就有内容，不需要客户端空转一圈再渲染。
 *
 * 第三轮职责拆分（任务书 §4.1 / §7.1 N4）：
 *  - 「我的殿堂」只保留作品与作品详情；生活照片全部迁入 `/gallery` 生活图库；
 *  - 作品配图仍归作品本身（作品详情页的「图集」），**不**自动转入生活图库；
 *  - 旧照片墙 `/showcase/photos` 由重定向页转到 `/gallery`（见 app/showcase/photos）。
 *
 * 读取失败的处理（01 §6）：把失败原因**如实显示**，绝不降级成「没有作品」。
 * `API_INTERNAL_URL` 未配置时同样给出明确原因，而不是抛 500。
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import "@/features/showcase/showcase.css";
import { ProjectGallery } from "@/features/showcase/project-gallery";
import { fetchProjectsOnServer } from "@/features/showcase/server-api";
import { isMaintenanceState, PROJECT_PAGE_SIZE, type ProjectSummary } from "@/features/showcase/types";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "我的殿堂",
  description: "作品：真实项目的一句话用途、职责、关键取舍与可验证成果。",
};

// 公开数据首版不共享缓存（01 §6），也不预生成固定页面。
export const dynamic = "force-dynamic";

function failureReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `读取作品失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上接口服务，暂时无法读取作品列表。";
  }
  if (error instanceof Error && error.message) {
    return `读取作品失败：${error.message}`;
  }
  return "读取作品失败。";
}

interface PageProps {
  searchParams: Promise<{ maintenance?: string | string[] }>;
}

export default async function ShowcasePage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const raw = Array.isArray(params.maintenance) ? params.maintenance[0] : params.maintenance;
  const maintenance = isMaintenanceState(raw) ? raw : null;

  let projects: ProjectSummary[] = [];
  let cursor: string | null = null;
  let projectsError: string | null = null;
  try {
    const page = await fetchProjectsOnServer({ maintenance, limit: PROJECT_PAGE_SIZE });
    projects = page.items;
    cursor = page.next_cursor;
  } catch (error) {
    projectsError = failureReason(error);
  }

  return (
    <AppPageShell>
      <div className="pls-wrap">
        <header className="pls-bar">
          <div>
            <p className="pls-kicker">{"// MY PALACE"}</p>
            <h1 className="pls-title">我的殿堂</h1>
            <p className="pls-lead">
              作品。这里回答「我做出了什么」；<Link href="/apps/metanav">异世界殿堂</Link>
              解释「怎么做出来的」。生活照片不在殿堂里，已迁入生活图库。
            </p>
          </div>
        </header>
      </div>

      <ProjectGallery
        initialProjects={projects}
        initialCursor={cursor}
        loadError={projectsError}
        maintenance={maintenance}
      />
    </AppPageShell>
  );
}
