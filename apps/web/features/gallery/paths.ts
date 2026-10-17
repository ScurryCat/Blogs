/**
 * 相册的 URL 构造（浏览器端与服务端共用）。
 *
 * 单独一个文件是因为两端都要构造**完全相同**的 URL：各写一份迟早会漂移（例如一端带
 * `kind`、另一端忘了编码）。这里没有 `fetch`，因此两端都能安全 import。
 *
 * 路由映射（第三轮任务书 §4.1 起；07 §7 的旧 canonical 表已被本轮覆盖）：
 *
 * | 用途 | 路径 |
 * | --- | --- |
 * | 生活图库（唯一独立入口，默认照片墙） | `/gallery` |
 * | 生活图库 · 相册视图 | `/gallery?view=albums` |
 * | 单个相册（相册自己的排序） | `/gallery?scope=album&album=<slug>` |
 * | 我的殿堂首页（**只留作品**） | `/showcase` |
 * | 作品详情 | `/showcase/projects/<slug>` |
 * | 旧照片墙（兼容重定向 → `/gallery`） | `/showcase/photos` |
 * | 管理：作品 | `/admin/projects`、`/admin/projects/<id>` |
 * | 管理：相册 | `/admin/albums`、`/admin/albums/<id>` |
 * | API：公开 | `/api/v1/gallery/albums`、`/api/v1/gallery/photos` |
 * | API：管理 | `/api/v1/admin/albums` |
 *
 * 第三轮语义（任务书 §4.1）：`/gallery` 是生活图库的**唯一**独立入口，默认照片墙，
 * 提供「照片墙 / 相册」切换；相册负责组织图片，照片墙读公开相册图片、没有自己的上传
 * 发布或数据副本。INS 相册入口、生活页、地图都深链回这里（不复制图库）。
 *
 * 旧 `/showcase/photos` 由重定向页转到 `/gallery`（见 `legacyPhotosRedirectPath`），
 * **不再**是殿堂的一部分；因此旧地址也不能触发殿堂过场（N0 的 `showcase-boundary`
 * 已把该前缀排除）。
 */

import { isAlbumKind, type AlbumKind, type WallScope } from "./types";

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

/** 我的殿堂（作品）的页面路径。 */
export const SHOWCASE_PATH = "/showcase";
/** 生活图库的**唯一**独立入口（第三轮任务书 §4.1）。 */
export const GALLERY_PATH = "/gallery";
/** 旧照片墙地址：只保留兼容重定向，不再是殿堂的一部分。 */
export const LEGACY_PHOTOS_PATH = "/showcase/photos";

/** 图库页的两种视图：照片墙（默认） / 相册。 */
export type GalleryViewMode = "wall" | "albums";

export const GALLERY_VIEW_PARAM = "view";
export const GALLERY_ALBUMS_VIEW = "albums";

/** 把 URL 里的 `view` 参数归一成视图；未知值按默认照片墙处理（不 404）。 */
export function normalizeGalleryView(raw: string | null | undefined): GalleryViewMode {
  return raw === GALLERY_ALBUMS_VIEW ? "albums" : "wall";
}

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

/** 照片墙（默认视图）；传 `album` 时深链到某个相册的 scope（相册自己的排序）。 */
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
  return suffix ? `${GALLERY_PATH}?${suffix}` : GALLERY_PATH;
}

export function galleryAlbumHref(slug: string): string {
  return galleryHref({ album: slug });
}

/** 相册视图（相册卡列表）；照片墙是默认视图，因此不需要参数。 */
export function galleryAlbumsHref(): string {
  return `${GALLERY_PATH}?${GALLERY_VIEW_PARAM}=${GALLERY_ALBUMS_VIEW}`;
}

function firstSearchValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw?.trim();
  return text ? text : null;
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 旧 `/showcase/photos` → `/gallery` 的重定向目标（保留合法筛选参数）。
 *
 * 任务书 §4.1：旧照片墙「保留重定向，携带原相册与合法筛选参数，如 `album`、`scope`、
 * `kind`、`year` 等」。这里只白名单转发**筛选**参数：
 *  - `album`：相册 slug（原样转发；是否存在的判断交回 API，不在这里猜）；
 *  - `scope=album` 只有在同时给了 `album` 时才有意义（相册手工顺序）；
 *  - `kind` 必须是已知的相册类型，未知值丢弃（避免把垃圾参数带进新地址）；
 *  - `year` / `month` 必须是正整数 / 合法月份；
 *  - `cursor` / `limit` 等分页参数不转发（它属于上一页的游标，跨页面复用会错位）。
 *
 * 纯函数，页面与测试共用；不读全局 `window`。
 */
export function legacyPhotosRedirectPath(
  search: Record<string, string | string[] | undefined> | URLSearchParams,
): string {
  const get = (key: string): string | null => {
    if (search instanceof URLSearchParams) {
      const value = search.get(key);
      return value && value.trim() ? value.trim() : null;
    }
    return firstSearchValue(search[key]);
  };

  const album = get("album");
  const query = new URLSearchParams();
  if (album) {
    query.set("album", album);
    if (get("scope") === "album") query.set("scope", "album");
  }
  const kind = get("kind");
  if (isAlbumKind(kind)) query.set("kind", kind);
  const year = positiveInt(get("year"));
  if (year) query.set("year", String(year));
  const month = positiveInt(get("month"));
  if (month && month <= 12) query.set("month", String(month));
  const suffix = query.toString();
  return suffix ? `${GALLERY_PATH}?${suffix}` : GALLERY_PATH;
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
  /** 生活图库的独立入口（第三轮起是 `/gallery`，不再是 `/showcase/photos`）。 */
  standalone: GALLERY_PATH,
  albumsView: GALLERY_ALBUMS_VIEW,
  /** 旧照片墙地址：仅用于兼容重定向（见 `legacyPhotosRedirectPath`）。 */
  legacyPhotos: LEGACY_PHOTOS_PATH,
  admin: "/admin/albums",
  adminProjects: "/admin/projects",
  insTabId: "gallery",
  insTabLabel: "相册",
  insTabAriaLabel: "照片墙相册",
  insTabOrder: 30,
  /** INS 里最多铺多少张照片（紧凑视图，不把整个图库拉进动态页）。 */
  insPreviewLimit: 12,
  /**
   * 手机内置应用 id（manifest 与 `PhoneUrlState.phone` 用它）。
   *
   * 第三轮起图库不再属于殿堂，但**旧手机深链**仍是 `?phone=showcase&screen=photos`
   * 或 `&screen=album&item=<slug>`；`features/showcase/phone-view.tsx` 会把这两种屏幕
   * 转发到 `/gallery`（保留目标相册），所以 id / screens 仍保持旧值。
   */
  phoneAppId: "showcase",
  phoneScreens: ["projects", "project", "photos", "album"] as const,
});
