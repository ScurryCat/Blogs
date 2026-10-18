/**
 * 共享图片选择器的 API 访问（P5 第一批 · C3）。
 *
 * 契约（C0 集成契约 §3.4 / §4.3 / §9.2）：
 *  - 浏览：`GET /api/v1/admin/media?cursor=&limit=`，cursor 分页，`{items,next_cursor}`；
 *  - 详情：`GET /api/v1/admin/media/{id}`（含 `publicly_referenced` 与尺寸/状态）；
 *  - 上传：`POST /api/v1/admin/media`（multipart，`file` 字段），**写操作必须带
 *    `X-CSRF-Token` 请求头**（契约 §9.2：长请求体不能依赖 body 里的 csrf_token）；
 *  - 上传**不自动重试**（共享客户端的写策略）；只有服务端确认 `status==="ready"`
 *    的记录才允许进入草稿，客户端缩略图不算上传成功。
 *
 * 和 `features/ins/api.ts` 里旧的上传函数关系：旧函数保留给旧工作台（不许删除旧页面能力），
 * 新代码（INS 独立编辑页 / 手记编辑页 / 选择器）统一用这里的 `uploadMedia`。
 * 两边都调用同一个后端端点，不另写一套上传协议。
 */

import { ApiClientError, ApiTransportError, apiRequest, type Page } from "@/lib/api/client";

import {
  ADMIN_MEDIA_PATH,
  HEIC_UNSUPPORTED_MESSAGE,
  validateImageFile,
  type MediaAdminOut,
  type MediaPickerMedia,
} from "./types";

/** 媒体列表响应（后端 cursor 分页，与全局 `Page<T>` 同形）。 */
export type MediaAdminPage = Page<MediaPickerMedia>;

export interface ListAdminMediaOptions {
  cursor?: string | null;
  limit?: number;
  /** 可选状态过滤（后端支持时使用；不传就按默认顺序）。 */
  status?: string | null;
}

function listPath(options: ListAdminMediaOptions): string {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.status) query.set("status", options.status);
  const suffix = query.toString();
  return suffix ? `${ADMIN_MEDIA_PATH}?${suffix}` : ADMIN_MEDIA_PATH;
}

/** 分页读取站主媒体（管理授权 + 公开引用提示由服务端带回）。 */
export function listAdminMedia(
  options: ListAdminMediaOptions = {},
  signal?: AbortSignal,
): Promise<MediaAdminPage> {
  return apiRequest<MediaAdminPage>(listPath(options), { signal });
}

/**
 * 读取单张媒体详情。
 *
 * 用途：已选图片不在当前列表页时补取缩略图/尺寸，避免把「不在这一页」误判成「已失效」。
 * 只有 404 才意味着不可用（由调用方判断）。
 */
export function getAdminMedia(mediaId: string, signal?: AbortSignal): Promise<MediaPickerMedia> {
  return apiRequest<MediaPickerMedia>(`${ADMIN_MEDIA_PATH}/${mediaId}`, { signal });
}

/** 本地预检不通过（HEIC / 不支持格式 / 超大小）——没有发出请求，直接给用户原因。 */
export class MediaUploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUploadRejected";
  }
}

export interface UploadMediaOptions {
  signal?: AbortSignal;
  /**
   * 兼容旧后端的表单字段。契约 §9.2 起统一用 `X-CSRF-Token` 头；
   * 这里同时保留表单字段，是为了在 C1/C2 的 CSRF 改造落地前后都能工作，
   * 不依赖 body 字段（头部才是本函数的契约通道）。
   */
  includeFormCsrf?: boolean;
}

/**
 * 上传一张图片；成功只返回服务端确认 `ready` 的记录。
 *
 * - 本地先做格式/大小预检（HEIC 明确提示、不承诺自动转换），不通过时抛
 *   `MediaUploadRejected`，**不发请求**；
 * - HTTP 失败抛 `ApiClientError`（413/415/422 等由 `describeMediaUploadError` 翻译）；
 * - `status !== "ready"` 视作失败（不能把「处理中」当已上传）。
 */
export async function uploadMedia(
  file: File,
  csrfToken: string,
  options: UploadMediaOptions = {},
): Promise<MediaAdminOut> {
  const rejection = validateImageFile(file);
  if (rejection) throw new MediaUploadRejected(rejection);

  const form = new FormData();
  form.append("file", file);
  if (options.includeFormCsrf ?? true) form.append("csrf_token", csrfToken);

  const response = await fetch(ADMIN_MEDIA_PATH, {
    method: "POST",
    body: form,
    // 同源 + 不自动重试 + 不共享缓存，与共享客户端的语义保持一致。
    credentials: "same-origin",
    cache: "no-store",
    // 契约 §9.2：新写请求统一用请求头传 CSRF。
    headers: { "X-CSRF-Token": csrfToken },
    signal: options.signal,
  });

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

  const media = payload as MediaAdminOut | null;
  if (!media || typeof media.id !== "string") {
    throw new ApiClientError(
      response.status,
      { code: "UNEXPECTED_RESPONSE", message: "上传接口返回了非契约响应", fields: {} },
      null,
    );
  }
  if (media.status !== "ready") {
    throw new ApiClientError(
      409,
      {
        code: "MEDIA_NOT_READY",
        message: "图片尚未处理完成，请稍后重试。",
        fields: {},
      },
      null,
    );
  }
  return media;
}

/** 把上传/读取失败翻译成给站主看的中文文案（选择器与调用方共用）。 */
export function describeMediaUploadError(error: unknown): string {
  if (error instanceof MediaUploadRejected) return error.message;
  if (error instanceof ApiTransportError) return "连不上服务，图片没有上传成功；已选图片都还在。";
  if (error instanceof ApiClientError) {
    switch (error.status) {
      case 401:
        return "登录已失效，请刷新页面重新登录后再上传。";
      case 403:
        return "请求来源或 CSRF 校验失败，请刷新页面后重试。";
      case 404:
        return "图片不存在或已被删除。";
      case 409:
        return error.message || "图片还在处理中，请稍后重试。";
      case 413:
        return "图片太大：单张上限 8 MiB。";
      case 415:
        return "图片格式不支持：只接受 JPEG / PNG / WebP；HEIC 需先导出为受支持格式。";
      case 422:
        return "图片解码失败或像素超限，请换一张再试。";
      default:
        return error.message || `上传失败（HTTP ${error.status}）。`;
    }
  }
  return "上传失败，请稍后重试。";
}

/** 兼容别名：读取失败与上传失败用同一套翻译（语义相同，避免调用方各写一套）。 */
export function describeMediaError(error: unknown): string {
  if (error instanceof ApiTransportError) return "连不上服务，请检查网络后重试。";
  return describeMediaUploadError(error);
}

/** HEIC 提示的再导出：调用方需要单独展示格式提示时不必再 import types。 */
export { HEIC_UNSUPPORTED_MESSAGE };

/** 类型守卫：把未知错误收窄成 ApiClientError（调用方需要 status 时用）。 */
export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** 类型守卫：传输层失败（断网/服务不可达）。 */
export function isTransportError(error: unknown): error is ApiTransportError {
  return error instanceof ApiTransportError;
}
