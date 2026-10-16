/**
 * INS 的服务端读取（仅服务端）。
 *
 * 与 `api.ts`（浏览器端）分开的理由是**结构性的**：`lib/api/server.ts` 在浏览器里
 * 会立刻抛错（防止内部地址被打进客户端产物）。因此任何客户端组件只要 import 了
 * `api.ts`，就绝不能让它间接把 server 模块拖进来 —— 之前它们是同一个文件，
 * 结果 `FeedView`（客户端）在 jsdom / 浏览器里直接崩掉。
 *
 * 现在：客户端 → `api.ts`；服务端组件 → `server-api.ts`。两边共用 `paths.ts` 里的
 * 路径与查询串构造，避免出现两套 URL。
 */

import { ApiClientError } from "@/lib/api/client";
import { serverApiRequest } from "@/lib/api/server";

import { listQuery, type MomentListQuery } from "./paths";
import type { Moment } from "./types";

if (typeof window !== "undefined") {
  throw new Error("features/ins/server-api.ts 只能在服务端使用；浏览器请用 features/ins/api.ts");
}

export function fetchMomentsOnServer(
  params: MomentListQuery = {},
  options: { baseUrl?: string } = {},
): Promise<{ items: Moment[]; next_cursor: string | null }> {
  return serverApiRequest<{ items: Moment[]; next_cursor: string | null }>(
    listQuery(params),
    options,
  );
}

/** 服务端取详情；`null` 表示 API 明确返回 404（页面应给出真正的 404）。 */
export async function fetchMomentOnServer(
  momentId: string,
  options: { baseUrl?: string } = {},
): Promise<Moment | null> {
  try {
    return await serverApiRequest<Moment>(`/moments/${momentId}`, options);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}

/**
 * 服务端读取公开标签列表（`GET /tags`，T01 契约）。
 *
 * 只用于**筛选入口的候选**：`/tags` 返回「有公开文章或公开动态」的标签，
 * 因此文章标签也会出现。是否展示由调用方按动态里的标签名过滤决定 ——
 * 不从文章标签里编造动态筛选结果。
 */
export async function fetchTagsOnServer(
  options: { baseUrl?: string } = {},
): Promise<{ id: string; slug: string; name: string }[]> {
  return serverApiRequest<{ id: string; slug: string; name: string }[]>("/tags", options);
}
