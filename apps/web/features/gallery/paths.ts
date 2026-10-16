/**
 * 相册的 URL 构造（浏览器端与服务端共用）。
 *
 * 单独一个文件是因为两端都要构造**完全相同**的 URL：各写一份迟早会漂移（例如一端带
 * `kind`、另一端忘了编码）。这里没有 `fetch`，因此两端都能安全 import。
 *
 * 路由映射（07 §7 的 canonical 路由表）：
 *
 * | 用途 | 路径 |
 * | --- | --- |
 * | 我的殿堂首页（作品） | `/showcase` |
 * | 作品详情 | `/showcase/projects/<slug>` |
 * | 照片墙（独立画廊） | `/showcase/photos` |
 * | 单个相册 | `/showcase/photos?album=<slug>` |
 * | 管理：作品 | `/admin/projects`、`/admin/projects/<id>` |
 * | 管理：相册 | `/admin/albums`、`/admin/albums/<id>` |
 * | API：公开 | `/api/v1/gallery/albums`、`/api/v1/gallery/photos` |
 * | API：管理 | `/api/v1/admin/albums` |
 *
 * 手机宿主与 INS 页签都用 `galleryAlbumHref()` 深链到**同一个**独立画廊，
 * 不复制一套图库（验收 4：INS 与独立照片墙的相册 / 图片一致）。
 */

import type { AlbumKind, WallScope } from "./types";

/**
 * 相对路径（**不含** `/api/v1` 前缀）。
 *
 * 为什么要有这一组：服务端读取走 `lib/api/server.ts` 的 `serverApiRequest`，它自己会
 * 加上 `/api/v1`；而浏览器走 `apiRequest`，需要完整路径。第一版只定义了带前缀的一组，
 * 于是服务端请求变成了 `/api/v1/api/v1/...` —— 页面表现为「作品详情 404」，
 * 但 API 日志里是路径错了（真实踩到过，见交付单 §5.5）。
 */
export const GALLERY_REL = {
  albums: "/gallery/albums",
  photos: "/gallery/photos",
  photoYears: "/gallery/photos/years",
  adminAlbums: "/admin/albums",
} as const;

/** 浏览器同源路径（`/api/v1` 前缀由这里一次性加上）。 */
export const GALLERY_API = {
  albums: `/api/v1${GALLERY_REL.albums}`,
  photos: `/api/v1${GALLERY_REL.photos}`,
  photoYears: `/api/v1${GALLERY_REL.photoYears}`,
  adminAlbums: `/api/v1${GALLERY_REL.adminAlbums}`,
} as const;

/** 独立画廊的页面路径。 */
export const SHOWCASE_PATH = "/showcase";
export const PHOTOS_PATH = "/showcase/photos";

export interface WallQuery {
  scope?: WallScope;
  album?: string | null;
  /**
   * 只给 `album` 时默认切到 `scope=album`（相册浏览用**手工顺序**）。
   *
   * 为什么需要这个开关：`album` 也用于按相册筛选，而那种场景下排序仍应是全局的
   * （按拍摄时间）。真实缺陷：照片墙上的相册筛选链接只传了 `album`，服务端按
   * `scope=global` 处理，于是「点相册」看起来没生效（浏览器验收抓到，3 格而不是 1 格）。
   */
  albumScope?: boolean;
  kind?: AlbumKind | null;
  year?: number | null;
  month?: number | null;
  cursor?: string | null;
  limit?: number;
}

/** 照片墙查询串（服务端用；相对路径）。 */
export function wallRelQuery(params: WallQuery = {}): string {
  return relative(wallQuery(params), GALLERY_API.photos, GALLERY_REL.photos);
}

/** 把浏览器用的完整路径换成服务端用的相对路径（只替换开头的 `/api/v1`）。 */
function relative(full: string, from: string, to: string): string {
  return full.startsWith(from) ? `${to}${full.slice(from.length)}` : full;
}

