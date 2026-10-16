/**
 * 照片墙（`/showcase/photos`，T06；07 §5 / §7）。
 *
 * 服务端读第一页照片、相册清单与可用年份，交给客户端 `GalleryView`。筛选状态放在 URL
 * 查询参数里（`album` / `kind` / `year`），因此可以分享、刷新、Back（验收 6）。
 *
 * 与 INS 的相册页签读的是**同一份数据**（`/api/v1/gallery/albums` 与
 * `/api/v1/gallery/photos`），不复制图库（验收 4）。
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";
import { GalleryView } from "@/features/gallery/gallery-view";
import {
  fetchAlbumsOnServer,
  fetchWallOnServer,
  fetchWallYearsOnServer,
} from "@/features/gallery/server-api";
import {
  isAlbumKind,
  WALL_PAGE_SIZE,
  type AlbumSummary,
  type WallPhoto,
  type WallScope,
} from "@/features/gallery/types";

export const metadata: Metadata = {
  title: "照片墙",
  description: "记忆画廊：按相册、类型与拍摄年份浏览真实照片；游戏截图单独成册。",
};

export const dynamic = "force-dynamic";

function failureReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `读取照片失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上接口服务，暂时无法读取照片墙。";
  }
  if (error instanceof Error && error.message) {
    return `读取照片失败：${error.message}`;
  }
  return "读取照片失败。";
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

export default async function PhotosPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const album = firstValue(params.album);
  const kindRaw = firstValue(params.kind);
  const kind = isAlbumKind(kindRaw) ? kindRaw : null;
  const year = positiveInt(firstValue(params.year));
  const scopeRaw = firstValue(params.scope);
  // 只有显式 `scope=album` **且**给了 album 才按相册的手工顺序读；
  // 单独给 album 是「按相册筛选」，排序仍是全局的（按拍摄时间）。
  const scope: WallScope = scopeRaw === "album" && album ? "album" : "global";

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
    <section className="shell">
      <div className="plg-wrap">
        <header className="plg-bar">
          <div>
            <p className="plg-kicker">{"// MY PALACE · GALLERY"}</p>
            <h1 className="plg-title">照片墙</h1>
            <p className="plg-lead">
              真实照片与游戏截图分册。照片保持自然比例、不加强制滤镜；拍摄时间可以留空 ——
              空着就显示「未填写日期」，不会拿上传时间冒充。
            </p>
          </div>
        </header>
        <nav className="plg-tabs" aria-label="我的殿堂分区">
          <Link className="plg-chip-link" href="/showcase">
            作品
          </Link>
          <Link className="plg-chip-link" href="/showcase/photos" aria-current="page">
            照片墙
          </Link>
        </nav>
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
    </section>
  );
}
