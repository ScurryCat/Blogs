/**
 * 创作台测试用的 API 替身（只服务 `features/workspace/*.test.*`）。
 *
 * 只替换 `fetch` 这一层：请求 URL、方法、`If-Match` / `X-CSRF-Token` 头、请求体都保留在记录里，
 * 因此测试断言的是「客户端到底发了什么」。**不 mock 共享 API 客户端**：错误信封解析、
 * 读重试、写不重试这些行为仍走真实代码（与 `features/ins/test-support.ts` 同一风格）。
 */

import { vi } from "vitest";

import type { CommitResult, PickedImage, WorkDraft } from "./types";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubRoute {
  /** 匹配方式：URL 包含它，或它是正则。 */
  match: string | RegExp;
  method?: string;
  status?: number;
  body?: unknown;
  /** 直接抛错（模拟断网）。 */
  throws?: boolean;
  /** 自定义响应（异步/可控 Promise，用来模拟「请求在途」）。 */
  respond?: (request: RecordedRequest) => Response | Promise<Response>;
}

export interface FetchStub {
  requests: RecordedRequest[];
  restore: () => void;
}

function matches(request: RecordedRequest, route: StubRoute): boolean {
  if (route.method && route.method !== request.method) return false;
  if (typeof route.match === "string") return request.url.includes(route.match);
  return route.match.test(request.url);
}

export function stubFetch(routes: readonly StubRoute[]): FetchStub {
  const requests: RecordedRequest[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const record: RecordedRequest = { url, method, headers, body };
    requests.push(record);

    const route = routes.find((candidate) => matches(record, candidate));
    if (!route) {
      return errorResponse(404, "NOT_FOUND", `没有为 ${method} ${url} 配置替身`);
    }
    if (route.respond) return route.respond(record);
    if (route.throws) throw new TypeError("Failed to fetch");
    return jsonResponse(route.body ?? {}, route.status ?? 200);
  }) as typeof fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  // 204/205 不允许带 body（Response 构造器会直接抛错）
  if (status === 204 || status === 205) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message, fields: {} }, request_id: "stub" }, status);
}

/** 构造一份 `WorkDraftOut`（字段与契约 §3.3 对齐）。 */
export function makeWorkDraft(overrides: Partial<WorkDraft> = {}): WorkDraft {
  return {
    id: "draft-1",
    content_type: "moment",
    target_id: null,
    target_version: null,
    draft_version: 1,
    status: "active",
    summary: "草稿摘要",
    data: { text: "" },
    images: [],
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
    ...overrides,
  };
}

export function makeImage(mediaId: string, alt = ""): PickedImage {
  return { media_id: mediaId, alt, position: 0 };
}

export function makeCommitResult(overrides: Partial<CommitResult> = {}): CommitResult {
  return {
    draft_id: "draft-1",
    content_type: "moment",
    target_id: "moment-1",
    target_version: 1,
    status: "draft",
    visibility: null,
    action: "save",
    idempotent_replay: false,
    ...overrides,
  };
}

/** 让挂起的微任务/网络链推进（配合 `advance()` 使用）。 */
export async function flushPromises(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
  }
}

export function findRequests(stub: FetchStub, method: string, fragment: string): RecordedRequest[] {
  return stub.requests.filter(
    (request) => request.method === method.toUpperCase() && request.url.includes(fragment),
  );
}

export { vi };
