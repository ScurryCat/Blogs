/**
 * 服务端 API 读取。
 *
 * 契约（01 §2 / 06 §3）：
 *  - 只有 Next.js 服务端使用 `API_INTERNAL_URL` 访问 API；这个变量**仅服务端可见**。
 *  - 浏览器走同源相对地址 `/api/v1`，因此这里不导出任何会被客户端打包的地址。
 *
 * 本模块刻意不依赖 `server-only` 包：用运行时断言保证被打进客户端时立刻报错，
 * 而不是把内部地址泄漏到浏览器构建物里。
 */

import { ApiClientError, ApiRequestOptions, ApiTransportError, ApiErrorEnvelope, Page } from "./client";

if (typeof window !== "undefined") {
  throw new Error("lib/api/server.ts 只能在服务端使用；浏览器请用 lib/api/client.ts");
}

export interface ServerApiOptions extends Omit<ApiRequestOptions, "retryRead"> {
  /** 覆盖内部地址；测试注入用。 */
  baseUrl?: string;
}

function internalBaseUrl(override?: string): string {
  const url = override ?? process.env.API_INTERNAL_URL;
  if (!url) {
    throw new Error(
      "缺少 API_INTERNAL_URL；服务端读取 API 需要显式配置（不得回退到公开地址或 NEXT_PUBLIC_*）",
    );
  }
  return url.replace(/\/$/, "");
}

function isEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as Record<string, unknown>).error as Record<string, unknown> | undefined;
  return !!error && typeof error.code === "string" && typeof error.message === "string";
}

/**
 * 服务端读取。默认 `no-store`：公开动态数据在首版不做隐式缓存（01 §6）。
 * 失败时抛出与浏览器端同形的错误，便于页面统一处理。
 */
export async function serverApiRequest<T>(path: string, options: ServerApiOptions = {}): Promise<T> {
  const base = internalBaseUrl(options.baseUrl);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.ifMatch !== undefined) headers["If-Match"] = options.ifMatch;

  let response: Response;
  try {
    response = await fetch(`${base}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new ApiTransportError("服务端无法访问 API", error);
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (isEnvelope(payload)) {
      throw new ApiClientError(
        response.status,
        {
          code: payload.error.code,
          message: payload.error.message,
          fields: payload.error.fields ?? {},
        },
        payload.request_id ?? null,
      );
    }
    throw new ApiTransportError(`API 返回了非契约响应（HTTP ${response.status}）`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** 服务端列表读取；形状与浏览器端一致。 */
export function serverApiList<T>(
  path: string,
  params: { cursor?: string; limit?: number } = {},
  options: ServerApiOptions = {},
): Promise<Page<T>> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return serverApiRequest<Page<T>>(suffix ? `${path}?${suffix}` : path, options);
}
