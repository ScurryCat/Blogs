/**
 * 测试用的 API 替身（T03）。
 *
 * 只替换 `fetch` 这一层：请求 URL、方法、`If-Match` 头、请求体都保留在记录里，
 * 因此测试可以断言「客户端到底发了什么」，而不是断言「组件内部调用了某个函数」。
 * **不 mock 共享 API 客户端**：错误信封解析、读重试、写不重试这些行为仍走真实代码。
 */

import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubRoute {
  /** 匹配方式：URL 以它结尾，或它是正则。 */
  match: string | RegExp;
  method?: string;
  status?: number;
  body?: unknown;
  /** 直接抛错（模拟断网）。 */
  throws?: boolean;
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

/** 安装一个可编排的 fetch 替身。路由按声明顺序匹配，第一条命中即用。 */
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
      return new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: `没有为 ${method} ${url} 配置替身`, fields: {} },
          request_id: "stub",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    if (route.throws) throw new TypeError("Failed to fetch");

    const status = route.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(route.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** 构造一个符合后端 `MomentOut` 的固定样例。 */
export function makeApiMoment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    text: "操场上的下午",
    tags: [{ id: "t1", slug: "campus", name: "校园" }],
    published_at: "2026-10-16T04:00:00Z",
    images: [
      {
        media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        position: 0,
        alt: "操场",
        width: 800,
        height: 600,
        variants: [
          {
            name: "w640.webp",
            width: 640,
            height: 480,
            bytes: 100,
            url: "/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/w640.webp",
          },
          {
            name: "w1280.webp",
            width: 1280,
            height: 960,
            bytes: 200,
            url: "/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/w1280.webp",
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** 等待微任务队列与一次 act 刷新（配合 `render` 使用）。 */
export async function flush(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

export { vi };
