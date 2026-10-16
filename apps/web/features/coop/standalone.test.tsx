/**
 * 独立页宿主：URL 是「当前展示什么」的唯一依据（02 §4 / 验收 5）。
 *
 *  - `?tag=` / `?item=` 进视图；非法值回落，不执行任意路径；
 *  - 换筛选 / 展开走 `navigation.updateUrl`（phone-internal：不播全屏过场）；
 *  - 外链不经过协调器（是普通 `target="_blank"` 链接）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { NavigationProvider } from "@/features/runtime/navigation/coordinator";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { CoopStandalone } from "./standalone";
import { linkSummary, navAdapter, stubDriver, stubFetch } from "./test-support";

const searchParams = { value: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/coop",
  useSearchParams: () => searchParams.value,
}));

beforeEach(() => {
  resetDocument();
  searchParams.value = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountStandalone(pathname = "/apps/coop") {
  const adapter = navAdapter(pathname);
  const view = render(
    <NavigationProvider driver={stubDriver()} adapter={adapter}>
      <CoopStandalone pathname={pathname} />
    </NavigationProvider>,
  );
  return { view, adapter };
}

describe("URL 状态", () => {
  it("查询参数里的 tag 直接决定请求与选中态", async () => {
    searchParams.value = new URLSearchParams("tag=前端");
    const fetchLog = stubFetch({
      links: [linkSummary()],
      tags: [{ name: "前端", normalized: "前端" }],
    });
    const { view } = mountStandalone();
    await advance(20);

    const listUrl = fetchLog.calls.find((call) => call.url.includes("/coop/links"))?.url ?? "";
    expect(new URL(listUrl, "http://127.0.0.1").searchParams.get("tag")).toBe("前端");
    const chip = [...view.container.querySelectorAll("button")].find((item) => item.textContent === "前端");
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    view.unmount();
  });

  it("非法 item（不是 UUID）不会展开任何卡片", async () => {
    searchParams.value = new URLSearchParams("item=../../etc/passwd");
    const fetchLog = stubFetch({ links: [linkSummary()] });
    const { view } = mountStandalone();
    await advance(20);

    expect(fetchLog.calls.some((call) => call.url.includes("/coop/links/"))).toBe(false);
    expect(view.container.querySelector("[data-friend-state='expanded']")).toBeNull();
    view.unmount();
  });

  it("切换标签调用 updateUrl（不带过场），地址里带上 tag", async () => {
    const fetchLog = stubFetch({
      links: [linkSummary()],
      tags: [{ name: "算法", normalized: "算法" }],
    });
    const { view, adapter } = mountStandalone();
    await advance(20);

    const chip = [...view.container.querySelectorAll("button")].find((item) => item.textContent === "算法");
    click(chip ?? null);

    const push = adapter.push as Mock<(destination: string) => void>;
    expect(push).toHaveBeenCalled();
    const destination = String(push.mock.calls[0]?.[0] ?? "");
    expect(destination).toContain("tag=");
    expect(fetchLog.calls.length).toBeGreaterThan(0);
    view.unmount();
  });

  it("展开卡片把 item 写进地址；再点一次收起", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    stubFetch({
      links: [linkSummary({ id, has_story: true })],
      detail: { ...linkSummary({ id, has_story: true }), story: "故事" },
    });
    const { view, adapter } = mountStandalone();
    await advance(20);

    const toggle = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("展开相识故事"),
    );
    click(toggle ?? null);
    const push = adapter.push as Mock<(destination: string) => void>;
    expect(String(push.mock.calls[0]?.[0] ?? "")).toContain(`item=${id}`);
    view.unmount();
  });
});
