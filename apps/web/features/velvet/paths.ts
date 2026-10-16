/**
 * 天鹅绒房间的 URL 构造（浏览器端与服务端共用，`apps/web/features/velvet`）。
 *
 * 路由映射（07 §6 / 07 §7）：
 *
 * | 用途 | 路径 |
 * | --- | --- |
 * | 技能全书（canonical） | `/velvet` |
 * | 技能详情 | `/velvet/<slug>` |
 * | 管理：技能 | `/admin/skills`、`/admin/skills/<id>` |
 *
 * 「能力对应的作品」进入的是 T06 的作品详情 `/showcase/projects/<slug>` —— 技能页
 * **不复制**一份作品正文，只给跳转（验收 2「同一关系来源」）。
 */

import type { SkillDomain } from "./types";

/**
 * 相对路径（**不含** `/api/v1` 前缀）。
 *
 * 服务端读取由 `lib/api/server.ts` 自己加前缀；浏览器需要完整路径。
 * 两组都在这里定义，避免某一端拼出 `/api/v1/api/v1/...`。
 */
export const SKILLS_REL = {
  list: "/skills",
  admin: "/admin/skills",
} as const;

export const SKILLS_API = {
  list: `/api/v1${SKILLS_REL.list}`,
  combo: `/api/v1${SKILLS_REL.list}/combo`,
  admin: `/api/v1${SKILLS_REL.admin}`,
} as const;

export const VELVET_PATH = "/velvet";
/** 管理页面的地址前缀（页面路由，不是 API）。 */
export const ADMIN_SKILLS_PAGE = "/admin/skills";

export function skillPath(slug: string): string {
  return `${VELVET_PATH}/${encodeURIComponent(slug)}`;
}

/** T06 的作品详情页（能力证据的目的地）。 */
export function projectPath(slug: string): string {
  return `/showcase/projects/${encodeURIComponent(slug)}`;
}

/** 成就一件公开作品使用的技能清单（作品侧读取，同一个关系来源）。 */
export function skillsForProjectPath(slug: string): string {
  return `${SKILLS_API.list}/projects/${encodeURIComponent(slug)}`;
}

/** 管理 API 的技能地址（`/api/v1/admin/skills/<id>`）。 */
export function adminSkillPath(skillId: string): string {
  return `${SKILLS_API.admin}/${encodeURIComponent(skillId)}`;
}

/** 管理**页面**的技能地址（`/admin/skills/<id>`）。 */
export function adminSkillPagePath(skillId: string): string {
  return `${ADMIN_SKILLS_PAGE}/${encodeURIComponent(skillId)}`;
}

export interface SkillListQuery {
  domain?: SkillDomain | null;
  cursor?: string | null;
  limit?: number;
}

export function skillListQuery(params: SkillListQuery = {}): string {
  const query = new URLSearchParams();
  if (params.domain) query.set("domain", params.domain);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${SKILLS_API.list}?${suffix}` : SKILLS_API.list;
}

/** 技能列表查询串（服务端用；相对路径）。 */
export function skillListRelQuery(params: SkillListQuery = {}): string {
  const full = skillListQuery(params);
  return full.startsWith(SKILLS_API.list)
    ? `${SKILLS_REL.list}${full.slice(SKILLS_API.list.length)}`
    : full;
}

/** 技能详情（服务端用；相对路径）。 */
export function skillRelPath(slug: string): string {
  return `${SKILLS_REL.list}/${encodeURIComponent(slug)}`;
}

export function comboQuery(a: string, b: string): string {
  const query = new URLSearchParams({ a, b });
  return `${SKILLS_API.combo}?${query.toString()}`;
}

export function adminSkillListQuery(
  params: { status?: string | null; domain?: string | null; cursor?: string | null; limit?: number } = {},
): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.domain) query.set("domain", params.domain);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `${SKILLS_API.admin}?${suffix}` : SKILLS_API.admin;
}

/** 按领域筛选的页面地址（供技能全书的筛选按钮用）。 */
export function velvetHref(params: { domain?: SkillDomain | null } = {}): string {
  const query = new URLSearchParams();
  if (params.domain) query.set("domain", params.domain);
  const suffix = query.toString();
  return suffix ? `${VELVET_PATH}?${suffix}` : VELVET_PATH;
}
