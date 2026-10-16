/**
 * 印象空间的测试替身（T09）。
 *
 * 与 `features/velvet/test-support.ts` 同形但不共用：那是同一批次里另一个功能目录，
 * 跨目录 import 会在对方重构时无声破裂（T04 交付单里的同类教训）。
 * 两处都只替换 `fetch` 这一层：请求 URL、方法、`If-Match` 头、请求体都保留在记录里，
 * 因此测试断言的是「客户端到底发了什么」，而不是「组件内部调用了某个函数」。
 */

import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubRoute {
  match: string | RegExp;
  method?: string;
  status?: number;
  body?: unknown;
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

/** 与后端 `SkillSummaryOut` 同形（印象空间的测试里很少用到，保留以便复用）。 */
export function makeApiSkill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const slug = (overrides.slug as string) ?? "frontend-engineering";
  const domain = (overrides.domain as string) ?? "frontend";
  const labels: Record<string, string> = {
    frontend: "前端工程",
    algorithm: "算法与数据结构",
    backend: "后端与接口",
    other: "其它",
  };
  return {
    id: `11111111-1111-4111-8111-${slug}`.slice(0, 36),
    slug,
    name: "前端工程",
    domain,
    domain_label: labels[domain] ?? domain,
    scope: "能独立完成响应式页面与前端构建配置。",
    evidence: "这个博客的前端与手机宿主，含 320px 适配。",
    position: 0,
    links: [],
    project_count: 0,
    ...overrides,
  };
}

/** 与后端 `SkillProjectRefOut` 同形。 */
export function makeApiProjectRef(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const slug = (overrides.slug as string) ?? "p5-blog";
  return {
    id: `22222222-2222-4222-8222-${slug}`.slice(0, 36),
    slug,
    title: "这个 P5 博客",
    summary: "把静态博客改造成怪盗基地",
    maintenance: "maintained",
    maintenance_label: "持续维护",
    published_at: "2026-10-16T04:00:00Z",
    ...overrides,
  };
}

/** 与后端 `SkillDetailOut` 同形。 */
export function makeApiSkillDetail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const projects = (overrides.projects as unknown[]) ?? [];
  return {
    ...makeApiSkill(),
    projects,
    project_count: projects.length,
    tech_overlap: [],
    ...overrides,
  };
}

/** 与后端 `SkillComboOut` 同形。 */
export function makeApiCombo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const items = (overrides.items as unknown[]) ?? [];
  return {
    a: makeApiSkill({ slug: "frontend", name: "前端工程" }),
    b: makeApiSkill({ slug: "backend", name: "后端与接口", domain: "backend" }),
    items,
    note: items.length === 0 ? "还没有同时用到这两个技能的公开作品。" : "",
    ...overrides,
  };
}

const WORK_LABELS: Record<string, string> = {
  pending: "待探索",
  investigating: "调查中",
  resolved: "已解决",
  archived: "暂搁置",
};

/**
 * 与后端 `RecordSummaryOut` 同形。
 *
 * `work_status_label` / `resolved_at` 由**最终**的 `work_status` 派生，而不是先算再被
 * overrides 覆盖 —— 否则 `makeApiRecordDetail({ work_status: "investigating" })` 会得到
 * 「工作状态是调查中、标签写着待探索」的自相矛盾夹具，用例就会断言到假象。
 */
export function makeApiRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const slug = (overrides.slug as string) ?? "animation-pointer-events";
  const base: Record<string, unknown> = {
    id: `33333333-3333-4333-8333-${slug}`.slice(0, 36),
    slug,
    title: "为什么动画结束后无法点击页面",
    excerpt: "过渡遮罩结束后指针事件没有恢复。",
    work_status: "pending",
    resolved_at: null,
    published_at: "2026-10-16T04:00:00Z",
    post_count: 0,
    project_count: 0,
    ...overrides,
  };
  const workStatus = String(base.work_status);
  const result: Record<string, unknown> = { ...base };
  // 与真实 DTO 一致：标签与解决时间都由 work_status 派生。
  // 已经显式给过标签（例如要构造「标签不一致」的异常响应）时不覆盖。
  if (overrides.work_status_label === undefined) {
    result.work_status_label = WORK_LABELS[workStatus] ?? workStatus;
  }
  if (overrides.resolved_at === undefined) {
    result.resolved_at = workStatus === "resolved" ? "2026-10-16T12:00:00Z" : null;
  }
  return result;
}

/**
 * 与后端 `RecordDetailOut` 同形。
 *
 * 先把 detail 专有字段与 overrides 合并，再交给 `makeApiRecord` 派生依赖字段 ——
 * 这样 `work_status` 的覆盖一定生效到 `work_status_label` 与 `resolved_at`。
 */
export function makeApiRecordDetail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return makeApiRecord({
    background: "过渡遮罩结束后指针事件没有恢复，页面像被冻住。",
    attempts: "检查遮罩卸载时机与事件监听注册顺序，排除了 CSS 的 pointer-events。",
    outcome: "",
    evidence_links: [],
    posts: [],
    projects: [],
    ...overrides,
  });
}

/** 与后端 `RecordStatsOut` 同形。 */
export function makeApiStats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total: 1,
    by_work_status: { pending: 1, investigating: 0, resolved: 0, archived: 0 },
    ...overrides,
  };
}

/** 等待微任务队列推进若干次（配合 render + act 使用）。 */
export async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

export { vi };
