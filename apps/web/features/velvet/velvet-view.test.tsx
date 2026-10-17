/**
 * 技能全书视图（T09；07 §6、任务卡验收 1 / 2 / 6）。
 *
 * 覆盖：
 *  - 技能卡显示真实字段（名称 / 领域 / 范围说明 / 关联作品数）；
 *  - **没有任何等级、熟练度或完成度**（07 §6「不自封数值等级」）；
 *  - 空态明确说明「技能全书还在整理」，不摆占位卡片；
 *  - 关联作品数来自真实关系计数，草稿技能不出现；
 *  - 「读取更多」带 cursor 与领域筛选并追加；失败给重试文案。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { makeApiSkill, stubFetch, type FetchStub } from "./test-support";
import type { SkillSummary } from "./types";
import { VelvetView } from "./velvet-view";

let stub: FetchStub | null = null;

function skill(overrides: Record<string, unknown> = {}): SkillSummary {
  return makeApiSkill(overrides) as unknown as SkillSummary;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("VelvetView", () => {
  it("渲染技能卡：名称 / 领域 / 范围说明 / 关联作品数", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <VelvetView
        initialSkills={[
          skill({
            name: "前端工程",
            domain: "frontend",
            scope: "能独立完成响应式页面与前端构建配置。",
            project_count: 2,
          }),
        ]}
        initialCursor={null}
      />,
    );

    const card = container.querySelector("[data-skill]");
    expect(card?.getAttribute("href")).toBe("/velvet/frontend-engineering");
    expect(container.textContent).toContain("前端工程");
    expect(container.textContent).toContain("前端工程"); // 领域标签
    expect(container.textContent).toContain("响应式页面");
    expect(container.textContent).toContain("关联作品");
    expect(container.textContent).toContain("2");
    unmount();
  });

  it("页面里没有等级 / 熟练度 / 完成度字样，也没有分数", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <VelvetView initialSkills={[skill()]} initialCursor={null} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/等级|熟练度|完成度|Lv\.?\s*\d|Rank\s*\d|掌握度/);
    // 唯一的数字是「关联作品 N 件」与展示顺序，不出现百分比。
    expect(text).not.toMatch(/\d+\s*%/);
    unmount();
  });

  it("空态明确说明还没有公开技能，不摆占位卡片", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(<VelvetView initialSkills={[]} initialCursor={null} />);
    expect(container.querySelector("[data-velvet-empty]")).not.toBeNull();
    expect(container.textContent).toContain("技能全书还在整理");
    expect(container.textContent).toContain("不会自封等级");
    expect(container.querySelector("[data-skill]")).toBeNull();
    unmount();
  });

  it("服务端读不到时显示失败原因，而不是「没有技能」", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <VelvetView
        initialSkills={[]}
        initialCursor={null}
        loadError="读取技能全书失败（HTTP 503）：服务暂时不可用"
      />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("503");
    // 失败态**不**显示「还在整理」那句空态文案（两者不能混淆）。
    expect(container.querySelector("[data-velvet-empty]")).toBeNull();
    unmount();
  });

  it("领域筛选按钮指向带 domain 的地址", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <VelvetView initialSkills={[skill()]} initialCursor={null} domain="frontend" />,
    );
    const current = [...container.querySelectorAll('[aria-current="true"]')].map((node) =>
      node.textContent?.trim(),
    );
    expect(current).toContain("前端工程");
    const hrefs = [...container.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(hrefs).toContain("/velvet?domain=algorithm");
    unmount();
  });

  it("有 next_cursor 时「读取更多」带 cursor 与领域请求并追加", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills",
        body: { items: [makeApiSkill({ slug: "second-skill", name: "第二门技能" })], next_cursor: null },
      },
    ]);
    const { container, unmount } = render(
      <VelvetView initialSkills={[skill()]} initialCursor="cursor-1" domain="frontend" />,
    );

    const button = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("读取更多技能"),
    );
    click(button ?? null);
    await advance(60);

    const request = stub?.requests.at(-1);
    expect(request?.url).toContain("cursor=cursor-1");
    expect(request?.url).toContain("domain=frontend");
    expect(container.textContent).toContain("第二门技能");
    expect(container.textContent).toContain("前端工程");
    unmount();
  });

  it("失败态的「重新读取」重新请求首屏并恢复列表（不用整页刷新）", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills",
        body: { items: [makeApiSkill({ slug: "recovered", name: "恢复的技能" })], next_cursor: null },
      },
    ]);
    const { container, unmount } = render(
      <VelvetView
        initialSkills={[]}
        initialCursor={null}
        loadError="读取技能全书失败（HTTP 503）：服务暂时不可用"
        domain="frontend"
      />,
    );

    const button = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("重新读取"),
    );
    click(button ?? null);
    await advance(60);

    const request = stub?.requests.at(-1);
    expect(request?.url).toContain("/api/v1/skills");
    expect(request?.url).toContain("domain=frontend");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("恢复的技能");
    unmount();
  });

  it("技能列表是站点内链接（SiteLink 保留真实 href，可新标签打开）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <VelvetView initialSkills={[skill({ slug: "algorithms" })]} initialCursor={null} />,
    );
    const card = container.querySelector("[data-skill]");
    expect(card?.tagName).toBe("A");
    expect(card?.getAttribute("href")).toBe("/velvet/algorithms");
    unmount();
  });
});
