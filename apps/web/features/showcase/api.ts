/**
 * 作品的浏览器端 API（T06）。
 *
 * 与 `features/gallery/api.ts` 完全同形：同源 `/api/v1`、读走共享客户端（`no-store` +
 * 重试一次）、写不重试、CSRF 放请求体、写操作带 `If-Match`。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import {
  adminProjectListQuery,
  adminProjectPath,
  projectListQuery,
  projectPath,
  type ProjectListQuery,
  PROJECTS_API,
} from "./paths";
import type {
  AdminProject,
  AdminProjectImageInput,
  MaintenanceState,
  ProjectDetail,
  ProjectLinkInput,
  ProjectPage,
} from "./types";

function withCsrf<T extends object>(csrfToken: string, payload: T): T & { csrf_token: string } {
  return { ...payload, csrf_token: csrfToken };
}

// --- 公开读取（浏览器端：加载更多、筛选切换） -------------------------------

export function fetchProjects(
  params: ProjectListQuery = {},
  signal?: AbortSignal,
): Promise<ProjectPage> {
  return apiRequest<ProjectPage>(projectListQuery(params), { signal });
}

export function fetchProject(slug: string, signal?: AbortSignal): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(projectPath(slug), { signal });
}

// --- 管理读取 -------------------------------------------------------------

export function fetchAdminProjects(
  params: { status?: string | null; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<AdminProject>> {
  return apiRequest<Page<AdminProject>>(adminProjectListQuery(params), { signal });
}

export function fetchAdminProject(projectId: string, signal?: AbortSignal): Promise<AdminProject> {
  return apiRequest<AdminProject>(adminProjectPath(projectId), { signal });
}

// --- 管理写入 -------------------------------------------------------------

export interface ProjectWritePayload {
  slug?: string;
  title?: string;
  summary?: string;
  role?: string;
  problem?: string;
  tradeoffs?: string;
  outcomes?: string;
  tech_stack?: string[];
  links?: ProjectLinkInput[];
  maintenance?: MaintenanceState;
  palace_id?: string | null;
  images?: AdminProjectImageInput[];
}

export function createProject(
  payload: ProjectWritePayload & { slug: string; title: string },
  csrfToken: string,
  signal?: AbortSignal,
): Promise<AdminProject> {
  return apiRequest<AdminProject>(PROJECTS_API.admin, {
    method: "POST",
    body: withCsrf(csrfToken, payload),
    signal,
  });
}

export function updateProject(
  projectId: string,
  payload: ProjectWritePayload,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminProject> {
  return apiRequest<AdminProject>(adminProjectPath(projectId), {
    method: "PATCH",
    body: withCsrf(csrfToken, payload),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function publishProject(
  projectId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminProject> {
  return apiRequest<AdminProject>(`${adminProjectPath(projectId)}/publish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function unpublishProject(
  projectId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<AdminProject> {
  return apiRequest<AdminProject>(`${adminProjectPath(projectId)}/unpublish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function deleteProject(
  projectId: string,
  csrfToken: string,
  version: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(adminProjectPath(projectId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}
