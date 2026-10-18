/**
 * 站主身份探针（契约 §9.1）。
 *
 * 关键行为：
 *  - 匿名只打一次无副作用 `GET /auth/owner-status`，**绝不**调 `/auth/session`
 *    （那条会让每个匿名访客建 10 分钟预登录会话）；
 *  - 确认 authenticated 后才读完整会话拿 CSRF；
 *  - 模块级缓存 + 在途去重；响应形状不对按 failed（只有 owner 才渲染入口）。
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, render, resetDocument } from "@/tests/helpers/render";

import { resetOwnerSessionCache, useOwnerSession } from "./session";
import { jsonResponse, stubFetch, type FetchStub } from "./test-support";

const OWNER_STATUS_ANONYMOUS = { authenticated: false, user: null };
const OWNER_STATUS_OWNER = {
  authenticated: true,
  user: { id: "owner-1", username: "owner" },
};
const SESSION_OWNER = {
  authenticated: true,
  user: { id: "owner-1", username: "owner" },
  csrf_token: "csrf-token-1",
  expires_at: null,
  prelogin: false,
};

function Probe({ id }: { id: string }): ReactNode {
  const { status, session } = useOwnerSession();
  return (
    <output
      data-probe={id}
      data-status={status}
      data-user={session?.user?.username ?? ""}
      data-csrf={session?.csrf_token ?? ""}
    />
  );
}

function readProbe(container: HTMLElement, id: string): { status: string | null; user: string | null; csrf: string | null } {
  const element = container.querySelector(`[data-probe="${id}"]`);
  return {
    status: element?.getAttribute("data-status") ?? null,
    user: element?.getAttribute("data-user") ?? null,
    csrf: element?.getAttribute("data-csrf") ?? null,
  };
}

let stub: FetchStub | null = null;
let rendered: ReturnType<typeof render> | null = null;

beforeEach(() => {
  resetDocument();
  resetOwnerSessionCache();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  stub?.restore();
  stub = null;
  resetOwnerSessionCache();
  resetDocument();
});

describe("useOwnerSession", () => {
  it("匿名：只请求无副作用探针，不建立预登录会话", async () => {
    stub = stubFetch([{ match: "/auth/owner-status", body: OWNER_STATUS_ANONYMOUS }]);
    rendered = render(<Probe id="a" />);
    await advance(80);

    expect(readProbe(rendered.container, "a").status).toBe("anonymous");
    const urls = stub.requests.map((request) => request.url);
    expect(urls).toEqual(["/api/v1/auth/owner-status"]);
    expect(urls.some((url) => url.includes("/auth/session"))).toBe(false);
  });

  it("站主：先探针、后完整会话（拿到 CSRF）", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS_OWNER },
      { match: "/auth/session", body: SESSION_OWNER },
    ]);
    rendered = render(<Probe id="a" />);
    await advance(80);

    const probe = readProbe(rendered.container, "a");
    expect(probe.status).toBe("owner");
    expect(probe.user).toBe("owner");
    expect(probe.csrf).toBe("csrf-token-1");
    expect(stub.requests.map((request) => request.url)).toEqual([
      "/api/v1/auth/owner-status",
      "/api/v1/auth/session",
    ]);
  });

  it("模块级缓存 + 在途去重：多个组件只发一次探针", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS_OWNER },
      { match: "/auth/session", body: SESSION_OWNER },
    ]);
    rendered = render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    );
    await advance(80);
    expect(readProbe(rendered.container, "a").status).toBe("owner");
    expect(readProbe(rendered.container, "b").status).toBe("owner");
    const probeRequests = stub.requests.filter((request) => request.url.includes("/auth/owner-status"));
    expect(probeRequests).toHaveLength(1);

    // 已缓存：重新挂载也不再请求
    rendered.unmount();
    rendered = render(<Probe id="c" />);
    await advance(60);
    expect(readProbe(rendered.container, "c").status).toBe("owner");
    expect(stub.requests.filter((request) => request.url.includes("/auth/owner-status"))).toHaveLength(1);
  });

  it("响应缺 authenticated 字段：按 failed 处理，不渲染入口（也不读会话）", async () => {
    stub = stubFetch([
      // 现有 leblanc/手机测试的 fetch 桩对未知 URL 会返回这种形状
      { match: "/auth/owner-status", body: { items: [], next_cursor: null } },
    ]);
    rendered = render(<Probe id="a" />);
    await advance(80);
    expect(readProbe(rendered.container, "a").status).toBe("failed");
    expect(stub.requests.some((request) => request.url.includes("/auth/session"))).toBe(false);
  });

  it("网络失败：failed（探针只读，允许下次挂载重试）", async () => {
    stub = stubFetch([{ match: "/auth/owner-status", throws: true }]);
    rendered = render(<Probe id="a" />);
    // 读请求失败会退避 200ms 重试一次，然后再变成 failed
    await advance(600);
    expect(readProbe(rendered.container, "a").status).toBe("failed");
  });

  it("会话读取失败（探针成功但 /auth/session 失败）：不伪装成站主", async () => {
    stub = stubFetch([
      { match: "/auth/owner-status", body: OWNER_STATUS_OWNER },
      { match: "/auth/session", respond: () => jsonResponse({ error: { code: "X", message: "boom", fields: {} }, request_id: "r" }, 500) },
    ]);
    rendered = render(<Probe id="a" />);
    await advance(600);
    expect(readProbe(rendered.container, "a").status).toBe("failed");
  });
});
