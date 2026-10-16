/**
 * 登录接口的传输层测试：路径、请求体、重试语义与错误映射。
 *
 * 这些用例断言的是「请求真的怎么发」，而不是组件渲染：
 * 写操作不重试、CSRF 放在 body、同源 Cookie 带上、错误按 code 分类。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { AUTH_PATHS, fetchSession, login, logout } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, status: number, fields: Record<string, string[]> = {}) {
  return jsonResponse({ error: { code, message: "出错了", fields }, request_id: "req-1" }, status);
}

const SESSION_PAYLOAD = {
  authenticated: false,
  user: null,
  csrf_token: "csrf-token-value",
  expires_at: "2026-10-16T12:00:00Z",
  prelogin: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchSession", () => {
  it("读取同源 /api/v1/auth/session 且禁用共享缓存", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SESSION_PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSession()).resolves.toEqual(SESSION_PAYLOAD);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${AUTH_PATHS.session}`);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeUndefined();
  });

  it("读取失败会退避重试一次（读取允许重试）", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse(SESSION_PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSession()).resolves.toEqual(SESSION_PAYLOAD);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("透传 AbortSignal，便于组件卸载时取消读取", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SESSION_PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchSession(controller.signal);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
    expect(init.signal?.aborted).toBe(false);
  });
});

describe("login", () => {
  it("POST 到 /auth/login，CSRF token 放在 body 字段里", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...SESSION_PAYLOAD, authenticated: true, prelogin: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await login({ username: "owner", password: "secret-password-1" }, "csrf-token-value");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${AUTH_PATHS.login}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      username: "owner",
      password: "secret-password-1",
      csrf_token: "csrf-token-value",
    });
  });

  it("认证失败抛出可判定的 ApiClientError（401 UNAUTHORIZED）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("UNAUTHORIZED", 401)));
    await expect(login({ username: "owner", password: "wrong" }, "csrf")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("写操作不自动重试：401 之后仍然只发一次请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse("UNAUTHORIZED", 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(login({ username: "owner", password: "wrong" }, "csrf")).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络故障抛出 ApiTransportError（不与凭据错误混为一谈）", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(login({ username: "owner", password: "x" }, "csrf")).rejects.toBeInstanceOf(
      ApiTransportError,
    );
    // 写操作连网络错误也不重试（05 §10：断网后重复创建比失败更糟）
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 带 Retry-After 时错误里保留服务端文案与状态", async () => {
    const response = jsonResponse(
      { error: { code: "RATE_LIMITED", message: "登录尝试过于频繁，请稍后再试", fields: {} }, request_id: "r" },
      429,
    );
    response.headers.set("Retry-After", "42");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(login({ username: "owner", password: "x" }, "csrf")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      message: "登录尝试过于频繁，请稍后再试",
    });
  });
});

describe("logout", () => {
  it("204 解析为 undefined，且 CSRF token 随 body 发送", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout("csrf-token-value")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1${AUTH_PATHS.logout}`);
    expect(JSON.parse(String(init.body))).toEqual({ csrf_token: "csrf-token-value" });
  });
});
