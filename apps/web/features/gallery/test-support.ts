/**
 * T06 前端的测试替身（相册 / 作品共用）。
 *
 * 只替换 `fetch` 这一层：请求 URL、方法、`If-Match` 头、请求体都保留在记录里，
 * 因此测试断言的是「客户端到底发了什么」，而不是「组件内部调用了某个函数」。
 * **不 mock 共享 API 客户端**：错误信封解析、读重试、写不重试都仍走真实代码。
 *
 * 与 T03 的 `features/ins/test-support.ts` 同形但不共用：那是 T03 的包内文件，
 * 跨包 import 会在对方重构时无声破裂（T04 交付单里的同类教训）。
 */

import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubRoute {
  /** 匹配方式：URL 以它（字符串）包含，或它是正则。 */
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

export function stubFetch(routes: readonly StubRoute[]): FetchStub {
  const requests: RecordedRequest[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    let body: unknown;
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

const MEDIA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEDIA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function variants(mediaId: string, width: number, height: number) {
  return [
    {
      name: "w320.webp",
      width: 320,
      height: Math.round((height / width) * 320),
      bytes: 100,
      url: `/api/v1/media/${mediaId}/w320.webp`,
    },
    {
      name: "w640.webp",
      width: 640,
      height: Math.round((height / width) * 640),
      bytes: 200,
      url: `/api/v1/media/${mediaId}/w640.webp`,
    },
    {
      name: "w1280.webp",
      width: 1280,
      height: Math.round((height / width) * 1280),
      bytes: 400,
      url: `/api/v1/media/${mediaId}/w1280.webp`,
    },
  ];
}

/** 与后端 `PhotoOut` 同形的固定样例（800×600，横构图）。 */
export function makeApiPhoto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const mediaId = (overrides.media_id as string) ?? MEDIA_A;
  const width = (overrides.width as number) ?? 800;
  const height = (overrides.height as number) ?? 600;
  return {
    media_id: mediaId,
    position: 0,
    alt: "东京街头的一角",
    caption: "雨后的路口",
    taken_on: "2026-10-16",
    width,
    height,
    variants: variants(mediaId, width, height),
    ...overrides,
  };
}

/** 与后端 `WallAlbumOut` 同形。 */
export function makeApiWallAlbum(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const slug = (overrides.slug as string) ?? "tokyo-2026";
  const kind = (overrides.kind as string) ?? "photo";
  return {
    id: `11111111-1111-4111-8111-${slug}`.slice(0, 36),
    slug,
    title: "东京 2026",
    kind,
    kind_label: kind === "screenshot" ? "游戏截图" : "摄影",
    position: 0,
    ...overrides,
  };
}

/** 照片墙上的一项。`photo` / `album` 会与默认值**深合并**（测试常只覆盖一两个字段）。 */
export function makeApiWallPhoto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { photo, album, ...rest } = overrides;
  return {
    photo: makeApiPhoto((photo as Record<string, unknown> | undefined) ?? {}),
    album: makeApiWallAlbum((album as Record<string, unknown> | undefined) ?? {}),
    ...rest,
  };
}

export function makeApiAlbum(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const photos = (overrides.photos as unknown[]) ?? [makeApiPhoto()];
  return {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "tokyo-2026",
    title: "东京 2026",
    description: "一次旅行",
    kind: "photo",
    kind_label: "摄影",
    photo_count: photos.length,
    published_at: "2026-10-16T04:00:00Z",
    cover: photos[0] ?? null,
    ...overrides,
    photos,
  };
}

export const MEDIA_IDS = { A: MEDIA_A, B: MEDIA_B };

/** 等待微任务队列推进若干次（配合 render + act 使用）。 */
export async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

export { vi };
