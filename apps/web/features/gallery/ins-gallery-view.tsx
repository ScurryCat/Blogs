"use client";

/**
 * INS 相册页签的**紧凑 GalleryView**（T06 交付给 T03/T00 的组合接口；03 §6、07 §5）。
 *
 * 设计约束：
 *
 *  1. **同一份数据**：这里通过 `/api/v1/gallery/albums` + `/api/v1/gallery/photos`
 *     读，与独立照片墙 `/showcase/photos` 完全同源（验收 4：两处相册 / 图片一致）。
 *     本组件不缓存第二份图库，也不复制媒体文件。
 *  2. **紧凑**：INS 的信息流里只铺前 `INS_PREVIEW_LIMIT` 张 + 相册名列表，
 *     完整的筛选、分组与分页留在独立照片墙（那里有 URL、可分享、可刷新）。
 *  3. **不新增 body 锁、不新增音频、不播过场**：只渲染图片与 `SiteLink`。
 *     跳转到独立照片墙用 `phone-link` 语义（普通站点跳转）。
 *  4. `isAvailable()`（在 `ins-tab.tsx` 里）在**没有任何公开相册**时返回 false →
 *     INS 不显示这个页签，而不是显示一个空页签（验收「未接入不显示坏按钮」）。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchAlbums, fetchWallPhotos } from "./api";
import { classifyFailure } from "./failure";
import { galleryAlbumHref, galleryHref, GALLERY_ROUTES } from "./paths";
import { photoAlt, thumbnailUrl, type AlbumSummary, type WallPhoto } from "./types";

export interface InsGalleryViewProps {
  /** INS 当前的标签筛选（T03 的页签上下文给过来的）；相册不受标签影响，但会原样透传说明。 */
  tag?: string | null;
  /** 首屏数据：手机宿主与 INS 独立页都可以先读好再传（减少一次客户端空转）。 */
  initialAlbums?: readonly AlbumSummary[];
  initialPhotos?: readonly WallPhoto[];
  /** 预览张数上限（默认取路由映射里的值）。 */
  limit?: number;
}

export function InsGalleryView({
  tag = null,
  initialAlbums = [],
  initialPhotos = [],
  limit = GALLERY_ROUTES.insPreviewLimit,
}: InsGalleryViewProps): ReactNode {
  const [albums, setAlbums] = useState<readonly AlbumSummary[]>(initialAlbums);
  const [photos, setPhotos] = useState<readonly WallPhoto[]>(initialPhotos);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "failed">(
    initialAlbums.length > 0 || initialPhotos.length > 0 ? "ready" : "loading",
  );
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (phase === "ready") return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const [albumPage, photoPage] = await Promise.all([
          fetchAlbums({ limit: 8 }, controller.signal),
          fetchWallPhotos({ limit }, controller.signal),
        ]);
        setAlbums(albumPage.items);
        setPhotos(photoPage.items);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("failed");
        setMessage(classifyFailure(error).message);
      }
    })();
    // 卸载时取消未完成的读取（验收 §1）。
    return () => controller.abort();
    // 只在首次挂载时自己取一次；首屏数据由调用方给。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "loading") {
    return (
      <p className="plg-group-meta" role="status">
        正在读取相册…
      </p>
    );
  }

  if (phase === "failed") {
    return (
      <div className="plg-state" role="status" data-ins-gallery-error="">
        <p className="plg-state-body">{message}</p>
      </div>
    );
  }

  if (albums.length === 0 && photos.length === 0) {
    return (
      <div className="plg-state" role="status" data-ins-gallery-empty="">
        <p className="plg-state-title">还没有公开的相册</p>
        <p className="plg-state-body">
          相册由站主在后台维护；这里不显示占位图，也不编造照片数。
        </p>
      </div>
    );
  }

  return (
    <div className="plg-ins" data-ins-gallery="">
      <div className="plg-ins-head">
        <h2 className="plg-ins-title">相册</h2>
        <SiteLink href={galleryHref()} source="phone-link" className="plg-chip-link" data-ins-gallery-all="">
          打开完整照片墙
        </SiteLink>
      </div>

      {albums.length > 0 ? (
        <div className="plg-filters" aria-label="相册列表">
          {albums.map((album) => (
            <SiteLink
              key={album.id}
              href={galleryAlbumHref(album.slug)}
              source="phone-link"
              className="plg-chip-link"
              data-ins-album={album.slug}
            >
              {album.title}
              <span className="plg-group-meta">（{album.photo_count}）</span>
            </SiteLink>
          ))}
        </div>
      ) : null}

      {photos.length > 0 ? (
        <div className="plg-ins-grid">
          {photos.map((item) => {
            const cover = thumbnailUrl(item.photo);
            return (
              <SiteLink
                key={`${item.photo.media_id}-${item.photo.position}`}
                href={galleryAlbumHref(item.album.slug)}
                source="phone-link"
                className="plg-ins-cell"
                data-ins-photo={item.photo.media_id}
                aria-label={`${photoAlt(item.photo)}（相册：${item.album.title}）`}
              >
                {cover ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求都校验公开引用）。 */
                  <img
                    className="plg-ins-image"
                    src={cover}
                    alt={photoAlt(item.photo)}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="plg-group-meta">图片不可读</span>
                )}
              </SiteLink>
            );
          })}
        </div>
      ) : null}

      <p className="plg-ins-note">
        这里只铺前 {limit} 张；筛选、分组与灯箱在
        <SiteLink href={galleryHref()} source="phone-link">
          完整照片墙
        </SiteLink>
        。
        {tag ? `（动态的标签筛选「${tag}」不影响相册）` : ""}
      </p>
    </div>
  );
}
