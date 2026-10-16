/**
 * 组合入口：INS 资料区的快捷入口与关于页的只读段**读同一份记录**（07 §4、任务卡）。
 *
 * 这份用例的价值在于把「同一记录」变成可执行断言：
 * 两处都打同一个公开端点 `/api/v1/coop/links`，谁都不复制正文、都不做第二份缓存。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { CoopEntry } from "./coop-entry";
import { CoopLinksSection } from "./coop-links-section";
import { linkSummary, stubFetch } from "./test-support";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/about",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("同一记录", () => {
  it("两个入口都请求 /api/v1/coop/links", async () => {
    const entryFetch = stubFetch({ links: [linkSummary({ name: "同一个站点" })] });
    const entry = render(<CoopEntry />);
    await advance(20);
    expect(entryFetch.calls.some((call) => call.url.startsWith("/api/v1/coop/links"))).toBe(true);
    entry.unmount();

    const sectionFetch = stubFetch({ links: [linkSummary({ name: "同一个站点" })] });
    const section = render(<CoopLinksSection />);
    await advance(20);
    expect(sectionFetch.calls.some((call) => call.url.startsWith("/api/v1/coop/links"))).toBe(true);
    section.unmount();
  });

  it("INS 入口给出「我的协助者」链接与真实站名；空列表时退化成诚实说明", async () => {
    stubFetch({ links: [linkSummary({ name: "第一个站点" }), linkSummary({ id: "22222222-2222-2222-2222-222222222222", name: "第二个站点" })] });
    const view = render(<CoopEntry />);
    await advance(20);

    const link = view.container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/apps/coop");
    expect(link?.textContent).toContain("我的协助者");
    expect(view.container.textContent).toContain("第一个站点");
    view.unmount();

    stubFetch({ links: [] });
    const empty = render(<CoopEntry />);
    await advance(20);
    expect(empty.container.textContent).toContain("不是角色联系人");
    empty.unmount();
  });
});

describe("关于页只读段", () => {
  it("渲染真实卡片并说明角色不在名单里，同时给出 COOP 独立页入口", async () => {
    stubFetch({ links: [linkSummary({ name: "真实站点" })] });
    const view = render(<CoopLinksSection />);
    await advance(20);

    const text = view.container.textContent ?? "";
    expect(text).toContain("真实友链");
    expect(text).toContain("真实站点");
    expect(text).toContain("角色消息里的双叶");
    expect(text).toContain("没有 RANK 等级");
    const hrefs = [...view.container.querySelectorAll("a")].map((item) => item.getAttribute("href"));
    expect(hrefs).toContain("/apps/coop");
    view.unmount();
  });

  it("嵌入段的筛选是本地状态，不改动所在页面的 URL", async () => {
    const fetchLog = stubFetch({
      links: [linkSummary()],
      tags: [{ name: "前端", normalized: "前端" }],
    });
    const view = render(<CoopLinksSection />);
    await advance(20);

    const chip = [...view.container.querySelectorAll("button")].find((item) => item.textContent === "前端");
    click(chip ?? null);
    await advance(20);

    expect(fetchLog.calls.some((call) => call.url.includes("tag="))).toBe(true);
    // 嵌入段不碰 URL：没有 pushState / replaceState 调用。
    expect(window.location.search).toBe("");
    view.unmount();
  });
});
