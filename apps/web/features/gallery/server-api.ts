/**
 * 相册的服务端读取（仅服务端）。
 *
 * 与 `api.ts`（浏览器端）分开的理由是**结构性的**：`lib/api/server.ts` 在浏览器里会立刻
 * 抛错（防止内部地址被打进客户端产物）。因此任何客户端组件只要 import 了 `api.ts`，
 * 就绝不能让它间接把 server 模块拖进来（T03 踩过：`FeedView` 在 jsdom / 浏览器里直接崩）。
 *
 * 现在：客户端 → `api.ts`；服务端组件 → `server-api.ts`。两边共用 `paths.ts`
 * 里的路径与查询串构造，避免出现两套 URL。
 */

import { ApiClientError } from "@/lib/api/client";
import { serverApiRequest } from "@/lib/api/server";

import {
  albumDetailRelPath,
  albumListRelQuery,
  wallRelQuery,
  type WallQuery,
  GALLERY_REL,
} from "./paths";
import type { AlbumDetail, AlbumKind, AlbumPage, PhotoPage } from "./types";

if (typeof window !== "undefined") {
  throw new Error(
    "features/gallery/server-api.ts 只能在服务端使用；浏览器请用 features/gallery/api.ts",
  );
}

export function fetchAlbumsOnServer(
  params: { kind?: AlbumKind | null; limit?: number } = {},
  options: { baseUrl?: string } = {},
): Promise<AlbumPage> {
  return serverApiRequest<AlbumPage>(albumListRelQuery(params), options);
}

/** 服务端取相册详情；`null` 表示 API 明确返回 404（页面应给出真正的 404）。 */
export async function fetchAlbumOnServer(
  slug: string,
  options: { baseUrl?: string } = {},
): Promise<AlbumDetail | null> {
  try {
    return await serverApiRequest<AlbumDetail>(albumDetailRelPath(slug), options);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}

export function fetchWallOnServer(
  params: WallQuery = {},
  options: { baseUrl?: string } = {},
): Promise<PhotoPage> {
  return serverApiRequest<PhotoPage>(wallRelQuery(params), options);
}

export async function fetchWallYearsOnServer(
  options: { baseUrl?: string } = {},
): Promise<number[]> {
  try {
    return await serverApiRequest<number[]>(GALLERY_REL.photoYears, options);
  } catch {
    // 年份筛选是**可选**的辅助入口：读不到就少显示一排按钮，
    // 不能让整个照片墙页面变成错误页（照片本身仍然是可读的）。
    return [];
  }
}
