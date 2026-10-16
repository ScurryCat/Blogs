// @vitest-environment node
/**
 * 服务端文章读取与 DTO 映射（`lib/api/posts.ts`）。
 *
 * 用真实契约（`contracts/openapi.json` 的 `PostSummaryOut` / `PostDetailOut`）做桩，
 * 断言三件事：
 *  1. 默认（未开启 API 数据源）用迁移基线，**不**发请求；
 *  2. 开启后按契约映射，且读取失败时**降级并如实报告原因**，不伪装成「没有文章」；
 *  3. API 明确 404 时返回 null，页面据此给出真正的 404。
 *
 * 环境是 node：`lib/api/server.ts` 会在浏览器环境直接抛错（防止内部地址泄漏）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coverUrl, readPublishedPost, readPublishedPosts, toPost } from "@/lib/api/posts";

const SUMMARY = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "css-p5-menu",
  title: "用纯 CSS 复刻 P5 的斜切菜单",
  excerpt: "先拆解，再写代码。",
  category: "TECH",
  display_date: "2026-09-28",
  published_at: "2026-09-28T02:00:00Z",
  tags: [{ id: "t1", slug: "frontend", name: "前端" }],
  cover: {
    id: "m1",
    width: 1600,
    height: 900,
    variants: [
      { name: "w640", width: 640, height: 360, bytes: 1000, url: "/api/v1/media/m1/w640" },
      { name: "w1280", width: 1280, height: 720, bytes: 3000, url: "/api/v1/media/m1/w1280" },
    ],
  },
};

const DETAIL = { ...SUMMARY, content_md: "## 标题\n\n正文 **加粗**。" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.API_INTERNAL_URL = "http://api.internal:8100";
  delete process.env.PHANTOM_POSTS_SOURCE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.API_INTERNAL_URL;
  delete process.env.PHANTOM_POSTS_SOURCE;
});

describe("DTO 映射", () => {
  it("优先选 w1280 变体，缺变体时为 null（页面用占位而不是坏图）", () => {
    expect(coverUrl(SUMMARY.cover)).toBe("/api/v1/media/m1/w1280");
    expect(coverUrl({ id: "m", width: 1, height: 1, variants: [] })).toBeNull();
    expect(coverUrl(null)).toBeNull();
    expect(
      coverUrl({
        id: "m",
        width: 1,
        height: 1,
        variants: [{ name: "thumb", width: 1, height: 1, bytes: 1, url: "/x" }],
      }),
    ).toBe("/x");
  });

  it("映射成站点渲染模型：标签取 name、日期取 display_date、阅读时长按正文算", () => {
    const post = toPost(DETAIL);
    expect(post.slug).toBe("css-p5-menu");
    expect(post.tags).toEqual(["前端"]);
    expect(post.date).toBe("2026-09-28");
    expect(post.cover).toBe("/api/v1/media/m1/w1280");
    expect(post.content).toContain("## 标题");
    expect(post.min).toBeGreaterThanOrEqual(1);
  });
});

describe("读取路径", () => {
  it("未开启 API 数据源：使用迁移基线，不发任何请求", async () => {
    const list = await readPublishedPosts();
    expect(list.source).toBe("baseline");
    expect(list.apiEnabled).toBe(false);
    expect(list.items).toHaveLength(8);
    expect(fetchMock).not.toHaveBeenCalled();

    const single = await readPublishedPost("css-p5-menu");
    expect(single.source).toBe("baseline");
    expect(single.post?.title).toContain("斜切菜单");
    expect(single.post?.content.length).toBeGreaterThan(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("开启后按契约读取列表（列表结构 {items, next_cursor}）", async () => {
    process.env.PHANTOM_POSTS_SOURCE = "api";
    fetchMock.mockResolvedValue(jsonResponse({ items: [SUMMARY], next_cursor: null }));
    const list = await readPublishedPosts();
    expect(list.source).toBe("api");
    expect(list.degraded).toBe(false);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.title).toBe("用纯 CSS 复刻 P5 的斜切菜单");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url.startsWith("http://api.internal:8100/api/v1/posts")).toBe(true);
    expect(url).toContain("limit=30");
  });

  it("开启后读取文章详情；API 明确 404 时返回 null（页面据此真 404）", async () => {
    process.env.PHANTOM_POSTS_SOURCE = "api";
    fetchMock.mockResolvedValueOnce(jsonResponse(DETAIL));
    const ok = await readPublishedPost("css-p5-menu");
    expect(ok.source).toBe("api");
    expect(ok.post?.content).toContain("正文");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "NOT_FOUND", message: "Not Found", fields: {} }, request_id: "r1" },
        404,
      ),
    );
    const missing = await readPublishedPost("ghost");
    expect(missing.post).toBeNull();
    expect(missing.degraded).toBe(false);
  });

  it("开启后读取失败：降级到基线并给出原因，不返回空列表", async () => {
    process.env.PHANTOM_POSTS_SOURCE = "api";
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "SERVICE_UNAVAILABLE", message: "down", fields: {} }, request_id: "r2" },
        503,
      ),
    );
    const list = await readPublishedPosts();
    expect(list.source).toBe("baseline");
    expect(list.apiEnabled).toBe(true);
    expect(list.degraded).toBe(true);
    expect(list.items).toHaveLength(8);
    expect(list.detail).toContain("503");
  });

  it("开启但缺少 API_INTERNAL_URL：降级并说明原因（不静默）", async () => {
    process.env.PHANTOM_POSTS_SOURCE = "api";
    delete process.env.API_INTERNAL_URL;
    const list = await readPublishedPosts();
    expect(list.degraded).toBe(true);
    expect(list.detail).toContain("API_INTERNAL_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
