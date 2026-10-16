/**
 * COOP 的同源 API 客户端（05 §6 / §7）。
 *
 * 一律通过 T02 的共享客户端 `lib/api/client.ts` 访问同源 `/api/v1`：
 * 读取（GET）退避重试一次；写操作**不自动重试**（05 §10）；
 * 并发控制用 `If-Match: "<version>"`（缺失 428、过期 412）；
 * CSRF token 由 `GET /auth/session` 下发，放在写请求的 JSON body 字段 `csrf_token`
 * （服务端同样接受 `X-CSRF-Token` 头，见 core/csrf.py）。
 *
 * 头像上传复用 T01 已有的 `POST /api/v1/admin/media`，**不另写一套上传**、
 * 也不绕过媒体授权：它返回的 `id` 就是 `avatar_media_id`。multipart 不能走
 * 共享客户端的 JSON 通道，所以这里用一次原始 `fetch`（仍然同源、仍然带 CSRF）。
 */

import { apiRequest, ApiClientError, type Page } from "@/lib/api/client";

import type {
  FriendLinkAdmin,
  FriendLinkCreateInput,
  FriendLinkDetail,
  FriendLinkPatchInput,
  FriendLinkSummary,
  FriendTag,
} from "./types";

export const COOP_API_PATHS = {
  links: "/coop/links",
  link: (id: string) => `/coop/links/${encodeURIComponent(id)}`,
  tags: "/coop/tags",
  adminLinks: "/admin/friends",
  adminLink: (id: string) => `/admin/friends/${encodeURIComponent(id)}`,
  publish: (id: string) => `/admin/friends/${encodeURIComponent(id)}/publish`,
  unpublish: (id: string) => `/admin/friends/${encodeURIComponent(id)}/unpublish`,
  /** T01 的共享媒体上传端点（头像走同一份权限）。 */
  uploadMedia: "/admin/media",
} as const;

export interface ListParams {
  tag?: string | null;
  cursor?: string | null;
  limit?: number;
}

function listQuery(params: ListParams): string {
  const query = new URLSearchParams();
  if (params.tag) query.set("tag", params.tag);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

// --- 公开 -------------------------------------------------------------------

export function listFriendLinks(
  params: ListParams = {},
  signal?: AbortSignal,
): Promise<Page<FriendLinkSummary>> {
  return apiRequest<Page<FriendLinkSummary>>(`${COOP_API_PATHS.links}${listQuery(params)}`, {
    signal,
  });
}

export function getFriendLink(id: string, signal?: AbortSignal): Promise<FriendLinkDetail> {
  return apiRequest<FriendLinkDetail>(COOP_API_PATHS.link(id), { signal });
}

export function listFriendTags(signal?: AbortSignal): Promise<{ items: FriendTag[] }> {
  return apiRequest<{ items: FriendTag[] }>(COOP_API_PATHS.tags, { signal });
}

// --- 管理 -------------------------------------------------------------------

export function listAdminFriendLinks(signal?: AbortSignal): Promise<Page<FriendLinkAdmin>> {
  return apiRequest<Page<FriendLinkAdmin>>(`${COOP_API_PATHS.adminLinks}?limit=30`, { signal });
}

export function getAdminFriendLink(id: string, signal?: AbortSignal): Promise<FriendLinkAdmin> {
  return apiRequest<FriendLinkAdmin>(COOP_API_PATHS.adminLink(id), { signal });
}

export function createFriendLink(
  input: FriendLinkCreateInput,
  csrfToken: string,
): Promise<FriendLinkAdmin> {
  return apiRequest<FriendLinkAdmin>(COOP_API_PATHS.adminLinks, {
    method: "POST",
    body: { ...input, csrf_token: csrfToken },
  });
}

/** 更新。只提交 patch 里出现的字段；`tags` 传入时完整替换。 */
export function updateFriendLink(
  id: string,
  patch: FriendLinkPatchInput,
  version: number,
  csrfToken: string,
): Promise<FriendLinkAdmin> {
  return apiRequest<FriendLinkAdmin>(COOP_API_PATHS.adminLink(id), {
    method: "PATCH",
    body: { ...patch, csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function publishFriendLink(
  id: string,
  version: number,
  csrfToken: string,
): Promise<FriendLinkAdmin> {
  return apiRequest<FriendLinkAdmin>(COOP_API_PATHS.publish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function unpublishFriendLink(
  id: string,
  version: number,
  csrfToken: string,
): Promise<FriendLinkAdmin> {
  return apiRequest<FriendLinkAdmin>(COOP_API_PATHS.unpublish(id), {
    method: "POST",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export function deleteFriendLink(
  id: string,
  version: number,
  csrfToken: string,
): Promise<void> {
  return apiRequest<void>(COOP_API_PATHS.adminLink(id), {
    method: "DELETE",
    body: { csrf_token: csrfToken },
    ifMatch: `"${version}"`,
  });
}

export interface UploadedMedia {
  id: string;
  width: number;
  height: number;
  mime_type: string;
  status: string;
}

/**
 * 上传头像：走 T01 的共享端点（站主 + CSRF + Origin 由服务端校验）。
 * 这里不接受任意路径、不自己拼存储路径，也不做第二套图片处理。
 */
export async function uploadAvatar(
  file: File,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<UploadedMedia> {
  const body = new FormData();
  body.append("file", file);
  body.append("csrf_token", csrfToken);

  const response = await fetch(`/api/v1${COOP_API_PATHS.uploadMedia}`, {
    method: "POST",
    body,
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const shape = payload as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } } | null;
    throw new ApiClientError(
      response.status,
      {
        code: shape?.error?.code ?? "UNEXPECTED_RESPONSE",
        message: shape?.error?.message ?? `上传失败（HTTP ${response.status}）`,
        fields: shape?.error?.fields ?? {},
      },
      null,
    );
  }
  return (await response.json()) as UploadedMedia;
}
