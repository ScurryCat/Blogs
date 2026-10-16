/**
 * 技能全书的服务端读取（仅服务端）。
 *
 * 与 `api.ts` 分开的理由与 T06 的作品页相同：`lib/api/server.ts` 在浏览器里会立刻抛错
 * （防止内部地址被打进客户端产物），所以客户端组件不能间接 import 到它。
 */

import { ApiClientError } from "@/lib/api/client";
import { serverApiRequest } from "@/lib/api/server";

import { skillListRelQuery, skillRelPath, type SkillListQuery } from "./paths";
import type { SkillDetail, SkillPage } from "./types";

if (typeof window !== "undefined") {
  throw new Error(
    "features/velvet/server-api.ts 只能在服务端使用；浏览器请用 features/velvet/api.ts",
  );
}

export function fetchSkillsOnServer(
  params: SkillListQuery = {},
  options: { baseUrl?: string } = {},
): Promise<SkillPage> {
  return serverApiRequest<SkillPage>(skillListRelQuery(params), options);
}

/** 服务端取技能详情；`null` 表示 API 明确返回 404（页面应给出真正的 404）。 */
export async function fetchSkillOnServer(
  slug: string,
  options: { baseUrl?: string } = {},
): Promise<SkillDetail | null> {
  try {
    return await serverApiRequest<SkillDetail>(skillRelPath(slug), options);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}
