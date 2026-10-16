/**
 * 放课后的同源 API 客户端（05 §6 / §7）。
 *
 * 与 journal 相同的传输约定：共享客户端、读取重试一次、写不重试、
 * `If-Match: "<version>"`、CSRF token 放 body（服务端也接受请求头）。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import type {
  LeisureAdminEntry,
  LeisureKind,
  LeisureList,
  LeisurePatch,
  LeisureWriteInput,
} from "./types";

export const LEISURE_API = {
  entries: "/leisure/entries",
  entry: (id: string) => `/leisure/entries/${encodeURIComponent(id)}`,
  adminEntries: "/admin/leisure/entries",
  adminEntry: (id: string) => `/admin/leisure/entries/${encodeURIComponent(id)}`,
  publish: (id: string) => `/admin/leisure/entries/${encodeURIComponent(id)}/publish`,
  unpublish: (id: string) => `/admin/leisure/entries/${encodeURIComponent(id)}/unpublish`,
} as const;

export interface LeisureQuery {
  kind?: LeisureKind;
  progress?: string;
  cursor?: string;
  limit?: number;
}

function query(params: LeisureQuery): string {
  const search = new URLSearchParams();
  if (params.kind) search.set("kind", params.kind);
  if (params.progress) search.set("progress", params.progress);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

// --- 公开 -------------------------------------------------------------------

export function listEntries(
  params: LeisureQuery = {},
  signal?: AbortSignal,
): Promise<LeisureList> {
  return apiRequest<LeisureList>(`${LEISURE_API.entries}${query(params)}`, { signal });
}

/** 分页读取某个页签的全部条目（上限保护）。 */
export async function listAllEntries(
  kind: LeisureKind,
  signal?: AbortSignal,
  maxPages = 10,
): Promise<LeisureList["items"]> {
  const collected: LeisureList["items"] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await listEntries(
      { kind, limit: 30, ...(cursor ? { cursor } : {}) },
      signal,
    );
    collected.push(...response.items);
    cursor = response.next_cursor;
    if (!cursor) break;
  }
  return collected;
}

// --- 管理 -------------------------------------------------------------------

export function listAdminEntries(
  params: { kind?: LeisureKind; status?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<LeisureAdminEntry>> {
  const search = new URLSearchParams();
  if (params.kind) search.set("kind", params.kind);
  if (params.status) search.set("status", params.status);
  if (params.cursor) search.set("cursor", params.cursor);
  search.set("limit", String(params.limit ?? 30));
  return apiRequest<Page<LeisureAdminEntry>>(
    `${LEISURE_API.adminEntries}?${search.toString()}`,
    { signal },
  );
}

export function getAdminEntry(id: string, signal?: AbortSignal): Promise<LeisureAdminEntry> {
  return apiRequest<LeisureAdminEntry>(LEISURE_API.adminEntry(id), { signal });
}

export function createEntry(
  input: LeisureWriteInput,
  csrfToken: string,
): Promise<LeisureAdminEntry> {
  return apiRequest<LeisureAdminEntry>(LEISURE_API.adminEntries, {
    method: "POST",
    body: { ...input, csrf_token: csrfToken },
  });
}

export function updateEntry(
  id: string,
  patch: LeisurePatch,
  version: number,
  csrfToken: string,
): Promise<LeisureAdminEntry> {
  return apiRequest<LeisureAdminEntry>(LEISURE_API.adminEntry(id), {
    method: "PATCH",
    body: { ...patch, csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function publishEntry(
  id: string,
  version: number,
  csrfToken: string,
): Promise<LeisureAdminEntry> {
  return apiRequest<LeisureAdminEntry>(LEISURE_API.publish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function unpublishEntry(
  id: string,
  version: number,
  csrfToken: string,
): Promise<LeisureAdminEntry> {
  return apiRequest<LeisureAdminEntry>(LEISURE_API.unpublish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function deleteEntry(id: string, version: number, csrfToken: string): Promise<void> {
  return apiRequest<void>(LEISURE_API.adminEntry(id), {
    method: "DELETE",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}
