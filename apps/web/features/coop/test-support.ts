/**
 * COOP 测试的公共替身与夹具（不引入新依赖）。
 *
 * - `stubDriver`：导航协调器需要的效果驱动；测试里全部返回假值，
 *   因此不会真的播动画，也不会碰 canvas / audio；
 * - `jsonResponse` / `fetchMock`：按 URL 分发的 fetch 替身（公开列表、标签、详情、管理端）；
 * - `NAV_ADAPTER`：把 `router.push` 换成一个可断言的 mock。
 */

import { vi } from "vitest";
import type { Mock } from "vitest";

import type { TransitionDriver } from "@/features/runtime/navigation/coordinator";

import type { FriendLinkAdmin, FriendLinkDetail, FriendLinkSummary } from "./types";

export function stubDriver(): TransitionDriver {
  return {
    hasCrowd: () => false,
    crowdReady: () => false,
    playCrowd: () => false,
    stopCrowd: () => undefined,
    crowdWait: () => 0,
    hasJoker: () => false,
    jokerReady: () => false,
    playJoker: () => false,
    stopJoker: () => undefined,
    jokerWait: () => 0,
    playWipe: () => undefined,
    stopWipe: () => undefined,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function linkSummary(overrides: Partial<FriendLinkSummary> = {}): FriendLinkSummary {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "示例站点",
    url: "https://example.com/blog",
    summary: "写前端与算法笔记的个人站点",
    arcana: "IX · HERMIT",
    tags: ["前端"],
    avatar: null,
    has_story: false,
    ...overrides,
  };
}

export function linkDetail(overrides: Partial<FriendLinkDetail> = {}): FriendLinkDetail {
  return { ...linkSummary(), story: null, ...overrides };
}

export function adminLink(overrides: Partial<FriendLinkAdmin> = {}): FriendLinkAdmin {
  return {
    ...linkSummary(),
    story: null,
    avatar_media_id: null,
    tags: [{ name: "前端", normalized: "前端" }],
    position: 0,
    status: "draft",
    published_at: null,
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
    deleted_at: null,
    version: 1,
    ...overrides,
  };
}

export interface FetchPlan {
  links?: unknown[];
  nextCursor?: string | null;
  tags?: { name: string; normalized: string }[];
  detail?: FriendLinkDetail;
  admin?: unknown[];
  /** 强制某个前缀的请求失败。 */
  failPrefix?: string;
}

export interface FetchLog {
  calls: { url: string; init: RequestInit | undefined }[];
  mock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
}

/** 按路径分发的 fetch 替身：公开列表 / 标签 / 详情 / 管理列表 / 管理写入。 */
export function stubFetch(plan: FetchPlan = {}): FetchLog {
  const calls: FetchLog["calls"] = [];
  const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (plan.failPrefix && String(url).startsWith(plan.failPrefix)) {
        return jsonResponse({ error: { code: "SERVICE_UNAVAILABLE", message: "服务不可用", fields: {} }, request_id: "r" }, 503);
      }
      if (String(url).includes("/coop/tags")) {
        return jsonResponse({ items: plan.tags ?? [] });
      }
      if (String(url).includes("/coop/links/")) {
        const id = String(url).split("/").pop();
        const detail = plan.detail ?? linkDetail();
        return jsonResponse({ ...detail, id: id ?? detail.id });
      }
      if (String(url).includes("/coop/links")) {
        return jsonResponse({ items: plan.links ?? [], next_cursor: plan.nextCursor ?? null });
      }
      if (String(url).includes("/admin/friends")) {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
          return jsonResponse({ items: plan.admin ?? [], next_cursor: null });
        }
        return jsonResponse({ ...adminLink(), version: 2 }, method === "POST" ? 201 : 200);
      }
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

export const navAdapter = (pathname = "/apps/coop"): {
  push: Mock<(destination: string, options?: { replace?: boolean }) => void>;
  assign: Mock<(url: string) => void>;
  pathname: string;
} => ({
  push: vi.fn<(destination: string, options?: { replace?: boolean }) => void>(),
  assign: vi.fn<(url: string) => void>(),
  pathname,
});
