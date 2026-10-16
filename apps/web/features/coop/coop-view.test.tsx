/**
 * 主视图的行为：状态分明、筛选真的发请求、空态给的是**已有**的联络方式（验收 4 / 6）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { click, render, resetDocument, advance } from "@/tests/helpers/render";

import { CoopView } from "./coop-view";
import { jsonResponse, linkSummary, stubFetch } from "./test-support";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/coop",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountView(props: Partial<Parameters<typeof CoopView>[0]> = {}) {
  const onSelectTag = vi.fn<(tag: string | null) => void>();
  const onSelectItem = vi.fn<(id: string | null) => void>();
  const view = render(
    <CoopView
      mode="site"
      tag={null}
      item={null}
      onSelectTag={onSelectTag}
      onSelectItem={onSelectItem}
      {...props}
    />,
  );
  return { view, onSelectTag, onSelectItem };
}

describe("三种状态分明", () => {
  it("先给出读取中状态，再渲染真实条目", async () => {
    stubFetch({
      links: [linkSummary({ name: "第一个站点" }), linkSummary({ id: "22222222-2222-2222-2222-222222222222", name: "第二个站点" })],
    });
    const { view } = mountView();

    expect(view.container.querySelector("[data-coop-state='loading']")).not.toBeNull();
    await advance(20);

    const root = view.container.querySelector("[data-coop-state='ready']");
    expect(root?.getAttribute("data-coop-count")).toBe("2");
    expect(view.container.textContent).toContain("第一个站点");
    expect(view.container.textContent).toContain("第二个站点");
    view.unmount();
  });

  it("空列表是诚实的空态，并给出已有联络方式作为申请入口", async () => {
    stubFetch({ links: [] });
    const { view } = mountView();
    await advance(20);

    const empty = view.container.querySelector("[data-coop-empty='true']");
    expect(empty?.textContent).toContain("还没有公开任何友链");
    const hrefs = [...view.container.querySelectorAll("a")].map((item) => item.getAttribute("href"));
    expect(hrefs).toContain("/guestbook");
    expect(hrefs).toContain("/about");
    expect(view.container.textContent).toContain("不会自动发布");
    view.unmount();
  });

  it("读取失败给出原因与重试，不伪装成空列表", async () => {
    stubFetch({ failPrefix: "/api/v1/coop/links" });
    const { view } = mountView();
    await advance(20);

    expect(view.container.querySelector("[data-coop-state='failed']")).not.toBeNull();
    expect(view.container.querySelector("[data-coop-empty]")).toBeNull();
    const alert = view.container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("503");
    view.unmount();
  });
});

describe("标签筛选", () => {
  it("标签来自公开接口，点击把展示名交给调用方", async () => {
    stubFetch({
      links: [linkSummary()],
      tags: [
        { name: "前端", normalized: "前端" },
        { name: "算法", normalized: "算法" },
      ],
    });
    const { view, onSelectTag } = mountView();
    await advance(20);

    const algorithms = [...view.container.querySelectorAll("button")].find(
      (item) => item.textContent === "算法",
    );
    click(algorithms ?? null);
    expect(onSelectTag).toHaveBeenCalledWith("算法");
    view.unmount();
  });

  it("带筛选时请求里带上 tag，并且「全部」按钮可回到无筛选", async () => {
    const fetchLog = stubFetch({ links: [linkSummary()], tags: [{ name: "前端", normalized: "前端" }] });
    const { view, onSelectTag } = mountView({ tag: "前端" });
    await advance(20);

    const listUrl = fetchLog.calls.find((call) => call.url.includes("/coop/links"))?.url ?? "";
    expect(new URL(listUrl, "http://127.0.0.1").searchParams.get("tag")).toBe("前端");

    const all = [...view.container.querySelectorAll("button")].find((item) => item.textContent === "全部");
    click(all ?? null);
    expect(onSelectTag).toHaveBeenCalledWith(null);
    view.unmount();
  });

  it("筛选后没有结果时说明是「这个标签没有」，不是「站主没有友链」", async () => {
    stubFetch({ links: [], tags: [{ name: "生活", normalized: "生活" }] });
    const { view } = mountView({ tag: "生活" });
    await advance(20);

    expect(view.container.textContent).toContain("没有带「生活」标签的已发布友链");
    view.unmount();
  });
});

describe("详情展开与分页", () => {
  it("展开卡片时按 id 读详情（列表本身不含正文）", async () => {
    const fetchLog = stubFetch({
      links: [linkSummary({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", has_story: true })],
      detail: { ...linkSummary({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", has_story: true }), story: "在竞赛群里认识。" },
    });
    const { view } = mountView({ item: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    await advance(30);

    expect(fetchLog.calls.some((call) => call.url.includes("/coop/links/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"))).toBe(true);
    expect(view.container.textContent).toContain("在竞赛群里认识。");
    view.unmount();
  });

  it("有下一页时显示「读取更多」，点击后追加而不是替换", async () => {
    const fetchLog = stubFetch({
      links: [linkSummary({ name: "第一页条目" })],
      nextCursor: "cursor-1",
    });
    const { view } = mountView();
    await advance(20);

    const more = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("读取更多"),
    );
    expect(more).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchLog.calls.push({ url: String(url), init: undefined });
        if (String(url).includes("cursor-1")) {
          return jsonResponse({
            items: [linkSummary({ id: "33333333-3333-3333-3333-333333333333", name: "第二页条目" })],
            next_cursor: null,
          });
        }
        return jsonResponse({ items: [linkSummary({ name: "第一页条目" })], next_cursor: "cursor-1" });
      }),
    );
    click(more ?? null);
    await advance(20);

    expect(view.container.textContent).toContain("第一页条目");
    expect(view.container.textContent).toContain("第二页条目");
    view.unmount();
  });
});

describe("角色与真实友链分开", () => {
  it("标题区明确说明角色消息不是这里的友链", async () => {
    stubFetch({ links: [] });
    const { view } = mountView();
    await advance(20);

    expect(view.container.textContent).toContain("角色消息里的双叶");
    expect(view.container.textContent).toContain("不是这里的友链");
    view.unmount();
  });
});
