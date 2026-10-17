/**
 * 生活图库 `/gallery`（第三轮任务书 §4.1；P5 内容架构 v3）。
 *
 * 这是生活图库的**唯一独立入口**，默认「照片墙」，`?view=albums` 打开「相册」视图：
 *
 * | 地址 | 视图 |
 * | --- | --- |
 * | `/gallery` | 照片墙（按拍摄时间，跨相册；类型 / 年份 / 相册筛选） |
 * | `/gallery?scope=album&album=<slug>` | 单个相册（站主排的相册顺序 + 相册说明） |
 * | `/gallery?view=albums` | 相册列表（封面 / 张数 / 说明） |
 *
 * 数据与组件复用（验收 §4.1 / §8.2）：
 *  - 照片墙与相册视图都读同一批公开端点（`/api/v1/gallery/albums`、`/gallery/photos`、
 *    `/gallery/photos/years`），**没有**第二套上传 / 发布 / 数据副本；
 *  - 展示复用 `GalleryView`（照片墙）、`AlbumGallery`（相册卡）与 INS 相册页签
 *    （`ins-gallery-view.tsx`）的同一套组件与取数函数；
 *  - 「我的殿堂」第三轮起只保留作品，照片不再从 `/showcase/photos` 进入；
 *    旧地址由 `app/showcase/photos/page.tsx` 重定向到这里（保留合法筛选参数）。
 *
 * 失败处理：作品页 / INS 页的约定同样适用 —— 把失败原因**如实显示**，绝不降级成
 * 「没有照片」；空态只说没有，不编造张数。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import "@/features/gallery/gallery.css";
import { AlbumGallery } from "@/features/gallery/album-gallery";
import { GalleryTabs } from "@/features/gallery/gallery-tabs";
import { GalleryView } from "@/features/gallery/gallery-view";
import { normalizeGalleryView } from "@/features/gallery/paths";
import {
  fetchAlbumsOnServer,
  fetchWallOnServer,
  fetchWallYearsOnServer,
} from "@/features/gallery/server-api";
import {
  ALBUM_PAGE_SIZE,
  isAlbumKind,
  WALL_PAGE_SIZE,
  type AlbumSummary,
  type WallPhoto,
  type WallScope,
} from "@/features/gallery/types";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "生活图库",
  description: "生活照片与游戏截图：默认照片墙，按相册 / 类型 / 拍摄年份浏览；相册负责组织图片。",
};

export const dynamic = "force-dynamic";

function failureReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `读取图库失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上接口服务，暂时无法读取图库。";
  }
  if (error instanceof Error && error.message) {
    return `读取图库失败：${error.message}`;
  }
  return "读取图库失败。";
}

function firstValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() ? raw.trim() : null;
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GalleryPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const view = normalizeGalleryView(firstValue(params.view));
  const album = firstValue(params.album);
  const kindRaw = firstValue(params.kind);
  const kind = isAlbumKind(kindRaw) ? kindRaw : null;
  const year = positiveInt(firstValue(params.year));
  const scopeRaw = firstValue(params.scope);
  // 只有显式 `scope=album` **且**给了 album 才按相册的手工顺序读；
  // 单独给 album 是「按相册筛选」，排序仍是全局的（按拍摄时间）。
  const scope: WallScope = scopeRaw === "album" && album ? "album" : "global";

  if (view === "albums") {
    let albums: AlbumSummary[] = [];
    let cursor: string | null = null;
    let loadError: string | null = null;
    try {
      const page = await fetchAlbumsOnServer({ limit: ALBUM_PAGE_SIZE });
      albums = page.items;
      cursor = page.next_cursor;
    } catch (error) {
      loadError = failureReason(error);
    }
    return (
      <AppPageShell>
        <div className="plg-wrap">
          <GalleryHeader />
          <GalleryTabs view="albums" />
          <AlbumGallery initialAlbums={albums} initialCursor={cursor} loadError={loadError} />
        </div>
      </AppPageShell>
    );
  }

  let items: WallPhoto[] = [];
  let cursor: string | null = null;
  let total = 0;
  let loadError: string | null = null;
  try {
    const page = await fetchWallOnServer({
      scope,
      album,
      kind,
      year,
      limit: WALL_PAGE_SIZE,
    });
    items = page.items;
    cursor = page.next_cursor;
    total = page.total;
  } catch (error) {
    loadError = failureReason(error);
  }

  let albums: AlbumSummary[] = [];
  try {
    albums = (await fetchAlbumsOnServer({ limit: 30 })).items;
  } catch {
    // 相册筛选条是**可选**的辅助入口：相册读不到时仍让照片本身可读，
    // 只是少一排筛选按钮（照片网格的失败态由 loadError 单独表达）。
    albums = [];
  }
  const years = await fetchWallYearsOnServer();

  return (
    <AppPageShell>
      <div className="plg-wrap">
        <GalleryHeader />
        <GalleryTabs view="wall" />
      </div>

      <GalleryView
        album={album}
        kind={kind}
        year={year}
        scope={scope}
        initialPhotos={items}
        initialCursor={cursor}
        initialTotal={total}
        albums={albums}
        years={years}
        loadError={loadError}
        hasOverlayHost
      />
    </AppPageShell>
  );
}

function GalleryHeader(): ReactNode {
  return (
    <header className="plg-bar">
      <div>
        <p className="plg-kicker">{"// LEBLANC · LIFE GALLERY"}</p>
        <h1 className="plg-title">生活图库</h1>
        <p className="plg-lead">
          生活照片与游戏截图都在这里：照片墙按拍摄时间浏览，相册按站主整理的顺序阅读；
          「我的殿堂」只保留作品。
        </p>
      </div>
    </header>
  );
}