export function wallQuery(params: WallQuery = {}): string {
  const query = new URLSearchParams();
  const scope: WallScope = params.scope ?? (params.album && params.albumScope ? "album" : "global");
  if (scope !== "global") query.set("scope", scope);
  if (params.album) query.set("album", params.album);
  if (params.kind) query.set("kind", params.kind);
  if (params.year) query.set("year", String(params.year));
  if (params.month) query.set("month", String(params.month));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${GALLERY_API.photos}?${suffix}` : GALLERY_API.photos;
}

/** 相册列表查询串（服务端用；相对路径）。 */
export function albumListRelQuery(
  params: { kind?: AlbumKind | null; cursor?: string | null; limit?: number } = {},
): string {
  return relative(albumListQuery(params), GALLERY_API.albums, GALLERY_REL.albums);
}

export function albumListQuery(
  params: { kind?: AlbumKind | null; cursor?: string | null; limit?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${GALLERY_API.albums}?${suffix}` : GALLERY_API.albums;
}

export function albumDetailPath(slug: string): string {
  return `${GALLERY_API.albums}/${encodeURIComponent(slug)}`;
}

/** 相册详情（服务端用；相对路径）。 */
export function albumDetailRelPath(slug: string): string {
  return `${GALLERY_REL.albums}/${encodeURIComponent(slug)}`;
}

export function adminAlbumListQuery(
  params: { status?: string | null; kind?: string | null; cursor?: string | null; limit?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.kind) query.set("kind", params.kind);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${GALLERY_API.adminAlbums}?${suffix}` : GALLERY_API.adminAlbums;
}

export function adminAlbumPath(albumId: string): string {
  return `${GALLERY_API.adminAlbums}/${albumId}`;
}

export function adminAlbumPhotoPath(albumId: string, mediaId: string): string {
  return `${GALLERY_API.adminAlbums}/${albumId}/photos/${mediaId}`;
}

// --- 页面地址（站内，SiteLink 用） -----------------------------------------

/** 照片墙；传 `album` 时深链到某个相册的 scope。 */
export function galleryHref(
  params: { album?: string | null; kind?: AlbumKind | null; year?: number | null } = {},
): string {
  const query = new URLSearchParams();
  if (params.album) {
    // 相册链接 = 相册浏览（手工顺序），因此要显式带 scope。
    query.set("scope", "album");
    query.set("album", params.album);
  }
  if (params.kind) query.set("kind", params.kind);
  if (params.year) query.set("year", String(params.year));
  const suffix = query.toString();
  return suffix ? `${PHOTOS_PATH}?${suffix}` : PHOTOS_PATH;
}

export function galleryAlbumHref(slug: string): string {
  return galleryHref({ album: slug });
}

/** 作品详情页地址（展示页）。 */
export function projectHref(slug: string): string {
  return `${SHOWCASE_PATH}/projects/${encodeURIComponent(slug)}`;
}

/**
 * INS 页签与手机宿主读的**路由映射**（交给 T00 注入）。
 *
 * `InsTabContribution.id` 不得占用内置页签 `feed` / `saved`
 * （`features/ins/composition.ts` 会抛 `InsTabConflictError`）。
 */
export const GALLERY_ROUTES = Object.freeze({
  showcase: SHOWCASE_PATH,
  standalone: PHOTOS_PATH,
  admin: "/admin/albums",
  adminProjects: "/admin/projects",
  insTabId: "gallery",
  insTabLabel: "相册",
  insTabAriaLabel: "照片墙相册",
  insTabOrder: 30,
  /** INS 里最多铺多少张照片（紧凑视图，不把整个图库拉进动态页）。 */
  insPreviewLimit: 12,
  /** 手机内置应用 id（manifest 与 `PhoneUrlState.phone` 用它）。 */
  phoneAppId: "showcase",
  phoneScreens: ["projects", "project", "photos", "album"] as const,
});
