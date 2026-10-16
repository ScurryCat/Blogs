/**
 * 天鹅绒房间的 URL 构造（T09）。
 *
 * 这一层是「分享 / 刷新 / Back 可用」的基础：地址拼错不会让类型检查失败，
 * 只会让读者点到一个 404。因此每个路径都当作契约来断言。
 */

import { describe, expect, it } from "vitest";

import {
  ADMIN_SKILLS_PAGE,
  adminSkillPagePath,
  adminSkillPath,
  comboQuery,
  projectPath,
  skillListQuery,
  skillListRelQuery,
  skillPath,
  skillRelPath,
  skillsForProjectPath,
  SKILLS_API,
  SKILLS_REL,
  VELVET_PATH,
  velvetHref,
} from "./paths";

describe("velvet paths", () => {
  it("技能详情地址带 slug 且做 URL 编码", () => {
    expect(skillPath("frontend-engineering")).toBe("/velvet/frontend-engineering");
    expect(skillPath("a b/c")).toBe("/velvet/a%20b%2Fc");
  });

  it("canonical 地址是 /velvet（07 §7）", () => {
    expect(VELVET_PATH).toBe("/velvet");
    expect(ADMIN_SKILLS_PAGE).toBe("/admin/skills");
  });

  it("浏览器路径带 /api/v1，服务端相对路径不带", () => {
    expect(SKILLS_API.list).toBe("/api/v1/skills");
    expect(SKILLS_REL.list).toBe("/skills");
    expect(skillRelPath("algorithms")).toBe("/skills/algorithms");
    expect(skillListRelQuery({ domain: "frontend" })).toBe("/skills?domain=frontend");
  });

  it("列表查询串只包含给过的参数", () => {
    expect(skillListQuery()).toBe("/api/v1/skills");
    expect(skillListQuery({ domain: "algorithm", limit: 10 })).toBe(
      "/api/v1/skills?domain=algorithm&limit=10",
    );
  });

  it("合体查询串同时带 a 与 b", () => {
    const query = comboQuery("frontend", "backend");
    expect(query.startsWith("/api/v1/skills/combo?")).toBe(true);
    expect(query).toContain("a=frontend");
    expect(query).toContain("b=backend");
  });

  it("作品侧入口指向同一个关系来源（不是第二份数据）", () => {
    expect(skillsForProjectPath("p5-blog")).toBe("/api/v1/skills/projects/p5-blog");
    expect(projectPath("p5-blog")).toBe("/showcase/projects/p5-blog");
  });

  it("管理路径分别指向 API 与页面", () => {
    expect(adminSkillPath("abc")).toBe("/api/v1/admin/skills/abc");
    expect(adminSkillPagePath("abc")).toBe("/admin/skills/abc");
  });

  it("领域筛选地址可分享", () => {
    expect(velvetHref()).toBe("/velvet");
    expect(velvetHref({ domain: "frontend" })).toBe("/velvet?domain=frontend");
  });
});
