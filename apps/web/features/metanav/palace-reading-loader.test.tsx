/**
 * 独立页的浏览器侧加载器：三种状态各自正确。
 *
 * 回归点（真实浏览器验收抓到过）：`state.failure` 已经是分类结果，
 * 再调用一次 `classifyFailure` 会把「已不再公开」误判成「服务不可用」。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { advance, render, resetDocument } from "@/tests/helpers/render";

import { PalaceReadingLoader } from "./palace-reading-loader";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PalaceReadingLoader", () => {
  it("404 → 「现在不可读」而不是「服务不可用」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "没有", fields: {} }, request_id: "r" }, 404),
      ),
    );
    const view = render(<PalaceReadingLoader slug="gone" />);
    await advance(30);
    const text = view.container.textContent ?? "";
    expect(text).toContain("这座殿堂现在不可读");
    expect(text).not.toContain("导航暂时不可用");
    view.unmount();
  });

  it("服务故障 → 「导航暂时不可用」并给重新读取按钮", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async () =>
        jsonResponse(
          { error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "r" },
          503,
        ),
      ),
    );
    const view = render(<PalaceReadingLoader slug="phantom-base" />);
    await advance(30);
    const text = view.container.textContent ?? "";
    expect(text).toContain("导航暂时不可用");
    expect(text).toContain("重新读取");
    view.unmount();
  });

  it("可读时渲染专题内容（真实标题与章节）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url) => {
        if (String(url).includes("/nav/palaces/phantom-base")) {
          return jsonResponse({
            id: "1",
            slug: "phantom-base",
            title: "怪盗据点工程",
            summary: "把博客改造成怪盗的基地",
            keywords: { name: "ScurryCat", location: "个人博客", cognition: "据点" },
            post_count: 1,
            published_at: "2026-10-01T00:00:00Z",
            posts: [
              {
                id: "p1",
                slug: "phantom-blog-launch",
                title: "我把博客改造成了怪盗的基地",
                excerpt: "",
                category: "LOG",
                display_date: "2026-10-13",
                published_at: "2026-10-13T00:00:00Z",
                tags: [],
                cover: null,
              },
            ],
          });
        }
        return jsonResponse({ items: [], next_cursor: null });
      }),
    );
    const view = render(<PalaceReadingLoader slug="phantom-base" />);
    await advance(30);
    expect(view.container.textContent).toContain("怪盗据点工程");
    expect(view.container.textContent).toContain("我把博客改造成了怪盗的基地");
    expect(view.container.textContent).toContain("推荐起点");
    view.unmount();
  });
});
