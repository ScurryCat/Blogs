/**
 * 技能编辑器（T09；07 §6、05 §7）。
 *
 * 关键断言：
 *  - 表单里**没有**等级 / 熟练度 / 完成度的输入控件（07 §6「不自封数值等级」）；
 *  - 范围说明或掌握证据为空时「发布」按钮被禁用，并说明原因（服务端也会拒）；
 *  - 保存走 PATCH + `If-Match`（并发控制不是前端自觉）；
 *  - 412 时**保留**表单里的输入，只提示读取最新版本（不自动覆盖）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { act } from "react";

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { SkillWorkspace } from "../admin/skill-workspace";
import { makeApiSkill, stubFetch, type FetchStub } from "../test-support";

let stub: FetchStub | null = null;

const CSRF = "csrf-token-for-tests";

function adminSkill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...makeApiSkill(),
    status: "draft",
    published_at: null,
    created_at: "2026-10-16T04:00:00Z",
    updated_at: "2026-10-16T04:00:00Z",
    version: 3,
    projects: [],
    ...overrides,
  };
}

/**
 * 像真实用户那样改一个受控输入框。
 *
 * 必须走**原型上的 value setter**：React 19 会在 input 元素实例上装一个自己的
 * `value` 描述符来追踪「上次渲染的值」，直接用 `field.value = x` 赋值会被它记成
 * 「没有变化」，随后的 input 事件被丢掉 —— 表现就是「测试里输入了但状态没变」。
 * 这不是测试环境的怪癖：真实浏览器里 React 装的是同一套追踪。
 */
function setInput(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("SkillWorkspace", () => {
  it("新建表单里没有任何等级 / 熟练度输入控件", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <SkillWorkspace csrfToken={CSRF} describeError={() => "x"} isConflict={() => false} createMode />,
    );
    const labels = [...container.querySelectorAll("label")].map((node) => node.textContent ?? "");
    const joined = labels.join(" | ");
    expect(joined).toContain("范围说明");
    expect(joined).toContain("掌握证据");
    expect(joined).not.toMatch(/等级|熟练度|完成度|掌握度|评分|分数/);
    // 没有任何 number 输入是「等级」性质的：唯一的 number 是展示顺序。
    const numberInputs = [...container.querySelectorAll('input[type="number"]')];
    expect(numberInputs).toHaveLength(1);
    expect(numberInputs[0]?.getAttribute("data-skill-position")).toBe("");
    unmount();
  });

  it("范围说明或证据为空时发布按钮禁用，并说明原因", async () => {
    stub = stubFetch([
      { match: "/api/v1/admin/skills/", body: adminSkill({ scope: "", evidence: "" }) },
    ]);
    const { container, unmount } = render(
      <SkillWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        skillId="11111111-1111-4111-8111-111111111111"
      />,
    );
    await advance(60);

    const publish = container.querySelector("[data-skill-publish]") as HTMLButtonElement | null;
    expect(publish?.disabled).toBe(true);
    expect(container.querySelector("[data-skill-publish-blocked]")).not.toBeNull();
    expect(container.textContent).toContain("没有证据的技能保持草稿");
    unmount();
  });

  it("填写了范围说明与证据后发布按钮可用", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/admin/skills/",
        body: adminSkill({ scope: "能独立完成响应式页面。", evidence: "这个博客的前端。" }),
      },
    ]);
    const { container, unmount } = render(
      <SkillWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        skillId="11111111-1111-4111-8111-111111111111"
      />,
    );
    await advance(60);
    const publish = container.querySelector("[data-skill-publish]") as HTMLButtonElement | null;
    expect(publish?.disabled).toBe(false);
    expect(container.querySelector("[data-skill-publish-blocked]")).toBeNull();
    unmount();
  });

  it("保存带 If-Match 与 CSRF token", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/admin/skills/11111111",
        method: "PATCH",
        body: adminSkill({ version: 4 }),
      },
      { match: "/api/v1/admin/skills/11111111", body: adminSkill() },
    ]);
    const { container, unmount } = render(
      <SkillWorkspace
        csrfToken={CSRF}
        describeError={() => "x"}
        isConflict={() => false}
        createMode={false}
        skillId="11111111-1111-4111-8111-111111111111"
      />,
    );
    await advance(60);
    setInput(container, "[data-skill-name]", "改过的名字");
    await advance(10);
    click(container.querySelector("[data-skill-save]"));
    await advance(60);

    const patch = stub?.requests.find((request) => request.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(patch?.headers["if-match"]).toBe('"3"');
    expect((patch?.body as Record<string, unknown>)?.csrf_token).toBe(CSRF);
    expect((patch?.body as Record<string, unknown>)?.name).toBe("改过的名字");
    unmount();
  });

  it("412 时保留输入并提示读取最新版本，不自动覆盖", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/admin/skills/11111111",
        method: "PATCH",
        status: 412,
        body: {
          error: { code: "VERSION_CONFLICT", message: "版本冲突", fields: {} },
          request_id: "stub",
        },
      },
      { match: "/api/v1/admin/skills/11111111", body: adminSkill() },
    ]);
    const { container, unmount } = render(
      <SkillWorkspace
        csrfToken={CSRF}
        describeError={(error) =>
          (error as { status?: number }).status === 412 ? "内容已在别处更新（版本冲突）。" : "失败"
        }
        isConflict={(error) => (error as { status?: number }).status === 412}
        createMode={false}
        skillId="11111111-1111-4111-8111-111111111111"
      />,
    );
    await advance(60);
    setInput(container, "[data-skill-name]", "我改到一半的名字");
    await advance(10);
    click(container.querySelector("[data-skill-save]"));
    await advance(60);

    expect(container.querySelector("[data-skill-conflict]")).not.toBeNull();
    // 未保存的输入还在（这就是「不自动覆盖」的可观察证据）。
    const name = container.querySelector("[data-skill-name]") as HTMLInputElement | null;
    expect(name?.value).toBe("我改到一半的名字");
    unmount();
  });
});
