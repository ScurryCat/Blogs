/**
 * `/posts` 独立文章索引（任务书 §2.2 / §8.1）。
 *
 * 覆盖：搜索、分类（塔罗分类）、列表 / 归档视图切换、`?view=archive` 初始视图、
 * 直接可分享的地址栏、空态、降级提示，以及旧 `/#posts` 落到首页摘要后仍能进入本索引。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { posts } from "@/features/legacy/posts";
import { PostsView } from "@/features/navigation/posts-view";
import { click, render, resetDocument } from "../helpers/render";

/** 给受控 input 赋值并触发 React 的 onChange。 */
function typeInto(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error("typeInto: input is missing");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function expectedRows(needle: string, category: string | null = null): number {
  return posts.filter((post) => {
    if (category && post.category !== category) return false;
    if (!needle) return true;
    return `${post.title} ${post.tags.join(" ")} ${post.content}`.toLowerCase().includes(needle);
  }).length;
}

function chip(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>(".chips button")].find((button) =>
    button.textContent?.includes(label),
  );
  if (!found) throw new Error(`找不到分类按钮：${label}`);
  return found;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/posts");
});

afterEach(() => {
  resetDocument();
  window.history.replaceState(null, "", "/");
});

describe("/posts 文章索引", () => {
  it("标题统一为「情报档案」，列表默认展示全部文章", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    const heading = container.querySelector("h1");
    expect(heading?.textContent).toContain("Intelligence Archive");
    expect(heading?.textContent).toContain("情报档案");
    // 不再使用「宫殿索引 / Palace Index」这个会和作品集混淆的名字。
    expect(container.textContent).not.toContain("Palace Index");
    const rows = container.querySelectorAll(".rows .row");
    expect(rows).toHaveLength(posts.length);
    expect(container.querySelector(".aside")?.textContent).toContain(`${posts.length}`);
    unmount();
  });

  it("每一行都链接到 canonical 文章详情路径", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    for (const [index, post] of posts.entries()) {
      const link = container.querySelectorAll<HTMLAnchorElement>(".rows .row-a")[index];
      expect(link?.getAttribute("href")).toBe(`/posts/${encodeURIComponent(post.slug)}`);
    }
    unmount();
  });

  it("搜索覆盖标题 / 标签 / 正文，并显示命中数", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    const input = container.querySelector<HTMLInputElement>("input#q");
    typeInto(input, "P5");
    const expected = expectedRows("p5");
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(posts.length);
    expect(container.querySelectorAll(".rows .row")).toHaveLength(expected);
    expect(container.querySelector(".aside")?.textContent).toContain(`${expected}`);
    unmount();
  });

  it("搜索没有命中时显示真实空态，不生成占位文章", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    typeInto(container.querySelector<HTMLInputElement>("input#q"), "完全不存在的关键词zzz");
    expect(container.querySelectorAll(".rows .row")).toHaveLength(0);
    const empty = container.querySelector(".empty");
    expect(empty?.textContent).toContain("一个目标都没找到");
    unmount();
  });

  it("按分类筛选（塔罗分类），计数与全部按钮状态正确", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    expect(posts.some((post) => post.category === "TECH")).toBe(true);
    click(chip(container, "TECH"));
    const expected = expectedRows("", "TECH");
    expect(container.querySelectorAll(".rows .row")).toHaveLength(expected);
    expect(chip(container, "TECH").getAttribute("aria-pressed")).toBe("true");
    expect(chip(container, "全部").getAttribute("aria-pressed")).toBe("false");
    // 点回「全部」恢复完整列表。
    click(chip(container, "全部"));
    expect(container.querySelectorAll(".rows .row")).toHaveLength(posts.length);
    unmount();
  });

  it("列表 / 归档视图切换：归档按年份分组，并把 ?view=archive 写回地址栏", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    expect(container.querySelector(".arc")).toBeNull();
    const archiveTab = [...container.querySelectorAll<HTMLButtonElement>(".pv-tab")].find(
      (button) => button.textContent?.includes("归档"),
    );
    click(archiveTab ?? null);
    expect(window.location.search).toBe("?view=archive");
    expect(container.querySelectorAll(".arc-l a")).toHaveLength(posts.length);
    expect(container.querySelector("#year-2026")).toBeTruthy();
    expect(archiveTab?.getAttribute("aria-pressed")).toBe("true");

    const listTab = [...container.querySelectorAll<HTMLButtonElement>(".pv-tab")].find((button) =>
      button.textContent?.includes("列表"),
    );
    click(listTab ?? null);
    expect(window.location.search).toBe("");
    expect(container.querySelectorAll(".rows .row")).toHaveLength(posts.length);
    unmount();
  });

  it("?view=archive 直达时首屏就是归档视图（服务端解析 initialView）", () => {
    const { container, unmount } = render(<PostsView items={posts} initialView="archive" />);
    expect(container.querySelectorAll(".arc-l a")).toHaveLength(posts.length);
    const archiveTab = [...container.querySelectorAll<HTMLButtonElement>(".pv-tab")].find(
      (button) => button.textContent?.includes("归档"),
    );
    expect(archiveTab?.getAttribute("aria-pressed")).toBe("true");
    unmount();
  });

  it("归档视图同样接受搜索与分类筛选", () => {
    const { container, unmount } = render(<PostsView items={posts} initialView="archive" />);
    click(chip(container, "TECH"));
    expect(container.querySelectorAll(".arc-l a")).toHaveLength(expectedRows("", "TECH"));
    unmount();
  });

  it("按 / 聚焦搜索框（沿用旧首页索引的键盘行为）", () => {
    const { container, unmount } = render(<PostsView items={posts} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    });
    expect(document.activeElement).toBe(container.querySelector("input#q"));
    unmount();
  });

  it("数据源降级时如实提示，不伪装成没有文章", () => {
    const { container, unmount } = render(
      <PostsView items={posts} degraded="API 返回 500" />,
    );
    expect(container.querySelector("[role='status']")?.textContent).toContain("数据未更新");
    expect(container.querySelectorAll(".rows .row")).toHaveLength(posts.length);
    unmount();
  });

  it("空数据源显示真实空态", () => {
    const { container, unmount } = render(<PostsView items={[]} />);
    expect(container.querySelector(".empty")?.textContent).toContain("一个目标都没找到");
    unmount();
  });
});
