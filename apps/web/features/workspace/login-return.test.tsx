/**
 * 登录页的 returnTo 返回（契约 §9.5）与「主动退出登录清空本机恢复副本」（§3.2 / §9.4）。
 *
 * 覆盖：
 *  - `?returnTo=<白名单内路径>` 登录成功后 router.replace(returnTo)；
 *  - 非法 returnTo（协议相对/异源/非白名单）→ 回 /admin；
 *  - 没有 returnTo 参数 → 保持登录页原行为（不跳转，避免破坏既有用例）；
 *  - 主动注销 → `clearAllWorkDraftLocalCopies()` 清空 `pl.workdraft.v1.` 前缀。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { advance, render, resetDocument } from "@/tests/helpers/render";

import AdminLoginPage from "@/app/admin/login/page";
import { LOCAL_COPY_PREFIX } from "@/features/workspace/use-work-draft";
import { resetOwnerSessionCache } from "@/features/workspace/session";
import { jsonResponse, stubFetch, type FetchStub } from "./test-support";

const SESSION_OWNER = {
  authenticated: true,
  user: { id: "owner-1", username: "owner" },
  csrf_token: "csrf-owner",
  expires_at: null,
  prelogin: false,
};

const SESSION_PRELOGIN = {
  authenticated: false,
  user: null,
  csrf_token: "csrf-pre",
  expires_at: null,
  prelogin: true,
};

let stub: FetchStub | null = null;
let rendered: ReturnType<typeof render> | null = null;

beforeEach(() => {
  resetDocument();
  resetOwnerSessionCache();
  routerMock.replace.mockReset();
  window.history.replaceState(null, "", "/admin/login");
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  stub?.restore();
  stub = null;
  resetOwnerSessionCache();
  resetDocument();
});

async function renderLogin(): Promise<HTMLElement> {
  rendered = render(<AdminLoginPage />);
  await advance(120);
  return rendered.container;
}

describe("登录页 returnTo", () => {
  it("合法 returnTo：已登录后 router.replace 回来源页", async () => {
    window.history.replaceState(null, "", "/admin/login?returnTo=%2Fapps%2Fjournal%2Fentry-1");
    stub = stubFetch([{ match: "/auth/session", body: SESSION_OWNER }]);
    const container = await renderLogin();
    await advance(80);

    expect(container.textContent).toContain("正在返回来源页面");
    expect(routerMock.replace).toHaveBeenCalledWith("/apps/journal/entry-1");
  });

  it("非法 returnTo（协议相对地址）：回 /admin", async () => {
    window.history.replaceState(null, "", "/admin/login?returnTo=%2F%2Fevil.example.com");
    stub = stubFetch([{ match: "/auth/session", body: SESSION_OWNER }]);
    await renderLogin();
    await advance(80);

    expect(routerMock.replace).toHaveBeenCalledWith("/admin");
  });

  it("非法 returnTo（白名单之外的管理页/文章页）：回 /admin", async () => {
    window.history.replaceState(null, "", "/admin/login?returnTo=%2Fposts%2Fhello");
    stub = stubFetch([{ match: "/auth/session", body: SESSION_OWNER }]);
    await renderLogin();
    await advance(80);

    expect(routerMock.replace).toHaveBeenCalledWith("/admin");
  });

  it("没有 returnTo 参数：保持原行为（不跳转，显示已登录态）", async () => {
    stub = stubFetch([{ match: "/auth/session", body: SESSION_OWNER }]);
    const container = await renderLogin();
    await advance(80);

    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("已登录");
  });
});

describe("主动退出登录", () => {
  it("注销成功后清空全部本机恢复副本", async () => {
    window.localStorage.setItem(`${LOCAL_COPY_PREFIX}owner-1.moment.new.entry-1`, "{}");
    window.localStorage.setItem(`${LOCAL_COPY_PREFIX}owner-1.journal.entry-2.entry-2`, "{}");
    window.localStorage.setItem("pl.other.keep", "keep");

    stub = stubFetch([
      { match: "/auth/session", body: SESSION_OWNER },
      { match: "/auth/logout", method: "POST", status: 204 },
    ]);
    const container = await renderLogin();

    const logoutButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("注销"),
    );
    expect(logoutButton).toBeTruthy();
    await act(async () => {
      logoutButton?.click();
    });
    await advance(120);

    const remaining = Object.keys(window.localStorage);
    expect(remaining.some((key) => key.startsWith(LOCAL_COPY_PREFIX))).toBe(false);
    expect(window.localStorage.getItem("pl.other.keep")).toBe("keep");
    expect(stub.requests.some((request) => request.url.endsWith("/auth/logout"))).toBe(true);
  });
});
