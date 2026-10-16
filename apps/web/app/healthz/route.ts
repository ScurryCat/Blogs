/**
 * 前端进程健康检查 `/healthz`。
 *
 * 用途（T02 任务卡 / T10）：给编排与网关一个**不依赖数据库、不依赖 API** 的存活探针。
 * 它只说明「Next.js 进程在响应」，**不冒充就绪**：真实就绪需要检查 API 与数据库，
 * 那属于 T01 / T10（后端 `/api/v1/health/live` 已存在，`ready` 刻意未实现）。
 *
 * 因此这里返回 200 + 一个小 JSON，不做任何下游调用，也不缓存。
 */

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(_request: NextRequest): Response {
  return Response.json(
    {
      status: "ok",
      service: "phantom-log-web",
      scope: "web-liveness",
      note: "仅表示 Next.js 进程存活；不含数据库与 API 就绪判断。",
      checked_at: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}

export function HEAD(): Response {
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
