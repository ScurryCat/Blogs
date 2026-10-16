/**
 * INS 的 API 路径与查询串（浏览器端与服务端共用）。
 *
 * 单独一个文件是因为两端都要构造完全相同的 URL：各写一份迟早会漂移
 * （例如一端带 `tag`、另一端忘了编码）。这里没有 `fetch`，因此两端都能安全 import。
 */

import { ADMIN_MOMENTS_PATH, MOMENTS_PATH } from "./types";

/** T01 的共享媒体上传端点（本包只调用，不实现）。 */
export const ADMIN_MEDIA_PATH = "/api/v1/admin/media";
export const AUTH_SESSION_PATH = "/auth/session";

export interface MomentListQuery {
  tag?: string | null;
  cursor?: string | null;
  limit?: number;
}

export function listQuery(params: MomentListQuery = {}): string {
  const query = new URLSearchParams();
  const tag = (params.tag ?? "").trim();
  if (tag) query.set("tag", tag);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${MOMENTS_PATH}?${suffix}` : MOMENTS_PATH;
}

export function adminListQuery(
  params: { status?: string | null; cursor?: string | null; limit?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${ADMIN_MOMENTS_PATH}?${suffix}` : ADMIN_MOMENTS_PATH;
}

export function momentPath(momentId: string): string {
  return `${MOMENTS_PATH}/${momentId}`;
}

export function adminMomentPath(momentId: string): string {
  return `${ADMIN_MOMENTS_PATH}/${momentId}`;
}
