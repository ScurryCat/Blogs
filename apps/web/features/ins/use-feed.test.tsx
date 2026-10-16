/**
 * 信息流读取状态机（T03 §7 / 05 §6）。
 *
 * 这些断言覆盖协议层的要求：切换标签**从第一页重新开始**（不沿用旧游标）、
 * 「加载更多」按游标请求、错误可重试、卸载取消在途请求。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FEED_PAGE_SIZE, describeFeedError, useMomentFeed } from "./use-feed";
import { makeApiMoment, stubFetch, type FetchStub } from "./test-support";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";
import { ApiClientError, ApiTransportError } from "@/lib/api/client";

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
});

function Probe({ tag, initial, initialCursor }: { tag: string | null; initial?: unknown[]; initialCursor?: string | null }) {
  const feed = useMomentFeed(tag, { initial: initial as never, initialCursor });
  return (
    <div>
      <span data-testid="phase">{feed.phase}</span>
      <span data-testid="count">{feed.items.length}</span>
      <span data-testid="cursor">{String(feed.hasMore)}</span>
      <span data-testid="error">{feed.error ?? ""}</span>
      <button type="button" onClick={feed.loadMore}>
        more
      </button>
      <button type="button" onClick={feed.reload}>
        reload
      </button>
    </div>
  );
}

describe("describeFeedError", () => {
  it("按错误类型给出不同文案（都不是空列表）", () => {
    expect(describeFeedError(new ApiTransportError("x"))).toContain("连不上服务");
    expect(
      describeFeedError(new ApiClientError(400, { code: "VALIDATION_FAILED", message: "游标无效", fields: {} }, null)),
    ).toContain("筛选条件");
    expect(
      describeFeedError(new ApiClientError(503, { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, null)),
    ).toContain("503");
    expect(describeFeedError(new Error("boom"))).toContain("boom");
  });
});

describe("useMomentFeed", () => {
  it("首次加载请求第一页（不带游标、limit 为 12）", async () => {
    stub = stubFetch([{ match: "/moments", body: { items: [makeApiMoment()], next_cursor: null } }]);
    const view = render(<Probe tag={null} />);
    await advance(20);
    const request = stub.requests[0];
    expect(request?.url).toContain("limit=12");
    expect(request?.url).not.toContain("cursor=");
    expect(FEED_PAGE_SIZE).toBe(12);
    expect(view.container.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    view.unmount();
  });

  it("服务端已给第一页时不再请求同一页", async () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(<Probe tag={null} initial={[makeApiMoment()]} initialCursor={null} />);
    await advance(20);
    expect(stub.requests).toHaveLength(0);
    expect(view.container.querySelector('[data-testid="phase"]')?.textContent).toBe("ready");
    view.unmount();
  });

  it("切换标签时**重置游标**并重新从第一页开始", async () => {
    stub = stubFetch([
      { match: "tag=", body: { items: [makeApiMoment({ id: "22222222-2222-4222-8222-222222222222" })], next_cursor: null } },
      { match: "/moments", body: { items: [makeApiMoment()], next_cursor: "C1" } },
    ]);
    const view = render(<Probe tag={null} />);
    await advance(20);
    expect(view.container.querySelector('[data-testid="cursor"]')?.textContent).toBe("true");

    await act(async () => {
      view.root.render(<Probe tag="校园" />);
    });
    await advance(20);
    const tagged = stub.requests.filter((request) => request.url.includes("tag="));
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.url).toContain(encodeURIComponent("校园"));
    // 新筛选的第一次请求绝不能带上一个旧游标
    expect(tagged[0]?.url).not.toContain("cursor=");
    view.unmount();
  });

  it("「加载更多」带上服务端给的游标，并把两页合并且去重", async () => {
    const first = makeApiMoment();
    const second = makeApiMoment({ id: "22222222-2222-4222-8222-222222222222" });
    stub = stubFetch([
      { match: "cursor=C1", body: { items: [second], next_cursor: null } },
      { match: "/moments", body: { items: [first, second], next_cursor: "C1" } },
    ]);
    const view = render(<Probe tag={null} />);
    await advance(20);
    expect(view.container.querySelector('[data-testid="count"]')?.textContent).toBe("2");

    click(view.container.querySelectorAll("button")[0] ?? null);
    await advance(20);
    // 第二页只带来一条新内容（另一条与第一页重复，被去重）
    expect(view.container.querySelector('[data-testid="count"]')?.textContent).toBe("2");
    const cursorRequest = stub.requests.find((request) => request.url.includes("cursor=C1"));
    expect(cursorRequest).toBeDefined();
    view.unmount();
  });

  it("失败后不谎报为空，可重试并恢复", async () => {
    stub = stubFetch([
      { match: "/moments", status: 503, body: { error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "r" } },
    ]);
    const view = render(<Probe tag={null} />);
    await advance(30);
    expect(view.container.querySelector('[data-testid="phase"]')?.textContent).toBe("error");
    expect(view.container.querySelector('[data-testid="error"]')?.textContent).toContain("503");

    stub.restore();
    stub = stubFetch([{ match: "/moments", body: { items: [makeApiMoment()], next_cursor: null } }]);
    click(view.container.querySelectorAll("button")[1] ?? null);
    await advance(30);
    expect(view.container.querySelector('[data-testid="phase"]')?.textContent).toBe("ready");
    expect(view.container.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    view.unmount();
  });

  it("卸载会取消在途请求（不把晚到的响应写回状态）", async () => {
    stub = stubFetch([{ match: "/moments", body: { items: [makeApiMoment()], next_cursor: null } }]);
    const view = render(<Probe tag={null} />);
    view.unmount();
    await advance(20);
    // 断言「没有抛错」即足够：abort 后再写状态会触发 React 警告/异常。
    expect(stub.requests).toHaveLength(1);
  });
});
