/**
 * 作品详情里的「使用的技能」（T09；验收 2「同一关系来源」）。
 *
 * 这个组件是**交付给 T06 作品页的一层关系视图**：它和技能全书读的是同一个端点
 * （`GET /api/v1/skills/projects/<slug>`），因此两处不可能互相矛盾。
 *
 * 覆盖三种状态：读到技能 / 读到空数组 / 读不到（服务不可用）。
 * 空值与失败必须分开显示 —— 把「读不到」写成「这件作品没有技能」是对读者撒谎。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, render, resetDocument } from "@/tests/helpers/render";

import { ProjectSkills } from "./project-skills";
import { makeApiSkill, stubFetch, type FetchStub } from "./test-support";

let stub: FetchStub | null = null;

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("ProjectSkills", () => {
  it("读到技能时列出名称并链到技能详情", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills/projects/",
        body: [makeApiSkill({ slug: "algorithms", name: "算法", domain: "algorithm" })],
      },
    ]);
    const { container, unmount } = render(<ProjectSkills projectSlug="p5-blog" />);
    await advance(80);

    const link = container.querySelector("[data-project-skill]");
    expect(link?.getAttribute("href")).toBe("/velvet/algorithms");
    expect(link?.textContent).toContain("算法");
    expect(link?.textContent).toContain("算法与数据结构");
    unmount();
  });

  it("读到的请求路径就是作品 slug（同一关系来源）", async () => {
    stub = stubFetch([{ match: "/api/v1/skills/projects/", body: [] }]);
    const { unmount } = render(<ProjectSkills projectSlug="p5-blog" />);
    await advance(80);
    expect(stub?.requests.at(-1)?.url).toBe("/api/v1/skills/projects/p5-blog");
    unmount();
  });

  it("空数组时明确说「还没有登记技能」，并给出技能全书入口", async () => {
    stub = stubFetch([{ match: "/api/v1/skills/projects/", body: [] }]);
    const { container, unmount } = render(<ProjectSkills projectSlug="p5-blog" />);
    await advance(80);

    const empty = container.querySelector("[data-skills-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("还没有登记技能");
    const link = empty?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/velvet");
    expect(container.querySelector("[data-project-skills]")).toBeNull();
    unmount();
  });

  it("读不到时明确说「暂时读不到」，不冒充「没有技能」", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/skills/projects/",
        status: 503,
        body: { error: { code: "SERVICE_UNAVAILABLE", message: "服务暂时不可用", fields: {} }, request_id: "stub" },
      },
    ]);
    const { container, unmount } = render(<ProjectSkills projectSlug="p5-blog" />);
    await advance(120);

    expect(container.querySelector("[data-skills-unavailable]")).not.toBeNull();
    expect(container.querySelector("[data-skills-empty]")).toBeNull();
    expect(container.textContent).toContain("作品本身不受影响");
    unmount();
  });
});
