/**
 * 作品的 URL 构造（浏览器端与服务端共用，`features/showcase`）。
 *
 * 路由映射（第三轮任务书 §4.1 起；07 §7 的旧表已被覆盖）：
 *
 * | 用途 | 路径 |
 * | --- | --- |
 * | 我的殿堂（**只保留作品**，不再有照片页签） | `/showcase` |
 * | 作品详情 | `/showcase/projects/<slug>` |
 * | 生活照片（独立生活图库，不属殿堂） | `/gallery` |
 * | 旧照片墙（兼容重定向到 `/gallery`） | `/showcase/photos` |
 * | 管理：作品 | `/admin/projects`、`/admin/projects/<id>` |
 *
 * 「攻略记录」进入的是 T04 的专题页 `/apps/metanav/palaces/<slug>`（不新建一套专题路由）。
 */

import type { MaintenanceState } from "./types";

/**
 * 相对路径（**不含** `/api/v1` 前缀）。
 *
 * 服务端读取由 `lib/api/server.ts` 自己加前缀；浏览器需要完整路径。
 * 两组都在这里定义，避免某一端拼出 `/api/v1/api/v1/...`。
 */
export const PROJECTS_REL = {
  list: "/projects",
  admin: "/admin/projects",
} as const;

export const PROJECTS_API = {
  list: `/api/v1${PROJECTS_REL.list}`,
  admin: `/api/v1${PROJECTS_REL.admin}`,
} as const;

export const SHOWCASE_PATH = "/showcase";
export const PROJECTS_PATH = "/showcase/projects";
/** 管理页面的地址前缀（页面路由，不是 API）。 */
export const ADMIN_PROJECTS_PAGE = "/admin/projects";

/** T04 的专题页（攻略记录的目的地）。 */
export function palacePath(slug: string): string {
  return `/apps/metanav/palaces/${encodeURIComponent(slug)}`;
}

export function projectPath(slug: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(slug)}`;
}

/** 管理 API 的作品地址（`/api/v1/admin/projects/<id>`）。 */
export function adminProjectPath(projectId: string): string {
  return `${PROJECTS_API.admin}/${projectId}`;
}

/** 管理**页面**的作品地址（`/admin/projects/<id>`）。 */
export function adminProjectPagePath(projectId: string): string {
  return `${ADMIN_PROJECTS_PAGE}/${projectId}`;
}

export interface ProjectListQuery {
  maintenance?: MaintenanceState | null;
  tech?: string | null;
  cursor?: string | null;
  limit?: number;
}

export function projectListQuery(params: ProjectListQuery = {}): string {
  const query = new URLSearchParams();
  if (params.maintenance) query.set("maintenance", params.maintenance);
  if (params.tech) query.set("tech", params.tech);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${PROJECTS_API.list}?${suffix}` : PROJECTS_API.list;
}

/** 作品列表查询串（服务端用；相对路径）。 */
export function projectListRelQuery(params: ProjectListQuery = {}): string {
  const full = projectListQuery(params);
  return full.startsWith(PROJECTS_API.list)
    ? `${PROJECTS_REL.list}${full.slice(PROJECTS_API.list.length)}`
    : full;
}

/** 作品详情（服务端用；相对路径）。 */
export function projectRelPath(slug: string): string {
  return `${PROJECTS_REL.list}/${encodeURIComponent(slug)}`;
}

export function adminProjectListQuery(
  params: { status?: string | null; cursor?: string | null; limit?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${PROJECTS_API.admin}?${suffix}` : PROJECTS_API.admin;
}

/** 作品列表页的筛选地址（供作品页的筛选按钮用）。 */
export function showcaseHref(params: { maintenance?: MaintenanceState | null } = {}): string {
  const query = new URLSearchParams();
  if (params.maintenance) query.set("maintenance", params.maintenance);
  const suffix = query.toString();
  return suffix ? `${SHOWCASE_PATH}?${suffix}` : SHOWCASE_PATH;
}
