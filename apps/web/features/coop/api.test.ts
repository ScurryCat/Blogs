/**
 * 传输层测试：路径、方法、`If-Match`、CSRF 与头像上传（05 §6 / §7）。
 *
 * 断言的是「请求真的怎么发」，不是组件渲染：写操作不带自动重试、
 * 版本条件走 `If-Match`、CSRF 放在 JSON body（共享客户端还没有 headers 选项）、
 * 头像走 T01 的共享上传端点而不是另写一套。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COOP_API_PATHS,
  createFriendLink,
  deleteFriendLink,
  getFriendLink,
  listAdminFriendLinks,
  listFriendLinks,
  listFriendTags,
  publishFriendLink,
  unpublishFriendLink,
  updateFriendLink,
  uploadAvatar,
} from "./api";
import { jsonResponse } from "./test-support";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("公开读取", () => {
  it("列表走同源 /api/v1/coop/links，不带筛选时不拼查询串", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await listFriendLinks();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.links}`);
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
  });

  it("标签筛选与游标都编码进查询串", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await listFriendLinks({ tag: "前端 笔记", cursor: "abc", limit: 6 });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url, "http://127.0.0.1");
    expect(parsed.pathname).toBe(`/api/v1${COOP_API_PATHS.links}`);
    expect(parsed.searchParams.get("tag")).toBe("前端 笔记");
    expect(parsed.searchParams.get("cursor")).toBe("abc");
    expect(parsed.searchParams.get("limit")).toBe("6");
  });

  it("详情对 id 做 URL 编码", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "x" }));
    vi.stubGlobal("fetch", fetchMock);

    await getFriendLink("a/b");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/coop/links/${encodeURIComponent("a/b")}`);
  });

  it("标签接口读 /coop/tags", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listFriendTags();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.tags}`);
  });
});

describe("管理写入", () => {
  it("新建：POST + 201，CSRF 在 body，不带 If-Match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "f1", version: 1 }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createFriendLink({ name: "站点", url: "https://example.com/" }, "csrf-token");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.adminLinks}`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-Match"]).toBeUndefined();
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.csrf_token).toBe("csrf-token");
    expect(body.name).toBe("站点");
  });

  it("更新：PATCH + If-Match 版本号，只提交 patch 里的字段", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "f1", version: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateFriendLink("f1", { position: 20 }, 2, "csrf-token");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.adminLink("f1")}`);
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"2"');
    expect(JSON.parse(String(init.body))).toEqual({ position: 20, csrf_token: "csrf-token" });
  });

  it("发布 / 撤回 / 删除都带 If-Match，且写操作不自动重试", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValue(jsonResponse({ id: "f1", version: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishFriendLink("f1", 3, "csrf")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteFriendLink("f1", 3, "csrf");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.adminLink("f1")}`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"3"');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ id: "f1", version: 5 }));
    await unpublishFriendLink("f1", 4, "csrf");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("管理列表按 limit=30 读取", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await listAdminFriendLinks();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.adminLinks}?limit=30`);
  });
});

describe("头像上传复用共享媒体端点", () => {
  it("POST /admin/media，multipart + csrf_token 表单字段，同源凭据", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "media-1", status: "ready" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" });
    const media = await uploadAvatar(file, "csrf-token");

    expect(media.id).toBe("media-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${COOP_API_PATHS.uploadMedia}`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const body = init.body as FormData;
    expect(body.get("csrf_token")).toBe("csrf-token");
    expect(body.get("file")).toBeInstanceOf(File);
  });

  it("上传失败抛 ApiClientError 且带服务端 code（不是「上传成功」的假信号）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "UNPROCESSABLE", message: "解码不合法", fields: {} }, request_id: "r" }, 422),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1])], "avatar.png", { type: "image/png" });
    await expect(uploadAvatar(file, "csrf")).rejects.toMatchObject({ status: 422, code: "UNPROCESSABLE" });
  });
});
