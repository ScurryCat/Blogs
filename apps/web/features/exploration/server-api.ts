/**
 * 问题记录的服务端读取（仅服务端）。
 */

import { ApiClientError } from "@/lib/api/client";
import { serverApiRequest } from "@/lib/api/server";

import { recordListRelQuery, recordRelPath, type RecordListQuery } from "./paths";
import type { RecordDetail, RecordPage, RecordStats } from "./types";

if (typeof window !== "undefined") {
  throw new Error(
    "features/exploration/server-api.ts 只能在服务端使用；浏览器请用 features/exploration/api.ts",
  );
}

export function fetchRecordsOnServer(
  params: RecordListQuery = {},
  options: { baseUrl?: string } = {},
): Promise<RecordPage> {
  return serverApiRequest<RecordPage>(recordListRelQuery(params), options);
}

export function fetchRecordStatsOnServer(
  options: { baseUrl?: string } = {},
): Promise<RecordStats> {
  return serverApiRequest<RecordStats>("/exploration/records/stats", options);
}

/** 服务端取记录详情；`null` 表示 API 明确返回 404（页面应给出真正的 404）。 */
export async function fetchRecordOnServer(
  slug: string,
  options: { baseUrl?: string } = {},
): Promise<RecordDetail | null> {
  try {
    return await serverApiRequest<RecordDetail>(recordRelPath(slug), options);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}
