/**
 * 问题记录列表视图（T09；07 §6、任务卡验收 3 / 4 / 6）。
 *
 * 覆盖：
 *  - 工作状态徽标与「解决于」日期只在已解决时出现；
 *  - 公开统计只统计当前公开记录（草稿数量不下发，因此界面无从泄漏）；
 *  - 明确写出**这是站主整理**、不是公开请求板（验收 4）；
 *  - 与 T04 的分类探索并存：页面上有通往分类印象空间的链接（不替代它）；
 *  - 空态明确，不生成虚构问题。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { MementosView } from "./mementos-view";
import { makeApiRecord, makeApiStats, stubFetch, type FetchStub } from "./test-support";
import type { RecordStats, RecordSummary } from "./types";

let stub: FetchStub | null = null;

function record(overrides: Record<string, unknown> = {}): RecordSummary {
  return makeApiRecord(overrides) as unknown as RecordSummary;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("MementosView", () => {
  it("渲染记录卡：标题 / 工作状态徽标 / 背景摘要", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView
        initialRecords={[record({ title: "为什么动画结束后无法点击页面", work_status: "pending" })]}
        initialCursor={null}
        stats={null}
      />,
    );
    const card = container.querySelector("[data-record]");
    expect(card?.getAttribute("href")).toBe("/apps/metanav/mementos/animation-pointer-events");
    expect(container.textContent).toContain("为什么动画结束后无法点击页面");
    expect(container.textContent).toContain("待探索");
    expect(container.textContent).toContain("指针事件没有恢复");
    unmount();
  });

  it("已解决的记录显示解决日期，未解决的不显示", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView
        initialRecords={[
          record({ slug: "solved-one", work_status: "resolved", resolved_at: "2026-10-16T12:00:00Z" }),
          record({ slug: "pending-one", work_status: "pending", resolved_at: null }),
        ]}
        initialCursor={null}
        stats={null}
      />,
    );
    const solved = container.querySelector('[data-record="solved-one"]');
    const pending = container.querySelector('[data-record="pending-one"]');
    expect(solved?.textContent).toContain("已解决");
    expect(solved?.textContent).toContain("解决于 2026-10-16");
    expect(pending?.textContent).not.toContain("解决于");
    unmount();
  });

  it("统计只显示服务端给出的公开数字（草稿数量根本不在响应里）", () => {
    stub = stubFetch([]);
    const stats = makeApiStats({
      total: 3,
      by_work_status: { pending: 1, investigating: 1, resolved: 1, archived: 0 },
    }) as unknown as RecordStats;
    const { container, unmount } = render(
      <MementosView initialRecords={[record()]} initialCursor={null} stats={stats} />,
    );
    const text = container.querySelector(".pme-stats")?.textContent ?? "";
    expect(text).toContain("全部3");
    expect(text).toContain("已解决1");
    // 只有四个工作状态的计数与总数，没有「隐藏 / 草稿」之类的暗示。
    expect(text).not.toMatch(/隐藏|草稿|未发布/);
    unmount();
  });

  it("stats 为 null 时不显示计数（而不是显示 0）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView initialRecords={[record()]} initialCursor={null} stats={null} />,
    );
    expect(container.querySelector(".pme-stats")).toBeNull();
    unmount();
  });

  it("明确写出这是站主整理的问题日志，并链接到分类探索（保留 T04）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView initialRecords={[record()]} initialCursor={null} stats={null} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("站主自己整理");
    expect(text).toContain("不是公开的请求板");
    expect(text).toContain("不承诺处理访客的任务");
    const category = [...container.querySelectorAll("a")].find((node) =>
      node.textContent?.includes("分类印象空间"),
    );
    expect(category?.getAttribute("href")).toBe("/apps/metanav?screen=mugen");
    unmount();
  });

  it("空态明确：没有记录就是空的，不生成虚构问题", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView initialRecords={[]} initialCursor={null} stats={null} />,
    );
    const empty = container.querySelector("[data-mementos-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("目前还没有公开的问题记录");
    expect(empty?.textContent).toContain("不会生成虚构的问题");
    expect(container.querySelector("[data-record]")).toBeNull();
    unmount();
  });

  it("筛选后的空态说的是「这个工作状态下」而不是「本站没有问题」", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView initialRecords={[]} initialCursor={null} stats={null} workStatus="archived" />,
    );
    expect(container.querySelector("[data-mementos-empty]")?.textContent).toContain(
      "这个工作状态下",
    );
    unmount();
  });

  it("读取失败与空态是两种不同的展示", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView
        initialRecords={[]}
        initialCursor={null}
        stats={null}
        loadError="读取问题记录失败（HTTP 503）：服务暂时不可用"
      />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("503");
    expect(container.querySelector("[data-mementos-empty]")).toBeNull();
    unmount();
  });

  it("「读取更多」带 cursor 与工作状态筛选", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/exploration/records",
        body: { items: [makeApiRecord({ slug: "second-record", title: "第二条记录" })], next_cursor: null },
      },
    ]);
    const { container, unmount } = render(
      <MementosView
        initialRecords={[record()]}
        initialCursor="cursor-1"
        stats={null}
        workStatus="investigating"
      />,
    );
    const button = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("读取更多记录"),
    );
    click(button ?? null);
    await advance(60);

    const request = stub?.requests.at(-1);
    expect(request?.url).toContain("cursor=cursor-1");
    expect(request?.url).toContain("work_status=investigating");
    expect(container.textContent).toContain("第二条记录");
    unmount();
  });

  it("记录卡是站点内链接（可新标签打开、可分享）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <MementosView initialRecords={[record({ slug: "shareable" })]} initialCursor={null} stats={null} />,
    );
    const card = container.querySelector("[data-record]");
    expect(card?.tagName).toBe("A");
    expect(card?.getAttribute("href")).toBe("/apps/metanav/mementos/shareable");
    unmount();
  });
});
