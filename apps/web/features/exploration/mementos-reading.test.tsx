/**
 * 单条问题记录视图（T09；07 §6、任务卡验收 3）。
 *
 * 关键断言：
 *  - 背景 / 尝试 / 结果三块分开显示；
 *  - 「已解决」但没有结果说明时**明确提示缺项**（不是留一个空标题）；
 *  - 非解决状态的结果小节写「还没有结论」，不假装已经解决；
 *  - 关联内容为空时说明「没有关联的公开文章或作品」并给出分类探索入口
 *    —— **不显示**任何「（已隐藏）」占位（那本身就是泄漏）；
 *  - 验证链接为空时如实说明「有些问题确实没有可以贴出来的证据」；
 *  - 页脚明确这是站主整理、不是公开请求板。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { render, resetDocument } from "@/tests/helpers/render";

import { MementosReading } from "./mementos-reading";
import { makeApiRecordDetail } from "./test-support";
import type { RecordDetail } from "./types";

function detail(overrides: Record<string, unknown> = {}): RecordDetail {
  return makeApiRecordDetail(overrides) as unknown as RecordDetail;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  resetDocument();
});

describe("MementosReading", () => {
  it("背景 / 尝试 / 结果各自成块", () => {
    const { container, unmount } = render(
      <MementosReading
        record={detail({
          background: "过渡遮罩结束后指针事件没有恢复。",
          attempts: "检查了遮罩卸载时机与事件监听注册顺序。",
          outcome: "根因是遮罩卸载晚于指针事件恢复。",
        })}
      />,
    );
    expect(container.querySelector("[data-record-background]")?.textContent).toContain(
      "指针事件没有恢复",
    );
    expect(container.querySelector("[data-record-attempts]")?.textContent).toContain(
      "遮罩卸载时机",
    );
    expect(container.querySelector("[data-record-outcome]")?.textContent).toContain("根因");
    unmount();
  });

  it("已解决但没有结果说明时明确提示缺项", () => {
    const { container, unmount } = render(
      <MementosReading
        record={detail({ work_status: "resolved", resolved_at: "2026-10-16T12:00:00Z", outcome: "" })}
      />,
    );
    const missing = container.querySelector("[data-record-outcome-missing]");
    expect(missing).not.toBeNull();
    expect(missing?.textContent).toContain("标成「已解决」但还没有结果说明");
    expect(container.querySelector("[data-record-outcome]")).toBeNull();
    unmount();
  });

  it("未解决时结果小节写「还没有结论」，不假装已经解决", () => {
    const { container, unmount } = render(
      <MementosReading record={detail({ work_status: "investigating", outcome: "" })} />,
    );
    expect(container.textContent).toContain("当前结果");
    expect(container.querySelector("[data-record-outcome-missing]")?.textContent).toContain(
      "仍在「调查中」",
    );
    unmount();
  });

  it("验证链接为空时如实说明，而不是留一个空列表", () => {
    const { container, unmount } = render(
      <MementosReading record={detail({ evidence_links: [] })} />,
    );
    const empty = container.querySelector("[data-record-evidence-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("没有公开的验证链接");
    expect(container.querySelector("[data-record-evidence]")).toBeNull();
    unmount();
  });

  it("验证链接是原生 a 且带 rel 保护", () => {
    const { container, unmount } = render(
      <MementosReading
        record={detail({
          evidence_links: [{ kind: "proof", label: "修复说明", url: "https://example.com/fix" }],
        })}
      />,
    );
    const external = container.querySelector('a[href="https://example.com/fix"]');
    expect(external?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(external?.textContent).toContain("验证：修复说明");
    unmount();
  });

  it("关联文章与作品用站点内链接，href 来自服务端", () => {
    const { container, unmount } = render(
      <MementosReading
        record={detail({
          posts: [
            { id: "p1", slug: "pointer-fix", title: "遮罩卸载时机的一次修复", href: "/posts/pointer-fix" },
          ],
          projects: [
            {
              id: "j1",
              slug: "p5-blog",
              title: "这个 P5 博客",
              summary: "把静态博客改造成怪盗基地",
              href: "/showcase/projects/p5-blog",
            },
          ],
        })}
      />,
    );
    const postLink = container.querySelector("[data-record-posts] a");
    const projectLink = container.querySelector("[data-record-projects] a");
    expect(postLink?.getAttribute("href")).toBe("/posts/pointer-fix");
    expect(postLink?.textContent).toContain("遮罩卸载时机的一次修复");
    expect(projectLink?.getAttribute("href")).toBe("/showcase/projects/p5-blog");
    unmount();
  });

  it("没有关联内容时说明情况并给出分类探索入口，不显示「已隐藏」占位", () => {
    const { container, unmount } = render(
      <MementosReading record={detail({ posts: [], projects: [] })} />,
    );
    const empty = container.querySelector("[data-record-related-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("没有关联的公开文章或作品");
    const category = [...container.querySelectorAll("a")].find((node) =>
      node.textContent?.includes("按文章分类探索"),
    );
    expect(category?.getAttribute("href")).toBe("/apps/metanav?screen=mugen");

    // 「已隐藏」「（已撤回）」之类的占位本身就是泄漏：页面上不允许出现。
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/已隐藏|已撤回|不可见的内容|\[\s*deleted\s*\]/i);
    unmount();
  });

  it("返回列表时保留工作状态筛选", () => {
    const { container, unmount } = render(
      <MementosReading record={detail()} backWorkStatus="investigating" />,
    );
    const back = [...container.querySelectorAll("a")].find((node) =>
      node.textContent?.includes("回到问题记录列表"),
    );
    expect(back?.getAttribute("href")).toBe("/apps/metanav/mementos?work_status=investigating");
    unmount();
  });

  it("页脚明确这是站主整理的问题日志，不是公开请求板", () => {
    const { container, unmount } = render(<MementosReading record={detail()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("站主整理的问题日志");
    expect(text).toContain("不构成对读者的处理承诺");
    // 没有任何「提交问题 / 认领 / 排队」的控件。
    const labels = [...container.querySelectorAll("button, a")].map((node) => node.textContent ?? "");
    expect(labels.join(" ")).not.toMatch(/提交问题|认领|排队|我要提问/);
    unmount();
  });
});
