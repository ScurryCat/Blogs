/**
 * 技能详情视图（T09；07 §6、验收 2 / 6）。
 *
 * 关键断言：
 *  - 范围说明与掌握证据**都**显示；
 *  - 关联作品是站点内链接（T06 的作品详情），不复制正文；
 *  - 没有关联作品时明确说明「还没有和这门技能关联的公开作品」，不编造；
 *  - 站外证据链接是原生 `a` + `rel="noreferrer noopener"`（不是站内 SiteLink）；
 *  - 页面上没有等级 / 熟练度字样。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { render, resetDocument } from "@/tests/helpers/render";

import { SkillReading } from "./skill-reading";
import { makeApiProjectRef, makeApiSkillDetail } from "./test-support";
import type { SkillDetail } from "./types";

function detail(overrides: Record<string, unknown> = {}): SkillDetail {
  return makeApiSkillDetail(overrides) as unknown as SkillDetail;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  resetDocument();
});

describe("SkillReading", () => {
  it("显示名称、领域、范围说明与掌握证据", () => {
    const { container, unmount } = render(
      <SkillReading
        skill={detail({
          name: "前端工程",
          domain: "frontend",
          scope: "能独立完成响应式页面与前端构建配置。",
          evidence: "这个博客的前端与手机宿主，含 320px 适配。",
        })}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("前端工程");
    expect(text).toContain("范围说明");
    expect(text).toContain("响应式页面");
    expect(text).toContain("掌握证据");
    expect(text).toContain("320px");
    unmount();
  });

  it("关联作品链接到 T06 的作品详情，不复制正文", () => {
    const { container, unmount } = render(
      <SkillReading
        skill={detail({
          projects: [makeApiProjectRef({ slug: "p5-blog", title: "这个 P5 博客" })],
        })}
      />,
    );
    const link = container.querySelector("[data-skill-project] a");
    expect(link?.getAttribute("href")).toBe("/showcase/projects/p5-blog");
    expect(container.textContent).toContain("这个 P5 博客");
    expect(container.textContent).toContain("持续维护");
    unmount();
  });

  it("没有关联作品时明确空态，不编造作品", () => {
    const { container, unmount } = render(<SkillReading skill={detail({ projects: [] })} />);
    const empty = container.querySelector("[data-skill-projects-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("还没有和这门技能关联的公开作品");
    expect(empty?.textContent).toContain("不会临时生成一件作品");
    unmount();
  });

  it("站外证据链接用原生 a 且带 rel 保护", () => {
    const { container, unmount } = render(
      <SkillReading
        skill={detail({
          links: [{ kind: "repo", label: "仓库", url: "https://example.com/blog" }],
        })}
      />,
    );
    const external = container.querySelector('a[href="https://example.com/blog"]');
    expect(external).not.toBeNull();
    expect(external?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.textContent).toContain("仓库：仓库");
    unmount();
  });

  it("没有外部证据时不显示空的小节标题", () => {
    const { container, unmount } = render(<SkillReading skill={detail({ links: [] })} />);
    expect(container.textContent).not.toContain("外部证据");
    unmount();
  });

  it("页面里没有等级 / 分数 / 百分比", () => {
    const { container, unmount } = render(
      <SkillReading skill={detail({ projects: [makeApiProjectRef()], tech_overlap: ["Next.js"] })} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/等级|熟练度|完成度|Lv\.?\s*\d|Rank\s*\d/);
    expect(text).not.toMatch(/\d+\s*%/);
    unmount();
  });

  it("技术栈同名项作为一致性提示展示，并说明它不是掌握程度", () => {
    const { container, unmount } = render(
      <SkillReading
        skill={detail({ name: "Next.js", tech_overlap: ["Next.js"] })}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("与技术栈对得上的项");
    expect(text).toContain("不是");
    expect(text).toContain("掌握程度");
    unmount();
  });

  it("回到技能全书的链接是站内链接", () => {
    const { container, unmount } = render(<SkillReading skill={detail()} />);
    const back = [...container.querySelectorAll("a")].find((node) =>
      node.textContent?.includes("回到技能全书"),
    );
    expect(back?.getAttribute("href")).toBe("/velvet");
    unmount();
  });
});
