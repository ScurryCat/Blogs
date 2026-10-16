/**
 * 导航 API 的传输层测试：路径、方法、body、`If-Match`、CSRF 与错误分类。
 *
 * 断言的是「请求真的怎么发」，不是组件渲染：写操作不带自动重试、
 * 版本条件走 `If-Match`、CSRF 放在 JSON body（共享客户端还没有 headers 选项）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NAV_PATHS,
  createPalace,
  deletePalace,
  getPalace,
  listAdminPalaces,
  publishPalace,
  resolveKeywords,
  searchNav,
  updatePalace,
} from "./api";
import type { PalaceWriteInput } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WRITE: PalaceWriteInput = {
  slug: "phantom-base",
  title: "怪盗据点工程",
  summary: "把博客改造成怪盗的基地",
  keywords: { name: "ScurryCat", location: "个人博客", cognition: "据点" },
  aliases: [{ field: "name", value: "PHANTOM" }],
  post_ids: ["11111111-1111-1111-1111-111111111111"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("公开读取", () => {
  it("专题列表走同源 /api/v1/nav/palaces 且 no-store", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { listPalaces } = await import("./api");
    await listPalaces();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${NAV_PATHS.palaces}`);
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
  });

  it("详情对 slug 做 URL 编码（不让 slug 影响路径结构）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    await getPalace("怪盗/base");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/nav/palaces/${encodeURIComponent("怪盗/base")}`);
  });

  it("认知定位是 POST JSON，不重试（写语义的请求不自动重发）", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValue(jsonResponse({ status: "not_found", matches: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveKeywords({ name: "a", location: "b", cognition: "c" }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${NAV_PATHS.resolve}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "a", location: "b", cognition: "c" });
  });

  it("搜索把参数编码进查询串（kind / tag / cursor / limit）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    await searchNav({ q: "斜切 菜单", kind: "palace", tag: "前端", cursor: "abc", limit: 5 });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url, "http://127.0.0.1");
    expect(parsed.pathname).toBe(`/api/v1${NAV_PATHS.search}`);
    expect(parsed.searchParams.get("q")).toBe("斜切 菜单");
    expect(parsed.searchParams.get("kind")).toBe("palace");
    expect(parsed.searchParams.get("tag")).toBe("前端");
    expect(parsed.searchParams.get("cursor")).toBe("abc");
    expect(parsed.searchParams.get("limit")).toBe("5");
  });
});

describe("管理写入", () => {
  it("新建：POST + 201，CSRF 在 body，不带 If-Match（新对象没有版本）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "p1", version: 1 }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await createPalace(WRITE, "csrf-token");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${NAV_PATHS.adminPalaces}`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-Match"]).toBeUndefined();
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.csrf_token).toBe("csrf-token");
    expect(body.slug).toBe("phantom-base");
    expect(body.post_ids).toEqual(WRITE.post_ids);
  });

  it("更新：PATCH + If-Match 版本号，只提交 patch 里的字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "p1", version: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    await updatePalace("p1", { title: "改名", post_ids: [] }, 2, "csrf-token");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${NAV_PATHS.adminPalace("p1")}`);
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"2"');
    expect(JSON.parse(String(init.body))).toEqual({
      title: "改名",
      post_ids: [],
      csrf_token: "csrf-token",
    });
  });

  it("发布 / 撤回 / 删除都带 If-Match，且写操作不重试", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValue(jsonResponse({ id: "p1", version: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishPalace("p1", 3, "csrf")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deletePalace("p1", 3, "csrf");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${NAV_PATHS.adminPalace("p1")}`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"3"');
  });

  it("管理列表读同源 /api/v1/admin/nav/palaces", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    await listAdminPalaces();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${NAV_PATHS.adminPalaces}?limit=30`);
  });
});
