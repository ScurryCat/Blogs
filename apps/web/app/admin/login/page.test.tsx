"use client";

/**
 * 最小登录页的组件测试（不引入额外的测试库：用 react-dom/client + React 的 act）。
 *
 * 断言的是真实交互：挂载时读取会话、空表单不发登录请求、失败保留输入并给出可读错误、
 * 成功进入已登录状态、注销按钮真的发请求。
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminLoginPage from "./page";

// React 19 需要显式声明这是 act 环境，否则每次 act 都会打印告警。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchLike>>;

const SESSION_PRELOGIN = {
  authenticated: false,
  user: null,
  csrf_token: "csrf-1",
  expires_at: "2026-10-16T12:00:00Z",
  prelogin: true,
};

const SESSION_AUTHENTICATED = {
  authenticated: true,
  user: { id: "11111111-1111-1111-1111-111111111111", username: "owner" },
  csrf_token: "csrf-2",
  expires_at: "2026-10-16T20:00:00Z",
  prelogin: false,
};

let container: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorBody(code: string, message: string, status: number): Response {
  return json({ error: { code, message, fields: {} }, request_id: "req-1" }, status);
}

function stubFetch(implementation: FetchLike): FetchMock {
  const mock = vi.fn<FetchLike>(implementation);
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 让已排队的微任务 / 零延时任务跑完，避免状态更新落在 act 之外。 */
async function flush(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function renderPage(): Promise<void> {
  act(() => {
    root.render(<AdminLoginPage />);
  });
  await flush();
}

/** 轮询等待界面进入某个状态（读取失败会先退避重试一次，需要等一小会儿）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error("等待界面状态超时");
}

function setInputValue(id: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  // 受控输入的值变更会触发 React 状态更新，因此同样要包在 act 里。
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(): Promise<void> {
  const form = container.querySelector("form");
  if (!form) throw new Error("页面上没有表单");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

function text(): string {
  return container.textContent ?? "";
}

function requestUrls(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function callInit(fetchMock: FetchMock, suffix: string): RequestInit | undefined {
  const call = fetchMock.mock.calls.find((entry) => String(entry[0]).endsWith(suffix));
  return call?.[1];
}

describe("AdminLoginPage", () => {
  it("挂载时读取会话并渲染带标签的登录表单", async () => {
    const fetchMock = stubFetch(async () => json(SESSION_PRELOGIN));

    await renderPage();

    expect(requestUrls(fetchMock)).toEqual(["/api/v1/auth/session"]);
    expect(container.querySelector('label[for="username"]')?.textContent).toContain("用户名");
    expect(container.querySelector('label[for="password"]')?.textContent).toContain("密码");
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain("登录");
    expect(text()).toContain("没有公开注册");
    // 凭据绝不写本地存储
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("读取会话失败时显示不可用状态与重连按钮", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("network down");
    });

    await renderPage();
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("无法连接");
    const retry = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("重新连接"),
    );
    expect(retry).toBeTruthy();
    // 读取失败会退避重试一次
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("空表单提交只显示校验错误，不发送登录请求", async () => {
    const fetchMock = stubFetch(async () => json(SESSION_PRELOGIN));

    await renderPage();
    await submitForm();

    expect(requestUrls(fetchMock)).toEqual(["/api/v1/auth/session"]);
    expect(text()).toContain("请输入用户名");
    expect(text()).toContain("请输入密码");
  });

  it("登录成功后进入已登录状态并清空密码输入", async () => {
    const fetchMock = stubFetch(async (url) =>
      String(url).endsWith("/auth/login") ? json(SESSION_AUTHENTICATED) : json(SESSION_PRELOGIN),
    );

    await renderPage();
    setInputValue("username", "owner");
    setInputValue("password", "correct-horse-battery");
    await submitForm();

    expect(requestUrls(fetchMock)).toContain("/api/v1/auth/login");
    const init = callInit(fetchMock, "/auth/login");
    expect(JSON.parse(String(init?.body))).toEqual({
      username: "owner",
      password: "correct-horse-battery",
      csrf_token: "csrf-1",
    });

    expect(text()).toContain("已登录");
    expect(text()).toContain("owner");
    expect(container.querySelector("form")).toBeNull();
    expect(text()).toContain("管理外壳");
  });

  it("密码错误时保留表单与输入并显示可读错误", async () => {
    const fetchMock = stubFetch(async (url) =>
      String(url).endsWith("/auth/login")
        ? errorBody("UNAUTHORIZED", "用户名或密码不正确", 401)
        : json(SESSION_PRELOGIN),
    );

    await renderPage();
    setInputValue("username", "owner");
    setInputValue("password", "wrong-password-value");
    await submitForm();

    expect(text()).toContain("用户名或密码不正确");
    expect(container.querySelector("form")).not.toBeNull();
    // 输入保留，方便改正后重试
    expect((document.getElementById("username") as HTMLInputElement).value).toBe("owner");
    // 401 会触发重新取预登录会话，方便直接重试
    expect(requestUrls(fetchMock).filter((url) => url.endsWith("/auth/session")).length).toBe(2);
    expect(text()).toContain("已重新获取登录凭证");
  });

  it("限流时显示过于频繁的提示", async () => {
    const fetchMock = stubFetch(async (url) =>
      String(url).endsWith("/auth/login")
        ? errorBody("RATE_LIMITED", "登录尝试过于频繁，请稍后再试", 429)
        : json(SESSION_PRELOGIN),
    );

    await renderPage();
    setInputValue("username", "owner");
    setInputValue("password", "whatever-password");
    await submitForm();

    expect(text()).toContain("过于频繁");
    // 429 不需要重新取会话（立刻重试也还是会被限流）
    expect(requestUrls(fetchMock).filter((url) => url.endsWith("/auth/session")).length).toBe(1);
  });

  it("已登录状态可以注销，注销会带上轮换后的 CSRF token", async () => {
    let loggedIn = false;
    const fetchMock = stubFetch(async (url) => {
      const target = String(url);
      if (target.endsWith("/auth/login")) {
        loggedIn = true;
        return json(SESSION_AUTHENTICATED);
      }
      if (target.endsWith("/auth/logout")) {
        loggedIn = false;
        return new Response(null, { status: 204 });
      }
      return json(loggedIn ? SESSION_AUTHENTICATED : SESSION_PRELOGIN);
    });

    await renderPage();
    setInputValue("username", "owner");
    setInputValue("password", "correct-horse-battery");
    await submitForm();

    const logoutButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("注销"),
    );
    expect(logoutButton).toBeTruthy();
    await act(async () => {
      logoutButton?.click();
    });
    await flush();

    const init = callInit(fetchMock, "/auth/logout");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ csrf_token: "csrf-2" });
    expect(text()).toContain("已注销");
    expect(container.querySelector("form")).not.toBeNull();
  });
});
