/**
 * 问题记录的 URL 构造（浏览器端与服务端共用，`apps/web/features/exploration`）。
 *
 * 路由映射（任务卡给出的文件边界）：
 *
 * | 用途 | 路径 |
 * | --- | --- |
 * | 印象空间问题记录（canonical） | `/apps/metanav/mementos` |
 * | 单条记录 | `/apps/metanav/mementos/<slug>`（可分享 / 可刷新 / Back 可用） |
 * | 管理：问题记录 | `/admin/exploration`、`/admin/exploration/<id>` |
 *
 * **保留 T04 的分类探索**（任务卡执行清单）：分类印象空间仍在
 * `/apps/metanav?screen=mugen`（T04 所有），本模块**不**接管那条路径，
 * 只在页面上给出互相链接。
 */

import type { WorkStatus } from "./types";

export const RECORDS_REL = {
  list: "/exploration/records",
  admin: "/admin/exploration/records",
} as const;

export const RECORDS_API = {
  list: `/api/v1${RECORDS_REL.list}`,
  stats: `/api/v1${RECORDS_REL.list}/stats`,
  admin: `/api/v1${RECORDS_REL.admin}`,
} as const;

/** 印象空间问题记录的 canonical 地址（任务卡指定的路径）。 */
export const MEMENTOS_PATH = "/apps/metanav/mementos";
/** T04 的分类探索（**不改**，只链接过去）。 */
export const CATEGORY_EXPLORATION_PATH = "/apps/metanav?screen=mugen";
/** 管理页面的地址前缀（页面路由，不是 API）。 */
export const ADMIN_EXPLORATION_PAGE = "/admin/exploration";

/** 单条记录的可分享地址。`slug` 会做 URL 编码，不接受任意路径。 */
export function recordHref(slug: string): string {
  return `${MEMENTOS_PATH}/${encodeURIComponent(slug)}`;
}

/** 记录在列表里的相对路径（服务端读取用）。 */
export function recordDetailRelPath(slug: string): string {
  return recordRelPath(slug);
}

export function adminRecordPagePath(recordId: string): string {
  return `${ADMIN_EXPLORATION_PAGE}/${encodeURIComponent(recordId)}`;
}

export function recordPath(slug: string): string {
  return `${RECORDS_API.list}/${encodeURIComponent(slug)}`;
}

export function adminRecordPath(recordId: string): string {
  return `${RECORDS_API.admin}/${encodeURIComponent(recordId)}`;
}

/** 服务端读取用的相对路径。 */
export function recordRelPath(slug: string): string {
  return `${RECORDS_REL.list}/${encodeURIComponent(slug)}`;
}

export interface RecordListQuery {
  work_status?: WorkStatus | null;
  cursor?: string | null;
  limit?: number;
}

export function recordListQuery(params: RecordListQuery = {}): string {
  const query = new URLSearchParams();
  if (params.work_status) query.set("work_status", params.work_status);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${RECORDS_API.list}?${suffix}` : RECORDS_API.list;
}

export function recordListRelQuery(params: RecordListQuery = {}): string {
  const full = recordListQuery(params);
  return full.startsWith(RECORDS_API.list)
    ? `${RECORDS_REL.list}${full.slice(RECORDS_API.list.length)}`
    : full;
}

export function adminRecordListQuery(
  params: {
    status?: string | null;
    work_status?: string | null;
    cursor?: string | null;
    limit?: number;
  } = {},
): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.work_status) query.set("work_status", params.work_status);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${RECORDS_API.admin}?${suffix}` : RECORDS_API.admin;
}

/** 按工作状态筛选的页面地址（供筛选按钮用）。 */
export function mementosHref(params: { work_status?: WorkStatus | null } = {}): string {
  const query = new URLSearchParams();
  if (params.work_status) query.set("work_status", params.work_status);
  const suffix = query.toString();
  return suffix ? `${MEMENTOS_PATH}?${suffix}` : MEMENTOS_PATH;
}

/** 详情页的返回地址：保留列表页的筛选条件（返回时不该换一套筛选）。 */
export function mementosBackHref(workStatus: WorkStatus | null): string {
  return mementosHref({ work_status: workStatus });
}
