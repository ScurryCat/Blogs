/**
 * 信息流与详情的行为测试（T03 验收用例 3 / 4 / 6）。
 *
 * 断言的是**用户能看到什么**：状态区分、加载更多、标签重置游标、
 * 预览键盘操作、恶意文本按纯文本展示。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `DetailView` 的「重新读取」用 `router.refresh()` 重跑服务端渲染；
// jsdom 里没有 App Router，因此按仓库既有做法（tests/phone/phone-host.test.tsx）显式替身。
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: refreshMock }),
  usePathname: () => "/apps/ins",
  useSearchParams: () => new URLSearchParams(""),
}));

import { FeedView } from "./feed-view";
import { resetFavoriteStoreForTests } from "./favorites";
import { makeApiMoment, stubFetch, type FetchStub } from "./test-support";
import { stubScrollTo } from "@/tests/helpers/browser";
import { advance, click, key, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;
let scrollStub: { calls: Array<{ top: number }>; restore: () => void } | null = null;

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

function page(items: unknown[], nextCursor: string | null = null) {
  return { items, next_cursor: nextCursor };
}

describe("FeedView", () => {
  it("空结果时显示「没有动态」，不显示错误（03 §4 必备状态）", async () => {
    stub = stubFetch([{ match: "/moments", body: page([]) }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(10);
    expect(view.container.textContent).toContain("还没有公开的图文动态");
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    view.unmount();
  });

  it("标签无结果时显示该标签的专属空态与「看全部动态」入口", async () => {
    stub = stubFetch([{ match: "/moments", body: page([]) }]);
    const view = render(<FeedView tag="校园" initial={[]} initialCursor={null} />);
    await advance(10);
    expect(view.container.textContent).toContain("#校园 下还没有公开的动态");
    const link = [...view.container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "看全部动态",
    );
    expect(link?.getAttribute("href")).toBe("/apps/ins");
    view.unmount();
  });

  it("读取失败显示明确原因与重试按钮，**不是**空列表", async () => {
    stub = stubFetch([{ match: "/moments", status: 503, body: { error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "r" } }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(30);
    const alert = view.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("503");
    expect(view.container.textContent).not.toContain("还没有公开的图文动态");
    click([...view.container.querySelectorAll("button")].find((b) => b.textContent === "重新读取") ?? null);
    await advance(30);
    expect(stub.requests.filter((request) => request.url.includes("/moments")).length).toBeGreaterThan(1);
    view.unmount();
  });

  it("断网（fetch 抛错）与 5xx 是不同的文案，都不是空态", async () => {
    stub = stubFetch([{ match: "/moments", throws: true }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(600);
    expect(view.container.textContent).toContain("连不上服务");
    view.unmount();
  });

  it("「加载更多」按游标追加并按 ID 去重", async () => {
    const first = makeApiMoment();
    const second = makeApiMoment({ id: "22222222-2222-4222-8222-222222222222", text: "第二条" });
    stub = stubFetch([
      { match: "cursor=", body: page([first, second]) },
      { match: "/moments?limit=", body: page([first], "CURSOR-1") },
    ]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(20);
    expect(view.container.querySelectorAll("article.ins-card")).toHaveLength(1);

    click([...view.container.querySelectorAll("button")].find((b) => b.textContent === "加载更多") ?? null);
    await advance(20);
    // 第二页里重复的第一条被去掉，只多出真正的新条目
    expect(view.container.querySelectorAll("article.ins-card")).toHaveLength(2);
    const cursorRequest = stub.requests.find((request) => request.url.includes("cursor="));
    expect(cursorRequest?.url).toContain("cursor=CURSOR-1");
    view.unmount();
  });

  it("没有下一页时显示「已经到底了」，不再给按钮", async () => {
    stub = stubFetch([{ match: "/moments", body: page([makeApiMoment()]) }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(20);
    expect(view.container.textContent).toContain("已经到底了");
    expect(
      [...view.container.querySelectorAll("button")].some((b) => b.textContent === "加载更多"),
    ).toBe(false);
    view.unmount();
  });

  it("服务端首屏失败 + 客户端读取成功：失败提示必须消失（不能同时显示失败和内容）", async () => {
    stub = stubFetch([{ match: "/moments", body: page([makeApiMoment()]) }]);
    const view = render(
      <FeedView
        tag={null}
        initial={[]}
        initialCursor={null}
        initialError="读取动态失败（HTTP 422）：请求参数校验失败"
      />,
    );
    // 首帧：确实是失败态（不是空列表，也不是假成功）。
    // 注意客户端会立刻发起重试，因此首帧可能已经进入 loading —— 两种都是「没有伪装成空列表」。
    const first = view.container.textContent ?? "";
    expect(first.includes("422") || first.includes("正在加载")).toBe(true);
    expect(first).not.toContain("还没有公开的图文动态");
    // 客户端自己重试成功之后：失败提示被清掉，只剩内容
    await advance(30);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.querySelectorAll("article.ins-card")).toHaveLength(1);
    expect(view.container.textContent).not.toContain("422");
    view.unmount();
  });

  it("服务端已给第一页时不再重复请求同一页（避免同一屏两份数据）", async () => {
    stub = stubFetch([{ match: "/moments", body: page([]) }]);
    const view = render(
      <FeedView tag={null} initial={[makeApiMoment() as never]} initialCursor={null} />,
    );
    await advance(20);
    expect(stub.requests.filter((request) => request.url.includes("/moments"))).toHaveLength(0);
    view.unmount();
  });

  it("恶意文本按纯文本展示：不产生元素、不执行脚本（03 §4）", async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>';
    stub = stubFetch([{ match: "/moments", body: page([makeApiMoment({ text: hostile })]) }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(20);
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("article img[src='x']")).toBeNull();
    expect(view.container.textContent).toContain("<script>");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    view.unmount();
  });

  it("图片预览：点缩略图打开、方向键翻页、Escape 关闭且焦点回到触发按钮", async () => {
    const twoImages = makeApiMoment({
      images: [
        {
          media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          position: 0,
          alt: "第一张",
          width: 800,
          height: 600,
          variants: [
            { name: "w640.webp", width: 640, height: 480, bytes: 1, url: "/api/v1/media/a/w640.webp" },
            { name: "w1280.webp", width: 1280, height: 960, bytes: 2, url: "/api/v1/media/a/w1280.webp" },
          ],
        },
        {
          media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          position: 1,
          alt: "第二张",
          width: 800,
          height: 600,
          variants: [
            { name: "w640.webp", width: 640, height: 480, bytes: 1, url: "/api/v1/media/b/w640.webp" },
            { name: "w1280.webp", width: 1280, height: 960, bytes: 2, url: "/api/v1/media/b/w1280.webp" },
          ],
        },
      ],
    });
    stub = stubFetch([{ match: "/moments", body: page([twoImages]) }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(20);

    const firstThumb = view.container.querySelector<HTMLButtonElement>("button.ins-thumb");
    expect(firstThumb).not.toBeNull();
    firstThumb?.focus();
    click(firstThumb);

    const dialog = view.container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toContain("第 1 张，共 2 张");
    // 预览用的是大图变体，不是列表里的 w640
    expect(view.container.querySelector("img.ins-preview-img")?.getAttribute("src")).toContain(
      "w1280.webp",
    );

    // 键盘翻页：左右箭头（不能只有手势）
    key(dialog as Element, "ArrowRight");
    expect(view.container.querySelector(".ins-preview-count")?.textContent).toBe("2 / 2");
    key(dialog as Element, "ArrowLeft");
    expect(view.container.querySelector(".ins-preview-count")?.textContent).toBe("1 / 2");

    // Escape：测试环境没有 OverlayProvider，宿主替身是空操作，
    // 因此这里走的是预览自己的兜底（真实浏览器里由 OverlayManager 处理，
    // 两条路径都会关闭，见 .dsh/t03-smoke/browser-verify.py 的 Escape 检查）。
    // 焦点在预览内的关闭按钮上，事件从它冒泡到 dialog 的 onKeyDown。
    act(() => {
      view.container.querySelector<HTMLButtonElement>(".ins-preview .ins-btn")?.focus();
    });
    key(document.activeElement ?? document, "Escape");
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();

    // 重新打开，用关闭按钮再验一次（两条关闭路径都要能用）
    click(firstThumb);
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    click([...view.container.querySelectorAll("button")].find((b) => b.textContent === "关闭预览") ?? null);
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    // 关闭后焦点回到触发预览的缩略图
    expect(document.activeElement).toBe(firstThumb);
    view.unmount();
  });

  it("预览只渲染一张图时不给翻页按钮（不放假控件）", async () => {
    stub = stubFetch([{ match: "/moments", body: page([makeApiMoment()]) }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(20);
    click(view.container.querySelector<HTMLButtonElement>("button.ins-thumb"));
    expect(view.container.querySelector('button[aria-label="上一张图片"]')).toBeNull();
    expect(view.container.querySelector('button[aria-label="下一张图片"]')).toBeNull();
    view.unmount();
  });

  it("收藏按钮写本机存储，并在按钮上体现状态", async () => {
    stub = stubFetch([{ match: "/moments", body: page([makeApiMoment()]) }]);
    const view = render(<FeedView tag={null} initial={[]} initialCursor={null} />);
    await advance(20);
    const favorite = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "收藏",
    );
    click(favorite ?? null);
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.localStorage.getItem("ins.favorites.v1")).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
    const pressed = [...view.container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    expect(pressed?.textContent).toBe("已收藏");
    view.unmount();
  });
});
