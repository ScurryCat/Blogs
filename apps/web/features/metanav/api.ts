/**
 * 异世界导航的同源 API 客户端（05 §6 / §7）。
 *
 * 一律通过 T02 的共享客户端 `lib/api/client.ts` 访问同源 `/api/v1`：
 * 读取（GET）退避重试一次；写操作**不自动重试**（05 §10）；
 * 并发控制用 `If-Match: "<version>"`（缺失 428、过期 412）；
 * CSRF token 由 `GET /auth/session` 下发，放在写请求的 JSON body 字段 `csrf_token`
 * （服务端同样接受 `X-CSRF-Token` 头，见 core/csrf.py）。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import type {
  PalaceAdmin,
  PalacePatch,
  PalaceSummary,
  PalaceWriteInput,
  KeywordInput,
  PostSummary,
  ResolveResult,
  SearchItem,
} from "./types";

export const NAV_PATHS = {
  palaces: "/nav/palaces",
  palace: (slug: string) => `/nav/palaces/${encodeURIComponent(slug)}`,
  resolve: "/nav/resolve",
  search: "/nav/search",
  adminPalaces: "/admin/nav/palaces",
  adminPalace: (id: string) => `/admin/nav/palaces/${encodeURIComponent(id)}`,
  publish: (id: string) => `/admin/nav/palaces/${encodeURIComponent(id)}/publish`,
  unpublish: (id: string) => `/admin/nav/palaces/${encodeURIComponent(id)}/unpublish`,
} as const;

/** 公开：可进入的专题列表。 */
export function listPalaces(signal?: AbortSignal): Promise<Page<PalaceSummary>> {
  return apiRequest<Page<PalaceSummary>>(NAV_PATHS.palaces, { signal });
}

/** 公开：专题详情。不存在 / 未发布 / 没有公开文章统一 404。 */
export function getPalace(slug: string, signal?: AbortSignal): Promise<PalaceSummary & { posts: PostSummary[] }> {
  return apiRequest(NAV_PATHS.palace(slug), { signal });
}

/** 公开：认知定位。`not_found` 是正常 200 结果，不是错误。 */
export function resolveKeywords(input: KeywordInput, signal?: AbortSignal): Promise<ResolveResult> {
  return apiRequest<ResolveResult>(NAV_PATHS.resolve, { method: "POST", body: input, signal });
}

export interface SearchParams {
  q: string;
  kind?: "post" | "palace";
  tag?: string;
  cursor?: string;
  limit?: number;
}

/** 公开：普通搜索。 */
export function searchNav(params: SearchParams, signal?: AbortSignal): Promise<Page<SearchItem>> {
  const query = new URLSearchParams({ q: params.q });
  if (params.kind) query.set("kind", params.kind);
  if (params.tag) query.set("tag", params.tag);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  return apiRequest<Page<SearchItem>>(`${NAV_PATHS.search}?${query.toString()}`, { signal });
}

/** 印象空间：复用公开文章列表接口，按分类筛选（04 §4C）。 */
export function listPostsByCategory(
  category: string,
  signal?: AbortSignal,
): Promise<Page<PostSummary>> {
  const query = new URLSearchParams({ category, limit: "30" });
  return apiRequest<Page<PostSummary>>(`/posts?${query.toString()}`, { signal });
}

// --- 管理 -------------------------------------------------------------------

export function listAdminPalaces(signal?: AbortSignal): Promise<Page<PalaceAdmin>> {
  return apiRequest<Page<PalaceAdmin>>(`${NAV_PATHS.adminPalaces}?limit=30`, { signal });
}

export function getAdminPalace(id: string, signal?: AbortSignal): Promise<PalaceAdmin> {
  return apiRequest<PalaceAdmin>(NAV_PATHS.adminPalace(id), { signal });
}

export function createPalace(input: PalaceWriteInput, csrfToken: string): Promise<PalaceAdmin> {
  return apiRequest<PalaceAdmin>(NAV_PATHS.adminPalaces, {
    method: "POST",
    body: { ...input, csrf_token: csrfToken },
  });
}

/** 更新。只提交 patch 里出现的字段；关系列表传入时完整替换。 */
export function updatePalace(
  id: string,
  patch: PalacePatch,
  version: number,
  csrfToken: string,
): Promise<PalaceAdmin> {
  return apiRequest<PalaceAdmin>(NAV_PATHS.adminPalace(id), {
    method: "PATCH",
    body: { ...patch, csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function publishPalace(id: string, version: number, csrfToken: string): Promise<PalaceAdmin> {
  return apiRequest<PalaceAdmin>(NAV_PATHS.publish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function unpublishPalace(id: string, version: number, csrfToken: string): Promise<PalaceAdmin> {
  return apiRequest<PalaceAdmin>(NAV_PATHS.unpublish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function deletePalace(id: string, version: number, csrfToken: string): Promise<void> {
  return apiRequest<void>(NAV_PATHS.adminPalace(id), {
    method: "DELETE",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}
