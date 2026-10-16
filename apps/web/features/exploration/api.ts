/**
 * 问题记录的浏览器端 API（T09 · 印象空间）。
 *
 * 与 `features/velvet/api.ts` 同形：同源 `/api/v1`、读走共享客户端
 * （`no-store` + 重试一次）、写不重试、CSRF 放请求体、写操作带 `If-Match`。
 *
 * 特别注意「工作状态」的写入：`work_status: "resolved"` 时服务端**必须**能读到
 * 非空的结果说明，否则 409。界面因此要在提交前就提示（见 admin 工作区），
 * 但**服务端才是权威** —— 绕过界面直接请求也会被拒（后端有用例）。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import {
  adminRecordListQuery,
  adminRecordPath,
  recordListQuery,
  recordPath,
  type RecordListQuery,
} from "./paths";
import type {
  AdminRecord,
  EvidenceLinkInput,
  RecordDetail,
  RecordPage,
  RecordStats,
  RelatedPostRelationInput,
  RelatedProjectRelationInput,
} from "./types";

function withCsrf<T extends object>(csrfToken: string, payload: T): T & { csrf_token: string } {
  return { ...payload, csrf_token: csrfToken };
}

// --- 公开读取 ---------------------------------------------------------------

export function fetchRecords(
  params: RecordListQuery = {},
  signal?: AbortSignal,
): Promise<RecordPage> {
  return apiRequest<RecordPage>(recordListQuery(params), { signal });
}

export function fetchRecord(slug: string, signal?: AbortSignal): Promise<RecordDetail> {
  return apiRequest<RecordDetail>(recordPath(slug), { signal });
}

export function fetchRecordStats(signal?: AbortSignal): Promise<RecordStats> {
  return apiRequest<RecordStats>("/exploration/records/stats", { signal });
}

// --- 管理读取 ---------------------------------------------------------------

export function fetchAdminRecords(
  params: {
    status?: string | null;
    work_status?: string | null;
    cursor?: string | null;
    limit?: number;
  } = {},
  signal?: AbortSignal,
): Promise<Page<AdminRecord>> {
  return apiRequest<Page<AdminRecord>>(adminRecordListQuery(params), { signal });
}

export function fetchAdminRecord(recordId: string, signal?: AbortSignal): Promise<AdminRecord> {
  return apiRequest<AdminRecord>(adminRecordPath(recordId), { signal });
}

// --- 管理写入（不自动重试，05 §10） ----------------------------------------

export interface RecordWriteInput {
  slug?: string;
  title: string;
  background: string;
  attempts: string;
  outcome: string;
  work_status: string;
  evidence_links: EvidenceLinkInput[];
  posts?: RelatedPostRelationInput[];
  projects?: RelatedProjectRelationInput[];
}

export function createRecord(
  csrfToken: string,
  payload: RecordWriteInput,
  signal?: AbortSignal,
): Promise<AdminRecord> {
  return apiRequest<AdminRecord>(adminRecordListQuery(), {
    method: "POST",
    body: withCsrf(csrfToken, payload),
    signal,
  });
}

export function updateRecord(
  csrfToken: string,
  recordId: string,
  version: number,
  patch: Partial<RecordWriteInput>,
  signal?: AbortSignal,
): Promise<AdminRecord> {
  return apiRequest<AdminRecord>(adminRecordPath(recordId), {
    method: "PATCH",
    body: withCsrf(csrfToken, patch),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function publishRecord(
  csrfToken: string,
  recordId: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminRecord> {
  return apiRequest<AdminRecord>(`${adminRecordPath(recordId)}/publish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function unpublishRecord(
  csrfToken: string,
  recordId: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminRecord> {
  return apiRequest<AdminRecord>(`${adminRecordPath(recordId)}/unpublish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function deleteRecord(
  csrfToken: string,
  recordId: string,
  version: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(adminRecordPath(recordId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}
