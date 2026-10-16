/**
 * 我的殿堂（`/showcase`，T06；07 §5 / §7）。
 *
 * 这是**服务端组件**：第一页作品在服务端读（`API_INTERNAL_URL`），把可序列化的结果交给
 * 客户端视图 `ProjectGallery`。这样首屏就有内容，不需要客户端空转一圈再渲染。
 *
 * 页签：作品（本页） / 照片墙（`/showcase/photos`）。两者在「我的殿堂」里**并列**，
 * 用标签页分开，避免作品首页被大量生活照淹没（07 §5 末段）。
 *
 * 读取失败的处理（01 §6）：把失败原因**如实显示**，绝不降级成「没有作品」。
 * `API_INTERNAL_URL` 未配置时同样给出明确原因，而不是抛 500。
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";
import { fetchAlbumsOnServer } from "@/features/gallery/server-api";
import { ProjectGallery } from "@/features/showcase/project-gallery";
import { fetchProjectsOnServer } from "@/features/showcase/server-api";
import { isMaintenanceState, PROJECT_PAGE_SIZE, type ProjectSummary } from "@/features/showcase/types";

export const metadata: Metadata = {
  title: "我的殿堂",
  description: "作品与照片：真实项目的一句话用途、职责、关键取舍与可验证成果，以及记忆画廊。",
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

  // 相册页签的可用性：服务端确认一次（失败按「没有」处理，客户端不再重试，
  // 因为这里已经知道服务读不到了 —— 让页面少一个页签，而不是多一个坏按钮）。
  let galleryAvailable = false;
  try {
    const albums = await fetchAlbumsOnServer({ limit: 1 });
    galleryAvailable = albums.items.length > 0;
  } catch {
    galleryAvailable = false;
  }

  return (
    <section className="shell">
      <div className="pls-wrap">
        <header className="pls-bar">
          <div>
            <p className="pls-kicker">{"// MY PALACE"}</p>
            <h1 className="pls-title">我的殿堂</h1>
            <p className="pls-lead">
              作品与照片。作品页回答「我做出了什么」，
              <Link href="/apps/metanav">异世界殿堂</Link>
              解释「怎么做出来的」；照片墙按相册与拍摄时间浏览。
            </p>
          </div>
        </header>

        <nav className="pls-tabs" aria-label="我的殿堂分区">
          <Link className="pls-tab" href="/showcase" aria-current="page">
            作品
          </Link>
          <Link className="pls-tab" href="/showcase/photos">
            照片墙
          </Link>
          {galleryAvailable ? (
            <span className="pls-card-meta" data-gallery-available="true">
              已有公开相册
            </span>
          ) : null}
        </nav>
      </div>

      <ProjectGallery
        initialProjects={projects}
        initialCursor={cursor}
        loadError={projectsError}
        maintenance={maintenance}
      />

      {/*
        INS 的相册页签由 T00 在 T03 的 INS 页里接一次（本包不修改 InsShell / InsApp）：

            import { GalleryTabLoader } from "@/features/gallery/gallery-tab-loader";
            <GalleryTabLoader initialAlbums={albumPage?.items ?? null}>
              {(galleryTab) => <InsShell tabContributions={[galleryTab]} … />}
            </GalleryTabLoader>

        这里不渲染任何 INS 结构，只把接线方式留在交付单 §集成申请 里。
      */}
    </section>
  );
}
