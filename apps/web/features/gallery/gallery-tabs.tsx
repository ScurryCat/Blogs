"use client";

/**
 * 生活图库的「照片墙 / 相册」切换（第三轮任务书 §4.1）。
 *
 * `/gallery` 默认是照片墙；`?view=albums` 打开相册视图。切换是**普通站内链接**：
 *
 *  - 保留正确的 `href`（可分享、可刷新、Back 可用、中键/新标签页按浏览器原生行为）；
 *  - 用 `SiteLink` 而不是客户端 state：视图属于 URL，不属于组件内部状态；
 *  - 不传 `intent`：图库不是作品殿堂边界，不能触发异世界过场（任务书 §6.1）。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { GALLERY_PATH, galleryAlbumsHref, type GalleryViewMode } from "./paths";

export const GALLERY_TABS_LABEL = "生活图库视图切换";

export function GalleryTabs({ view }: { view: GalleryViewMode }): ReactNode {
  return (
    <nav className="plg-tabs" aria-label={GALLERY_TABS_LABEL}>
      <SiteLink
        href={GALLERY_PATH}
        source="phone-link"
        className="plg-tab"
        aria-current={view === "wall" ? "page" : undefined}
        data-gallery-tab="wall"
      >
        照片墙
      </SiteLink>
      <SiteLink
        href={galleryAlbumsHref()}
        source="phone-link"
        className="plg-tab"
        aria-current={view === "albums" ? "page" : undefined}
        data-gallery-tab="albums"
      >
        相册
      </SiteLink>
    </nav>
  );
}
