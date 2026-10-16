/**
 * 手记 API 的传输层：路径、方法、`If-Match`、CSRF、错误分类。
 *
 * 断言「请求真的怎么发」：写操作不自动重试（05 §10）、版本条件走 `If-Match`、
 * CSRF 放在 JSON body（共享客户端还没有 headers 选项）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JOURNAL_API,
  createEntry,
  deleteEntry,
  getAdminEntry,
  getCalendar,
  getEntry,
  listAdminEntries,
  listAllEntries,
  listEntries,
  publishEntry,
  setVisibility,
  unpublishEntry,
  updateEntry,
} from "./api";
import type { JournalWriteInput } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WRITE: JournalWriteInput = {
  entry_date: "2026-10-16",
  title: "把追番记录接上了",
  content_md: "今天把放课后接上了。",
  mood: "不错",
  location: "四轩茶屋",
  images: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("公开读取", () => {
  it("列表走同源 /api/v1/journal/entries 且 no-store", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await listEntries({ year: 2026, month: 10 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${JOURNAL_API.entries}?year=2026&month=10`);
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
  });

  it("不传筛选时不带查询串", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    await listEntries();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1${JOURNAL_API.entries}`);
  });

  it("详情对 id 做 URL 编码", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    await getEntry("a/b");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/journal/entries/a%2Fb");
  });

  it("日历只带存在的参数", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ months: [], total_entries: 0, timezone: "Asia/Shanghai", today: "2026-10-16" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const calendar = await getCalendar({ year: 2026 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/journal/calendar?year=2026");
    expect(calendar.timezone).toBe("Asia/Shanghai");
  });

  it("listAllEntries 按游标翻页，读到 null 就停", async () => {
    const pages = [
      { items: [{ id: "1", entry_date: "2026-10-02" }], next_cursor: "c1" },
      { items: [{ id: "2", entry_date: "2026-10-01" }], next_cursor: null },
    ];
    // 显式标注签名：`vi.fn(async () => …)` 会被推断成零参函数，
    // `mock.calls[1][0]` 就取不到 URL（TS 的元组长度检查会直接报错）。
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(pages.shift()));
    vi.stubGlobal("fetch", fetchMock);

    const items = await listAllEntries();
    expect(items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=c1");
  });

  it("读取失败会退避重试一次（GET 的既有约定）", async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await listEntries();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("管理写入", () => {
  it("新建：POST + CSRF 在 body，**不带** If-Match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "e1", version: 1 }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createEntry(WRITE, "csrf-token");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${JOURNAL_API.adminEntries}`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.csrf_token).toBe("csrf-token");
    expect(body.status).toBeUndefined();
    expect(body.visibility).toBeUndefined();
    expect((init.headers as Record<string, string>)["If-Match"]).toBeUndefined();
  });

  it("更新：PATCH + If-Match 带版本号；写操作不自动重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "e1", version: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateEntry("e1", { title: "改过" }, 1, "csrf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/journal/entries/e1");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"1"');
  });

  it("发布 / 撤回 / 删除都带 If-Match", async () => {
    // 每次调用都要一个新的 Response：Response 的 body 只能被读一次，
    // 复用同一个对象会让第二次读取抛「Body has already been read」。
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: "e1", version: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    await publishEntry("e1", 2, "csrf");
    await unpublishEntry("e1", 3, "csrf");
    const calls = fetchMock.mock.calls;
    expect(calls[0]?.[0]).toBe("/api/v1/admin/journal/entries/e1/publish");
    expect(calls[1]?.[0]).toBe("/api/v1/admin/journal/entries/e1/unpublish");
    for (const call of calls) {
      const init = call[1];
      expect(init).toBeDefined();
      expect((init?.headers as Record<string, string>)["If-Match"]).toBeDefined();
    }
  });

  it("切可见性：POST 带 visibility 查询参数与 If-Match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "e1", version: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    await setVisibility("e1", "private", 3, "csrf");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/journal/entries/e1/visibility?visibility=private");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"3"');
  });

  it("删除：DELETE，204 返回 undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteEntry("e1", 5, "csrf")).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"5"');
  });

  it("管理读取走管理路径并带 limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    await listAdminEntries({ status: "draft" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `/api/v1${JOURNAL_API.adminEntries}?status=draft&limit=30`,
    );
  });

  it("412 与 428 是可判定的错误（界面据此保留输入）", async () => {
    const conflict = new Response(
      JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "冲突", fields: {} }, request_id: "r" }),
      { status: 412 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(conflict));
    await expect(getAdminEntry("e1")).rejects.toMatchObject({ status: 412, code: "VERSION_CONFLICT" });
  });
});
