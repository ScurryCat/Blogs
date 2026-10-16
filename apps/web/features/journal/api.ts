/**
 * 手记的同源 API 客户端（05 §6 / §7）。
 *
 * 一律通过 T02 的共享客户端 `lib/api/client.ts`：
 * 读取退避重试一次；写操作**不自动重试**（05 §10）；
 * 并发控制用 `If-Match: "<version>"`（缺失 428、过期 412）；
 * CSRF token 从 `GET /auth/session` 下发，放在写请求的 JSON body 字段 `csrf_token`
 * （服务端同样接受 `X-CSRF-Token` 头，见 core/csrf.py）。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import type {
  JournalAdminEntry,
  JournalCalendar,
  JournalEntryDetail,
  JournalEntryList,
  JournalEntrySummary,
  JournalPatch,
  JournalVisibility,
  JournalWriteInput,
} from "./types";

export const JOURNAL_API = {
  entries: "/journal/entries",
  entry: (id: string) => `/journal/entries/${encodeURIComponent(id)}`,
  calendar: "/journal/calendar",
  adminEntries: "/admin/journal/entries",
  adminEntry: (id: string) => `/admin/journal/entries/${encodeURIComponent(id)}`,
  publish: (id: string) => `/admin/journal/entries/${encodeURIComponent(id)}/publish`,
  unpublish: (id: string) => `/admin/journal/entries/${encodeURIComponent(id)}/unpublish`,
  visibility: (id: string) => `/admin/journal/entries/${encodeURIComponent(id)}/visibility`,
} as const;

export interface CalendarQuery {
  year?: number;
  month?: number;
}

function calendarQuery(params: CalendarQuery): string {
  const query = new URLSearchParams();
  if (params.year !== undefined) query.set("year", String(params.year));
  if (params.month !== undefined) query.set("month", String(params.month));
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

// --- 公开 -------------------------------------------------------------------

export function listEntries(
  params: CalendarQuery & { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<JournalEntryList> {
  const query = new URLSearchParams();
  if (params.year !== undefined) query.set("year", String(params.year));
  if (params.month !== undefined) query.set("month", String(params.month));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return apiRequest<JournalEntryList>(
    suffix ? `${JOURNAL_API.entries}?${suffix}` : JOURNAL_API.entries,
    { signal },
  );
}

/** 分页读取公开列表（上限保护，避免死循环）。 */
export async function listAllEntries(
  params: CalendarQuery = {},
  signal?: AbortSignal,
  maxPages = 10,
): Promise<JournalEntrySummary[]> {
  const collected: JournalEntrySummary[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const response: JournalEntryList = await listEntries(
      { ...params, limit: 30, ...(cursor ? { cursor } : {}) },
      signal,
    );
    collected.push(...response.items);
    cursor = response.next_cursor;
    if (!cursor) break;
  }
  return collected;
}

export function getEntry(id: string, signal?: AbortSignal): Promise<JournalEntryDetail> {
  return apiRequest<JournalEntryDetail>(JOURNAL_API.entry(id), { signal });
}

export function getCalendar(params: CalendarQuery = {}, signal?: AbortSignal): Promise<JournalCalendar> {
  return apiRequest<JournalCalendar>(`${JOURNAL_API.calendar}${calendarQuery(params)}`, { signal });
}

// --- 管理 -------------------------------------------------------------------

export function listAdminEntries(
  params: { status?: string; visibility?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<JournalAdminEntry>> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.visibility) query.set("visibility", params.visibility);
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 30));
  return apiRequest<Page<JournalAdminEntry>>(
    `${JOURNAL_API.adminEntries}?${query.toString()}`,
    { signal },
  );
}

export function getAdminEntry(id: string, signal?: AbortSignal): Promise<JournalAdminEntry> {
  return apiRequest<JournalAdminEntry>(JOURNAL_API.adminEntry(id), { signal });
}

export function createEntry(input: JournalWriteInput, csrfToken: string): Promise<JournalAdminEntry> {
  return apiRequest<JournalAdminEntry>(JOURNAL_API.adminEntries, {
    method: "POST",
    body: { ...input, csrf_token: csrfToken },
  });
}

export function updateEntry(
  id: string,
  patch: JournalPatch,
  version: number,
  csrfToken: string,
): Promise<JournalAdminEntry> {
  return apiRequest<JournalAdminEntry>(JOURNAL_API.adminEntry(id), {
    method: "PATCH",
    body: { ...patch, csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function publishEntry(
  id: string,
  version: number,
  csrfToken: string,
): Promise<JournalAdminEntry> {
  return apiRequest<JournalAdminEntry>(JOURNAL_API.publish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function unpublishEntry(
  id: string,
  version: number,
  csrfToken: string,
): Promise<JournalAdminEntry> {
  return apiRequest<JournalAdminEntry>(JOURNAL_API.unpublish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

/** 切 public / private。服务端即时生效；界面刷新该条即可看到结论。 */
export function setVisibility(
  id: string,
  visibility: JournalVisibility,
  version: number,
  csrfToken: string,
): Promise<JournalAdminEntry> {
  return apiRequest<JournalAdminEntry>(
    `${JOURNAL_API.visibility(id)}?visibility=${visibility}`,
    { method: "POST", body: { csrf_token: csrfToken }, ifMatch: `"${version}"` },
  );
}

export function deleteEntry(id: string, version: number, csrfToken: string): Promise<void> {
  return apiRequest<void>(JOURNAL_API.adminEntry(id), {
    method: "DELETE",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}
