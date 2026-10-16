/**
 * 浏览器侧 API 客户端。
 *
 * 契约：
 *  - 浏览器只访问**同源相对地址** `/api/v1`，不读环境变量里的 API 地址（01 §2）。
 *  - 错误体形状 `{error: {code, message, fields}, request_id}`（05 §9）。
 *  - 公开动态数据首版显式 `no-store`，不依赖框架的隐式缓存默认值（01 §6）。
 *  - 读取可退避重试一次；写操作与上传**不自动重试**（05 §10）。
 */

export const API_PREFIX = "/api/v1";

export interface ApiErrorShape {
  code: string;
  message: string;
  fields: Record<string, string[]>;
}

export interface ApiErrorEnvelope {
  error: ApiErrorShape;
  request_id: string;
}

/** 列表响应形状（05 §6）：`{items, next_cursor}`；无下一页时 next_cursor 为 null。 */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string[]>;
  readonly requestId: string | null;

  constructor(status: number, shape: ApiErrorShape, requestId: string | null) {
    super(shape.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = shape.code;
    this.fields = shape.fields;
    this.requestId = requestId;
  }

  /** 版本冲突（412）：调用方应保留未保存输入并提示读取新版，**不自动覆盖**。 */
  get isVersionConflict(): boolean {
    return this.status === 412;
  }

  /** 缺少 If-Match（428）。 */
  get isPreconditionRequired(): boolean {
    return this.status === 428;
  }
}

/** 网络层失败（连不上、被中断之外的 IO 错误）与协议错误分开，便于界面给出不同提示。 */
export class ApiTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ApiTransportError";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** 写操作的并发控制：`If-Match` 用版本号，例如 `"3"`。 */
  ifMatch?: string;
  signal?: AbortSignal;
  /** 读取失败时是否退避重试一次。写操作请保持 false。 */
  retryRead?: boolean;
}

const READ_METHODS = new Set(["GET"]);

function isEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const error = candidate.error as Record<string, unknown> | undefined;
  return !!error && typeof error.code === "string" && typeof error.message === "string";
}

async function toApiError(response: Response): Promise<ApiClientError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (isEnvelope(payload)) {
    const fields = (payload.error.fields ?? {}) as Record<string, string[]>;
    return new ApiClientError(
      response.status,
      { code: payload.error.code, message: payload.error.message, fields },
      payload.request_id ?? null,
    );
  }
  // 非契约响应（例如网关直接返回的 502）：仍然抛出可判定的错误，不伪装成功。
  return new ApiClientError(
    response.status,
    { code: "UNEXPECTED_RESPONSE", message: `服务返回了非契约响应（HTTP ${response.status}）`, fields: {} },
    null,
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** 发起一次 API 请求。成功返回解析后的 JSON（204 返回 undefined）。 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
  base: string = API_PREFIX,
): Promise<T> {
  const method = options.method ?? "GET";
  const isRead = READ_METHODS.has(method);
  const attempts = isRead && options.retryRead !== false ? 2 : 1;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.ifMatch !== undefined) headers["If-Match"] = options.ifMatch;

  let lastTransportError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
        // 公开动态数据首版不共享缓存；带指纹的静态资源不走这条路径。
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) throw await toApiError(response);
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastTransportError = error;
      if (attempt < attempts) await delay(200, options.signal);
    }
  }
  throw new ApiTransportError("无法连接到服务，请稍后重试", lastTransportError);
}

export const api = {
  /** 进程存活检查，仅用于诊断，不代表数据可用。 */
  healthLive: () => apiRequest<{ status: string }>("/health/live"),
  list: <T>(path: string, params: { cursor?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.cursor) query.set("cursor", params.cursor);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const suffix = query.toString();
    return apiRequest<Page<T>>(suffix ? `${path}?${suffix}` : path);
  },
};
