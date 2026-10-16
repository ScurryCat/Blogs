"use client";

/**
 * 相册卡片（T06）。封面缺失时显示明确的空态说明，**不放假占位图**
 * （验收 5「正常空内容不靠假统计填充」）。
 */

import type { ReactNode } from "react";

import { albumMetaLine } from "./failure";
import { galleryAlbumHref } from "./paths";
import { photoAlt, thumbnailUrl, type AlbumSummary } from "./types";
import { SiteLink } from "@/features/runtime/navigation/site-link";

export interface AlbumCardProps {
  album: AlbumSummary;
}

export function AlbumCard({ album }: AlbumCardProps): ReactNode {
  const cover = album.cover ? thumbnailUrl(album.cover) : null;
  return (
    <SiteLink
      href={galleryAlbumHref(album.slug)}
      source="phone-link"
      className="plg-album-card"
      data-album={album.slug}
    >
      {cover ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求都校验公开引用）。 */
        <img
          className="plg-album-cover"
          src={cover}
          alt=""
          width={album.cover?.width ?? 640}
          height={album.cover?.height ?? 480}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="plg-album-cover-empty">这个相册还没有照片</span>
      )}
      <h3 className="plg-album-card-title">{album.title}</h3>
      <p className="plg-album-card-meta">{albumMetaLine(album)}</p>
      {album.description ? <p className="plg-album-card-desc">{album.description}</p> : null}
      {album.cover ? (
        <span className="plg-album-card-meta">封面：{photoAlt(album.cover)}</span>
      ) : null}
    </SiteLink>
  );
}
