/**
 * 天鹅绒房间的浏览器端 API（T09）。
 *
 * 与 `features/showcase/api.ts` 完全同形：同源 `/api/v1`、读走共享客户端
 * （`no-store` + 重试一次）、写不重试、CSRF 放请求体、写操作带 `If-Match`。
 *
 * 「合体」的三种业务结果**分别**处理（07 §6）：
 *
 * | 情况 | HTTP | 界面 |
 * | --- | --- | --- |
 * | 技能 A / B 不存在或未发布 | 404 | 「技能不存在或未公开」 |
 * | 两个技能相同 | 422 | 「需要两个不同的技能」 |
 * | 交集为空 | 200 + `items: []` | 明确空态，不编造作品 |
 */

import { apiRequest, type Page } from "@/lib/api/client";

import {
  adminSkillListQuery,
  adminSkillPath,
  comboQuery,
  skillListQuery,
  skillPath,
  skillsForProjectPath,
  type SkillListQuery,
} from "./paths";
import type {
  AdminSkill,
  SkillCombo,
  SkillDetail,
  SkillLinkInput,
  SkillPage,
  SkillProjectRelationInput,
  SkillSummary,
} from "./types";

function withCsrf<T extends object>(csrfToken: string, payload: T): T & { csrf_token: string } {
  return { ...payload, csrf_token: csrfToken };
}

// --- 公开读取（浏览器端：加载更多、筛选切换、合体） -------------------------

export function fetchSkills(
  params: SkillListQuery = {},
  signal?: AbortSignal,
): Promise<SkillPage> {
  return apiRequest<SkillPage>(skillListQuery(params), { signal });
}

export function fetchSkill(slug: string, signal?: AbortSignal): Promise<SkillDetail> {
  return apiRequest<SkillDetail>(skillPath(slug), { signal });
}

/** 「合体」：同时关联两个技能的当前公开作品（交集）。 */
export function fetchCombo(a: string, b: string, signal?: AbortSignal): Promise<SkillCombo> {
  return apiRequest<SkillCombo>(comboQuery(a, b), { signal });
}

/** 某件公开作品使用的公开技能（作品详情「使用的技能」，同一个关系来源）。 */
export function fetchSkillsForProject(
  slug: string,
  signal?: AbortSignal,
): Promise<SkillSummary[]> {
  return apiRequest<SkillSummary[]>(skillsForProjectPath(slug), { signal });
}

// --- 管理读取 ---------------------------------------------------------------

export function fetchAdminSkills(
  params: { status?: string | null; domain?: string | null; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AdminSkill>> {
  return apiRequest<Page<AdminSkill>>(adminSkillListQuery(params), { signal });
}

export function fetchAdminSkill(skillId: string, signal?: AbortSignal): Promise<AdminSkill> {
  return apiRequest<AdminSkill>(adminSkillPath(skillId), { signal });
}

// --- 管理写入（不自动重试，05 §10） ----------------------------------------

export interface SkillWriteInput {
  slug?: string;
  name: string;
  domain: string;
  scope: string;
  evidence: string;
  links: SkillLinkInput[];
  position: number;
  projects?: SkillProjectRelationInput[];
}

export function createSkill(
  csrfToken: string,
  payload: SkillWriteInput,
  signal?: AbortSignal,
): Promise<AdminSkill> {
  return apiRequest<AdminSkill>(adminSkillListQuery(), {
    method: "POST",
    body: withCsrf(csrfToken, payload),
    signal,
  });
}

export function updateSkill(
  csrfToken: string,
  skillId: string,
  version: number,
  patch: Partial<SkillWriteInput>,
  signal?: AbortSignal,
): Promise<AdminSkill> {
  return apiRequest<AdminSkill>(adminSkillPath(skillId), {
    method: "PATCH",
    body: withCsrf(csrfToken, patch),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function publishSkill(
  csrfToken: string,
  skillId: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminSkill> {
  return apiRequest<AdminSkill>(`${adminSkillPath(skillId)}/publish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function unpublishSkill(
  csrfToken: string,
  skillId: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminSkill> {
  return apiRequest<AdminSkill>(`${adminSkillPath(skillId)}/unpublish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function deleteSkill(
  csrfToken: string,
  skillId: string,
  version: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(adminSkillPath(skillId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}
