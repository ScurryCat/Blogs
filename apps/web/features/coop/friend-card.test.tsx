/**
 * 卡片的渲染规则（验收 2 / 4 / 5）：
 *  - 纯文本简介 / 故事**不注入 HTML**；
 *  - 不安全地址不生成链接；
 *  - 安全外链带新窗口 + noopener noreferrer + 可辨识提示；
 *  - 头像缺失 / 加载失败退回首字，不破坏卡片；
 *  - 没有 RANK、访问量或在线状态。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { click, render, resetDocument } from "@/tests/helpers/render";

import { FriendCard } from "./friend-card";
import { linkSummary } from "./test-support";
import type { CoopDetailState } from "./use-links";

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(
  overrides: Parameters<typeof linkSummary>[0] = {},
  options: { expanded?: boolean; detail?: CoopDetailState } = {},
) {
  const onToggle = vi.fn<(id: string) => void>();
  const onRetryDetail = vi.fn();
  const view = render(
    <FriendCard
      link={linkSummary(overrides)}
      expanded={options.expanded ?? false}
      detail={options.detail ?? { status: "idle" }}
      onToggle={onToggle}
      onRetryDetail={onRetryDetail}
    />,
  );
  return { view, onToggle, onRetryDetail };
}

describe("纯文本，不注入 HTML", () => {
  it("简介里的标签与脚本都按文本渲染", () => {
    const { view } = mount({
      summary: '<script>alert("x")</script> 与 <b>加粗</b> 都只是文字',
    });

    expect(view.container.textContent).toContain('<script>alert("x")</script> 与 <b>加粗</b> 都只是文字');
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("b")).toBeNull();
    view.unmount();
  });

  it("相识故事同样按文本渲染", () => {
    const { view } = mount(
      { has_story: true },
      { expanded: true, detail: { status: "ready", detail: { ...linkSummary({ has_story: true }), story: "<img src=x onerror=alert(1)>" } } },
    );

    expect(view.container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(view.container.querySelector("img[src='x']")).toBeNull();
    view.unmount();
  });
});

describe("外链", () => {
  it("安全地址：新窗口 + noopener noreferrer + 可辨识提示", () => {
    const { view } = mount({ name: "示例站点", url: "https://example.com/blog" });
    const anchor = view.container.querySelector("a");

    expect(anchor?.getAttribute("href")).toBe("https://example.com/blog");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.getAttribute("aria-label")).toContain("外部站点");
    expect(anchor?.textContent).toContain("外部 · 新窗口");
    view.unmount();
  });

  it("javascript: 地址不生成链接，只说明已停止跳转", () => {
    const { view } = mount({ url: "javascript:alert(1)" });

    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.textContent).toContain("地址未通过安全校验");
    view.unmount();
  });

  it("data: 地址同样被拦住", () => {
    const { view } = mount({ url: "data:text/html,<script>alert(1)</script>" });

    expect(view.container.querySelector("a")).toBeNull();
    view.unmount();
  });
});

describe("头像兜底", () => {
  it("没有头像时用站名首字", () => {
    const { view } = mount({ name: "ScurryCat", avatar: null });
    const holder = view.container.querySelector("[data-coop-avatar]");

    expect(holder?.getAttribute("data-coop-avatar")).toBe("fallback");
    expect(holder?.textContent).toBe("S");
    view.unmount();
  });

  it("给了头像就渲染变体 URL；图片加载失败后退回首字", async () => {
    const { view } = mount({
      name: "笔记本",
      avatar: {
        id: "m1",
        width: 800,
        height: 600,
        variants: [{ name: "w320.webp", width: 320, height: 240, bytes: 1, url: "/api/v1/media/m1/w320.webp" }],
      },
    });
    const holder = view.container.querySelector("[data-coop-avatar]");
    expect(holder?.getAttribute("data-coop-avatar")).toBe("image");
    const image = view.container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/api/v1/media/m1/w320.webp");

    await act(async () => {
      image?.dispatchEvent(new Event("error", { bubbles: false }));
    });
    expect(view.container.querySelector("[data-coop-avatar]")?.getAttribute("data-coop-avatar")).toBe("fallback");
    expect(view.container.textContent).toContain("笔");
    view.unmount();
  });
});

describe("详情展开", () => {
  it("没有故事时不显示展开按钮", () => {
    const { view } = mount({ has_story: false });
    expect(view.container.textContent).not.toContain("展开相识故事");
    view.unmount();
  });

  it("点展开把 id 交给调用方；加载中给出状态", () => {
    const { view, onToggle } = mount({ has_story: true, id: "abc" });

    const button = [...view.container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("展开相识故事"),
    );
    click(button ?? null);
    expect(onToggle).toHaveBeenCalledWith("abc");
    view.unmount();
  });

  it("读取失败时给原因与重试，不显示假正文", () => {
    const { view, onRetryDetail } = mount(
      { has_story: true },
      { expanded: true, detail: { status: "failed", message: "读取失败（HTTP 503 · SERVICE_UNAVAILABLE）" } },
    );

    expect(view.container.querySelector("[role='alert']")?.textContent).toContain("503");
    const retry = [...view.container.querySelectorAll("button")].find((item) => item.textContent === "重试");
    click(retry ?? null);
    expect(onRetryDetail).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe("不伪造数据", () => {
  it("卡片里没有 RANK / 好感度 / 访问量 / 在线状态字样", () => {
    const { view } = mount({ arcana: "IX · HERMIT" });
    const text = view.container.textContent ?? "";

    for (const forbidden of ["RANK", "Lv.", "好感", "访问量", "点击", "在线", "最近更新"]) {
      expect(text).not.toContain(forbidden);
    }
    // 阿尔卡那作为装饰文字仍然显示，并说明它不是等级。
    expect(text).toContain("IX · HERMIT");
    expect(view.container.querySelector("[title]")?.getAttribute("title")).toContain("不是等级");
    view.unmount();
  });
});
