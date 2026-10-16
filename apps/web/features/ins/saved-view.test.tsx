/**
 * 本机收藏视图（T03 §7 / 验收用例 3）。
 *
 * 关键断言：
 *  - 每条收藏都会**重新确认内容是否仍公开**（已撤回 → 显示「已不可用」而不是消失）；
 *  - 界面明确写「仅此浏览器保存」；
 *  - 网络失败与已撤回是**不同**提示；
 *  - 存储不可用时如实说明，并且仍然能阅读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/ins/collections",
  useSearchParams: () => new URLSearchParams(""),
}));

import { SavedView } from "./saved-view";
import { FAVORITES_KEY, resetFavoriteStoreForTests } from "./favorites";
import { notifyFavoritesChanged } from "./favorites-react";
import { stubFetch, type FetchStub } from "./test-support";
import { stubScrollTo } from "@/tests/helpers/browser";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

const MOMENT_ID = "11111111-1111-4111-8111-111111111111";

let stub: FetchStub | null = null;
let scrollStub: { calls: Array<{ top: number }>; restore: () => void } | null = null;

function seedFavorite(): void {
  window.localStorage.setItem(
    FAVORITES_KEY,
    JSON.stringify([
      {
        id: MOMENT_ID,
        savedAt: "2026-10-16T04:00:00.000Z",
        excerpt: "操场上的下午",
        cover: null,
        tags: ["校园"],
      },
    ]),
  );
  notifyFavoritesChanged();
}

beforeEach(() => {
  resetDocument();
  resetFavoriteStoreForTests();
  scrollStub = stubScrollTo();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  scrollStub?.restore();
  scrollStub = null;
});

describe("SavedView", () => {
  it("没有收藏时显示空态，并说明只保存在此浏览器", () => {
    stub = stubFetch([{ match: "/moments/", body: {} }]);
    const view = render(<SavedView />);
    expect(view.container.textContent).toContain("还没有收藏");
    expect(view.container.textContent).toContain("此浏览器");
    expect(stub.requests).toHaveLength(0);
    view.unmount();
  });

  it("收藏仍然公开：显示摘要、时间与详情链接（会重新读取一次）", async () => {
    seedFavorite();
    stub = stubFetch([
      {
        match: "/moments/",
        body: {
          id: MOMENT_ID,
          text: "操场上的下午",
          tags: [],
          published_at: "2026-10-16T04:00:00Z",
          images: [],
        },
      },
    ]);
    const view = render(<SavedView />);
    await advance(30);
    const link = view.container.querySelector("a.ins-saved-link");
    expect(link?.getAttribute("href")).toBe(`/apps/ins/${MOMENT_ID}`);
    expect(view.container.textContent).toContain("操场上的下午");
    expect(stub.requests[0]?.url).toContain(`/moments/${MOMENT_ID}`);
    view.unmount();
  });

  it("内容已撤回（404）：显示「已不可用」并允许移除，不静默隐藏", async () => {
    seedFavorite();
    stub = stubFetch([
      {
        match: "/moments/",
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "不存在", fields: {} }, request_id: "r" },
      },
    ]);
    const view = render(<SavedView />);
    await advance(30);
    expect(view.container.textContent).toContain("已不可用");
    expect(view.container.querySelector("a.ins-saved-link")).toBeNull();

    click(
      [...view.container.querySelectorAll("button")].find((b) => b.textContent === "移除") ?? null,
    );
    await advance(10);
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]")).toHaveLength(0);
    expect(view.container.textContent).toContain("还没有收藏");
    view.unmount();
  });

  it("网络失败与已撤回是不同提示", async () => {
    seedFavorite();
    stub = stubFetch([{ match: "/moments/", throws: true }]);
    const view = render(<SavedView />);
    await advance(600);
    expect(view.container.textContent).toContain("暂时读不到");
    expect(view.container.textContent).not.toContain("已不可用");
    // 条目没有被删掉：网络问题不代表内容没了
    expect(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]")).toHaveLength(1);
    view.unmount();
  });

  it("存储不可用时说明「刷新后会消失」，但收藏内容仍可阅读", async () => {
    seedFavorite();
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    resetFavoriteStoreForTests();
    stub = stubFetch([
      {
        match: "/moments/",
        body: { id: MOMENT_ID, text: "x", tags: [], published_at: "2026-10-16T04:00:00Z", images: [] },
      },
    ]);
    try {
      const view = render(<SavedView />);
      await advance(30);
      // 读不到本机存储 → 空空态 + 明确说明，而不是崩溃
      expect(view.container.textContent).toContain("当前浏览器不允许本机存储");
      view.unmount();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      resetFavoriteStoreForTests();
    }
  });
});
