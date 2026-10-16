/**
 * 「合体」筛选控件（T09；07 §6、任务卡验收 1）。
 *
 * 这个控件的**全部价值**在于把三种结果分开，因此用例也围绕这三种：
 *
 *  1. 重复选择同一技能 → 明确报错，**不发请求**，也不把该技能的全部作品冒充交集；
 *  2. 交集为空 → 明确空态 + 不编造作品（没有「生成一个」之类的按钮）；
 *  3. 有交集 → 只列交集里的那一件，并链到 T06 的作品详情。
 *
 * 另外覆盖：不足两个技能时不显示选择器（不给一个点不动的控件）、
 * 换了选择之后旧结果不会被当成新结果渲染。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { act } from "react";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { SkillComboPanel } from "./skill-combo";
import { makeApiCombo, makeApiProjectRef, makeApiSkill, stubFetch, type FetchStub } from "./test-support";
import type { SkillSummary } from "./types";

let stub: FetchStub | null = null;

function skills(): SkillSummary[] {
  return [
    makeApiSkill({ slug: "frontend", name: "前端工程", domain: "frontend" }),
    makeApiSkill({ slug: "backend", name: "后端与接口", domain: "backend" }),
    makeApiSkill({ slug: "algorithm", name: "算法", domain: "algorithm" }),
  ] as unknown as SkillSummary[];
}

function pickSelectors(container: HTMLElement): { a: HTMLSelectElement; b: HTMLSelectElement } {
  const a = container.querySelector("[data-combo-a]") as HTMLSelectElement | null;
  const b = container.querySelector("[data-combo-b]") as HTMLSelectElement | null;
  if (!a || !b) throw new Error("没有找到合体的两个选择器");
  return { a, b };
}

function choose(select: HTMLSelectElement, value: string): void {
  // 必须包在 act 里：change 事件会触发 React 状态更新，否则会有 act 警告，
  // 而且断言可能在渲染完成前就跑（真实踩过）。
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function runButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector("[data-combo-run]") as HTMLButtonElement | null;
  if (!button) throw new Error("没有找到「显示合体结果」按钮");
  return button;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("SkillComboPanel", () => {
  it("技能少于两个时不显示选择器", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <SkillComboPanel skills={[makeApiSkill() as unknown as SkillSummary]} />,
    );
    expect(container.querySelector("[data-combo-a]")).toBeNull();
    expect(container.textContent).toContain("至少两门已公开的技能");
    unmount();
  });

  it("重复选择同一技能：明确提示且不发请求", async () => {
    stub = stubFetch([]);
    const { container, unmount } = render(<SkillComboPanel skills={skills()} />);
    const { a, b } = pickSelectors(container);

    choose(a, "frontend");
    choose(b, "frontend");
    await advance(20);

    expect(container.querySelector("[data-combo-same]")).not.toBeNull();
    expect(runButton(container).disabled).toBe(true);
    expect(stub?.requests).toHaveLength(0);

    // B 下拉里的同一个技能是禁用的（界面层面先挡住，服务端仍然会拒）。
    const options = [...b.querySelectorAll("option")];
    expect(options.find((option) => option.value === "frontend")?.disabled).toBe(true);
    unmount();
  });

  it("交集为空：显示明确空态，页面上没有「生成作品」之类的按钮", async () => {
    stub = stubFetch([
      { match: "/api/v1/skills/combo", body: makeApiCombo({ items: [] }) },
    ]);
    const { container, unmount } = render(<SkillComboPanel skills={skills()} />);
    const { a, b } = pickSelectors(container);

    choose(a, "frontend");
    choose(b, "algorithm");
    await advance(20);
    click(runButton(container));
    await advance(60);

    expect(stub?.requests.at(-1)?.url).toContain("a=frontend");
    expect(stub?.requests.at(-1)?.url).toContain("b=algorithm");
    const empty = container.querySelector("[data-combo-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("还没有同时用到这两个技能的公开作品");
    expect(empty?.textContent).toContain("不会替你生成一个");
    // 没有「AI 生成 / 推荐一个」这类入口。
    const labels = [...container.querySelectorAll("button")].map((node) => node.textContent ?? "");
    expect(labels.join(" ")).not.toMatch(/生成|推荐|随机/);
    unmount();
  });

  it("有交集时只显示交集里的作品，并链到作品详情", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills/combo",
        body: makeApiCombo({ items: [makeApiProjectRef({ slug: "p5-blog", title: "这个 P5 博客" })] }),
      },
    ]);
    const { container, unmount } = render(<SkillComboPanel skills={skills()} />);
    const { a, b } = pickSelectors(container);

    choose(a, "frontend");
    choose(b, "backend");
    await advance(20);
    click(runButton(container));
    await advance(60);

    const rows = [...container.querySelectorAll("[data-combo-project]")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-combo-project")).toBe("p5-blog");
    const link = rows[0]?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/showcase/projects/p5-blog");
    expect(container.textContent).toContain("这个 P5 博客");
    unmount();
  });

  it("换了选择之后旧结果不再显示（过期的结果键不匹配）", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills/combo",
        body: makeApiCombo({ items: [makeApiProjectRef({ slug: "old-result", title: "旧结果作品" })] }),
      },
    ]);
    const { container, unmount } = render(<SkillComboPanel skills={skills()} />);
    const { a, b } = pickSelectors(container);

    choose(a, "frontend");
    choose(b, "backend");
    await advance(20);
    click(runButton(container));
    await advance(60);
    expect(container.querySelector("[data-combo-result]")).not.toBeNull();

    // 只改一个选择：上一次的结果必须立刻消失，而不是继续显示旧交集。
    choose(b, "algorithm");
    await advance(20);
    expect(container.querySelector("[data-combo-result]")).toBeNull();
    expect(container.textContent).not.toContain("旧结果作品");
    unmount();
  });

  it("服务端返回 404（技能未发布）时显示「不存在或未公开」，不是空交集文案", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills/combo",
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "技能不存在或未公开", fields: {} }, request_id: "stub" },
      },
    ]);
    const { container, unmount } = render(<SkillComboPanel skills={skills()} />);
    const { a, b } = pickSelectors(container);

    choose(a, "frontend");
    choose(b, "backend");
    await advance(20);
    click(runButton(container));
    await advance(60);

    const failure = container.querySelector("[data-combo-failure]");
    expect(failure?.textContent).toContain("技能不存在或未公开");
    // 404 与「空交集」是两回事，不能都说成「还没有对应作品」。
    expect(container.querySelector("[data-combo-empty]")).toBeNull();
    unmount();
  });
});
