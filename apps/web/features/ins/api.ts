/**
 * INS 的浏览器端 API 访问（T03）。
 *
 * 边界（SHARED-CONTRACTS §1）：
 *  - 浏览器只用 `lib/api/client.ts`（同源 `/api/v1`、`no-store`、读重试一次、写不重试）；
 *  - **不 import `lib/api/server.ts`**：那个模块在浏览器里会立即抛错（防止内部地址
 *    被打进客户端产物）。服务端读取在 `server-api.ts`，两端共用 `paths.ts` 里的 URL 构造。
 *
 * 写操作（新建 / 更新 / 发布 / 撤回 / 删除）都带 `If-Match`：
 * 缺头 428、版本不符 412。412 时调用方必须**保留未保存输入**，不自动覆盖（05 §7）。
 */

import { ApiClientError, apiRequest, type Page } from "@/lib/api/client";

import {
  ADMIN_MEDIA_PATH,
  adminListQuery,
  adminMomentPath,
  listQuery,
  momentPath,
  type MomentListQuery,
} from "./paths";
import {
  ADMIN_MOMENTS_PATH,
  type MediaAdminUpload,
  type Moment,
  type MomentAdmin,
  type MomentAlbumLink,
  type MomentImageInput,
} from "./types";

/**
 * 管理写请求体（第三轮 §4.3 / N3 契约 §3.2）。
 *
 * `album_links` 语义（服务端为准，前端只在保存时提交**完整选择**）：
 *  - 不传 / `null`：保留原配置，但清理已不属于该动态的图片配置；
 *  - `[]`：清空该动态的全部收录选择；
 *  - 非空数组：以这次完整选择替换配置；媒体必须属于本条动态，否则 409 整单不写入。
 *
 * 编辑器总是把「当前界面上的完整选择」发出去（包括 `[]`），因为它在打开动态时已经从
 * 管理响应拿到了选择；这样不会出现「界面上没有收录、数据库里还留着」的静默偏差。
 */
export interface MomentWritePayload {
  text?: string;
  images?: MomentImageInput[];
  tags?: string[];
  album_links?: MomentAlbumLink[];
}

/**
 * 把 CSRF token 放进请求体。
 *
 * 为什么是 body 而不是 `X-CSRF-Token` 头：共享客户端 `lib/api/client.ts` 目前**没有**
 * `headers` 选项（T01 交付单 §7 第 6 条已记录这个缺口），而服务端**同时接受**两者
 * （`app/core/csrf.py` 的 header → JSON body → 表单字段）。T01 的最小登录页用的也是
 * body 字段，这里保持一致，避免为一个可选通道去改共享客户端。
 *
 * 没有这一步，任何写操作都会 403「CSRF 校验失败」——这一点由浏览器的真实联调抓到，
 * 单测里因为也走了同一条路径，所以下面的断言把它钉住了。
 */
function withCsrf<T extends object>(csrfToken: string, payload: T): T & { csrf_token: string } {
  return { ...payload, csrf_token: csrfToken };
}

// --- 公开读取（浏览器端：加载更多、标签切换、手机视图） --------------------

export function fetchMoments(
  params: MomentListQuery = {},
  signal?: AbortSignal,
): Promise<Page<Moment>> {
  return apiRequest<Page<Moment>>(listQuery(params), { signal });
}

export function fetchMoment(momentId: string, signal?: AbortSignal): Promise<Moment> {
  return apiRequest<Moment>(momentPath(momentId), { signal });
}

// --- 管理读写 -------------------------------------------------------------

export function fetchAdminMoments(
  params: { status?: string | null; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<MomentAdmin>> {
  return apiRequest<Page<MomentAdmin>>(adminListQuery(params), { signal });
}

export function fetchAdminMoment(momentId: string, signal?: AbortSignal): Promise<MomentAdmin> {
  return apiRequest<MomentAdmin>(adminMomentPath(momentId), { signal });
}

export function createMoment(
  csrfToken: string,
  payload: MomentWritePayload,
  signal?: AbortSignal,
): Promise<MomentAdmin> {
  return apiRequest<MomentAdmin>(ADMIN_MOMENTS_PATH, {
    method: "POST",
    body: withCsrf(csrfToken, payload),
    signal,
  });
}

/** 更新。`version` 会被格式化成 `If-Match: "n"`；冲突时抛 412。 */
export function updateMoment(
  csrfToken: string,
  momentId: string,
  version: number,
  payload: MomentWritePayload,
  signal?: AbortSignal,
): Promise<MomentAdmin> {
  return apiRequest<MomentAdmin>(adminMomentPath(momentId), {
    method: "PATCH",
    body: withCsrf(csrfToken, payload),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function publishMoment(
  csrfToken: string,
  momentId: string,
  version: number,
  signal?: AbortSignal,
): Promise<MomentAdmin> {
  return apiRequest<MomentAdmin>(`${adminMomentPath(momentId)}/publish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function unpublishMoment(
  csrfToken: string,
  momentId: string,
  version: number,
  signal?: AbortSignal,
): Promise<MomentAdmin> {
  return apiRequest<MomentAdmin>(`${adminMomentPath(momentId)}/unpublish`, {
    method: "POST",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

export function deleteMoment(
  csrfToken: string,
  momentId: string,
  version: number,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(adminMomentPath(momentId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    ifMatch: `"${version}"`,
    signal,
  });
}

/**
 * 上传一张图片。
 *
 * **走 T01 的共享媒体服务**（`POST /admin/media`），不另写一个上传实现（03 §6）。
 * 上传是写操作，共享客户端不自动重试；这里也**不使用客户端缩略图当成功信号** ——
 * 只有服务端返回 `status: "ready"` 的那张图才允许进入草稿（03 §4 / §9.3）。
 */
export async function uploadMomentImage(
  file: File,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<MediaAdminUpload> {
  const form = new FormData();
  form.append("file", file);
  form.append("csrf_token", csrfToken);
  const response = await fetch(ADMIN_MEDIA_PATH, {
    method: "POST",
    body: form,
    // 同源 + 不自动重试 + 不共享缓存，与共享客户端的语义保持一致。
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  return parseUploadResponse(response);
}

async function parseUploadResponse(response: Response): Promise<MediaAdminUpload> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const envelope = payload as
      | { error?: { code?: string; message?: string; fields?: Record<string, string[]> } }
      | null;
    throw new ApiClientError(
      response.status,
      {
        code: envelope?.error?.code ?? "UNEXPECTED_RESPONSE",
        message: envelope?.error?.message ?? `上传失败（HTTP ${response.status}）`,
        fields: envelope?.error?.fields ?? {},
      },
      null,
    );
  }
  return payload as MediaAdminUpload;
}
