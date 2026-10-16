/**
 * 作品的服务端读取（仅服务端）。
 *
 * 与 `api.ts` 分开的理由与 INS / 相册相同：`lib/api/server.ts` 在浏览器里会立刻抛错
 * （防止内部地址被打进客户端产物），所以客户端组件不能间接 import 到它。
 */

import { ApiClientError } from "@/lib/api/client";
import { serverApiRequest } from "@/lib/api/server";

import { projectListRelQuery, projectRelPath, type ProjectListQuery } from "./paths";
import type { ProjectDetail, ProjectPage } from "./types";

if (typeof window !== "undefined") {
  throw new Error(
    "features/showcase/server-api.ts 只能在服务端使用；浏览器请用 features/showcase/api.ts",
  );
}

export function fetchProjectsOnServer(
  params: ProjectListQuery = {},
  options: { baseUrl?: string } = {},
): Promise<ProjectPage> {
  return serverApiRequest<ProjectPage>(projectListRelQuery(params), options);
}

/** 服务端取作品详情；`null` 表示 API 明确返回 404（页面应给出真正的 404）。 */
export async function fetchProjectOnServer(
  slug: string,
  options: { baseUrl?: string } = {},
): Promise<ProjectDetail | null> {
  try {
    return await serverApiRequest<ProjectDetail>(projectRelPath(slug), options);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}
