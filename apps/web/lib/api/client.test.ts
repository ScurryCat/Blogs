/**
 * 浏览器 API 客户端的行为测试。
 * 重点是**错误契约**与重试语义：读取重试一次、写操作不重试（05 §10）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, ApiTransportError, apiRequest, requestUrl } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, status: number, fields: Record<string, string[]> = {}) {
  return jsonResponse({ error: { code, message: "出错了", fields }, request_id: "req-1" }, status);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiRequest", () => {
  it("成功时返回解析后的 JSON，并显式禁用共享缓存", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/health/live")).resolves.toEqual({ status: "ok" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/health/live");
  });

  it("204 返回 undefined，不尝试解析 JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest("/admin/moments/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("契约错误转成带 code / fields / request_id 的错误对象", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse("VALIDATION_FAILED", 422, { title: ["太长"] })),
    );

    const failure = await apiRequest("/moments").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    const apiError = failure as ApiClientError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe("VALIDATION_FAILED");
    expect(apiError.fields.title).toEqual(["太长"]);
    expect(apiError.requestId).toBe("req-1");
  });

  it("412 与 428 可被调用方直接判定", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("VERSION_CONFLICT", 412)));
    const conflict = (await apiRequest("/moments/1", { method: "PATCH" }).catch((e) => e)) as ApiClientError;
    expect(conflict.isVersionConflict).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("PRECONDITION_REQUIRED", 428)));
    const missing = (await apiRequest("/moments/1", { method: "PATCH" }).catch((e) => e)) as ApiClientError;
    expect(missing.isPreconditionRequired).toBe(true);
  });

  it("非契约响应也报错，绝不伪装成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    );
    const failure = (await apiRequest("/moments").catch((e) => e)) as ApiClientError;
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure.code).toBe("UNEXPECTED_RESPONSE");
    expect(failure.status).toBe(502);
  });

  it("读取失败会退避重试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/moments")).resolves.toEqual({ items: [], next_cursor: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("写操作不自动重试，避免重复提交", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/moments", { method: "POST", body: { text: "hi" } })).rejects.toBeInstanceOf(
      ApiTransportError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("鉴权与版本错误不重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse("UNAUTHORIZED", 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/admin/moments")).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("If-Match 会作为请求头发送", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/admin/moments/1", { method: "PATCH", body: { text: "x" }, ifMatch: '"3"' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"3"');
  });

  it("调用方取消时抛出 AbortError，不当作网络故障重试", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/moments", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("requestUrl 的前缀幂等", () => {
  // 回归：各模块的 paths.ts 同时导出「绝对（服务端用）」与「相对（客户端用）」两套常量，
  // 调用点把绝对的那套传给 apiRequest 会拼出 /api/v1/api/v1/... 并 404。
  // 迷惑性在于服务端渲染的同一页面是好的，只有客户端交互与手机里才暴露。
  it("相对路径照常加上前缀", () => {
    expect(requestUrl("/projects?limit=12")).toBe("/api/v1/projects?limit=12");
  });

  it("已经带前缀的路径不再重复加", () => {
    expect(requestUrl("/api/v1/projects?limit=12")).toBe("/api/v1/projects?limit=12");
    expect(requestUrl("/api/v1/gallery/photos/years")).toBe("/api/v1/gallery/photos/years");
  });

  it("恰好等于前缀时不产生尾斜杠", () => {
    expect(requestUrl("/api/v1")).toBe("/api/v1");
  });

  it("不误伤同前缀开头的其它路径", () => {
    // `/api/v1x` 不是 `/api/v1` 下的路径，不能把 v1x 当后缀切掉。
    expect(requestUrl("/api/v1x")).toBe("/api/v1/api/v1x");
  });

  it("自定义 base（服务端）同样只保留一份前缀", () => {
    expect(requestUrl("/api/v1/projects", "http://api:8000/api/v1")).toBe(
      "http://api:8000/api/v1/projects",
    );
  });
});
