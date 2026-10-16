/**
 * 相册的浏览器端 API（T06）。
 *
 * 边界（SHARED-CONTRACTS §1）：
 *  - 浏览器只用 `lib/api/client.ts`（同源 `/api/v1`、`no-store`、读重试一次、写不重试）；
 *  - **不 import `lib/api/server.ts`**：那个模块在浏览器里会立即抛错（防止内部地址
 *    被打进客户端产物）。服务端读取在 `server-api.ts`，两端共用 `paths.ts` 的 URL 构造。
 *
 * 写操作（新建 / 更新 / 发布 / 撤回 / 删除 / 移除单张照片）都带 `If-Match`：
 * 缺头 428、版本不符 412。412 时调用方必须**保留未保存输入**，不自动覆盖（05 §7）。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import {
  adminAlbumListQuery,
  adminAlbumPath,
  adminAlbumPhotoPath,
  albumDetailPath,
  albumListQuery,
  wallQuery,
  type WallQuery,
  GALLERY_API,
} from "./paths";
import type {
  AdminAlbum,
  AdminPhotoInput,
  AlbumDetail,
  AlbumKind,
  AlbumPage,
  PhotoPage,
} from "./types";

/**
 * 把 CSRF token 放进请求体。
 *
 * 为什么是 body 而不是 `X-CSRF-Token` 头：与 T03 保持一致的做法（服务端**同时接受**
 * 两者，见 `app/core/csrf.py`），这样不为一件事维护两条通道。
 */
function withCsrf<T extends object>(csrfToken: string, payload: T): T & { csrf_token: string } {
  return { ...payload, csrf_token: csrfToken };
}

// --- 公开读取 -------------------------------------------------------------

export function fetchAlbums(
  params: { kind?: AlbumKind | null; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<AlbumPage> {
  return apiRequest<AlbumPage>(albumListQuery(params), { signal });
}

export function fetchAlbumDetail(slug: string, signal?: AbortSignal): Promise<AlbumDetail> {
  return apiRequest<AlbumDetail>(albumDetailPath(slug), { signal });
}

export function fetchWallPhotos(
  params: WallQuery = {},
  signal?: AbortSignal,
): Promise<PhotoPage> {
  return apiRequest<PhotoPage>(wallQuery(params), { signal });
}

export function fetchWallYears(signal?: AbortSignal): Promise<number[]> {
  return apiRequest<number[]>(GALLERY_API.photoYears, { signal });
}

// --- 管理读取 -------------------------------------------------------------

export function fetchAdminAlbums(
  params: { status?: string | null; kind?: string | null; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AdminAlbum>> {
  return apiRequest<Page<AdminAlbum>>(adminAlbumListQuery(params), { signal });
}

export function fetchAdminAlbum(albumId: string, signal?: AbortSignal): Promise<AdminAlbum> {
  return apiRequest<AdminAlbum>(adminAlbumPath(albumId), { signal });
}

// --- 管理写入 -------------------------------------------------------------

export interface AlbumWritePayload {
  slug?: string;
  title?: string;
  description?: string;
  kind?: AlbumKind;
  position?: number;
  photos?: AdminPhotoInput[];
}

export function createAlbum(
  payload: AlbumWritePayload & { slug: string; title: string },
  csrfToken: string,
  signal?: AbortSignal,
): Promise<AdminAlbum> {
  return apiRequest<AdminAlbum>(GALLERY_API.adminAlbums, {
    method: "POST",
    body: withCsrf(csrfToken, payload),
    signal,
  });
}

export function updateAlbum(
  albumId: string,
  payload: AlbumWritePayload,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminAlbum> {
  return apiRequest<AdminAlbum>(adminAlbumPath(albumId), {
    method: "PATCH",
    body: withCsrf(csrfToken, payload),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function publishAlbum(
  albumId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminAlbum> {
  return apiRequest<AdminAlbum>(`${adminAlbumPath(albumId)}/publish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function unpublishAlbum(
  albumId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminAlbum> {
  return apiRequest<AdminAlbum>(`${adminAlbumPath(albumId)}/unpublish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function deleteAlbum(
  albumId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(adminAlbumPath(albumId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

/**
 * 从相册移除**一张**照片（单处撤回）。
 *
 * 只删相册这一处关系行：同一张 media 仍被动态 / 作品 / 另一个相册引用时，
 * 匿名读图仍然成功（05 §11、验收 3）。界面文案必须说清楚这一点，不能写成「删除图片」。
 */
export function removeAlbumPhoto(
  albumId: string,
  mediaId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(adminAlbumPhotoPath(albumId, mediaId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}
