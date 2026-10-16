/**
 * 作品的 URL / 类型 / 管理端行解析（T06）。
 *
 * 这里重点测**解析器**：多行图片与链接是站主真正会用的输入方式，
 * 解析错了会静默丢掉一行 —— 那比报错更糟，所以逐条钉住错误分支。
 */

import { describe, expect, it } from "vitest";

import {
  adminProjectListQuery,
  adminProjectPagePath,
  adminProjectPath,
  palacePath,
  projectListQuery,
  projectPath,
  showcaseHref,
  PROJECTS_API,
} from "./paths";
import {
  linkKindLabel,
  maintenanceLabel,
  projectImageAlt,
  projectImageUrl,
  truncateSummary,
  SUMMARY_CARD_MAX,
  type ProjectImage,
} from "./types";
import { parseImageLines, parseLinkLines } from "./admin/project-workspace";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("作品 URL", () => {
  it("列表查询串带上筛选与游标", () => {
    expect(projectListQuery()).toBe(PROJECTS_API.list);
    expect(projectListQuery({ maintenance: "active", tech: "Next.js", limit: 12 })).toBe(
      `${PROJECTS_API.list}?maintenance=active&tech=Next.js&limit=12`,
    );
    expect(projectListQuery({ cursor: "abc" })).toContain("cursor=abc");
  });

  it("管理路径与页面路径", () => {
    expect(adminProjectListQuery({ status: "draft" })).toBe(`${PROJECTS_API.admin}?status=draft`);
    expect(adminProjectPath("id-1")).toBe(`${PROJECTS_API.admin}/id-1`);
    expect(adminProjectPagePath("id-1")).toBe("/admin/projects/id-1");
    expect(projectPath("p5-blog")).toBe("/showcase/projects/p5-blog");
    expect(showcaseHref()).toBe("/showcase");
    expect(showcaseHref({ maintenance: "archived" })).toBe("/showcase?maintenance=archived");
  });

  it("「攻略记录」进的是 T04 的专题页，不新建一套路由", () => {
    expect(palacePath("phantom-base")).toBe("/apps/metanav/palaces/phantom-base");
  });

  it("slug 做 URL 编码", () => {
    expect(projectPath("a b")).toBe("/showcase/projects/a%20b");
  });
});

describe("作品展示工具", () => {
  const image: ProjectImage = {
    media_id: UUID,
    position: 0,
    kind: "cover",
    alt: "首页截图",
    caption: "改造后的首页",
    taken_on: null,
    width: 1600,
    height: 900,
    variants: [
      { name: "w320.webp", width: 320, height: 180, bytes: 1, url: "/api/v1/media/a/w320.webp" },
      { name: "w640.webp", width: 640, height: 360, bytes: 2, url: "/api/v1/media/a/w640.webp" },
    ],
  };

  it("没有 w1280 时回落到已有的最大变体", () => {
    expect(projectImageUrl(image)).toBe("/api/v1/media/a/w640.webp");
    expect(projectImageUrl(image, ["w1280.webp", "w320.webp"])).toBe("/api/v1/media/a/w320.webp");
  });

  it("alt 兜底到说明，再兜到明确占位", () => {
    expect(projectImageAlt(image)).toBe("首页截图");
    expect(projectImageAlt({ ...image, alt: " " })).toBe("改造后的首页");
    expect(projectImageAlt({ ...image, alt: "", caption: "" })).toBe(
      "作品图片（未填写替代文本）",
    );
  });

  it("维护状态有中文标签；未知值原样返回（不假装成维护中）", () => {
    expect(maintenanceLabel("archived")).toBe("已归档");
    expect(maintenanceLabel("weird")).toBe("weird");
  });

  it("链接类型有中文标签", () => {
    expect(linkKindLabel("repo")).toBe("仓库");
    expect(linkKindLabel("unknown-kind")).toBe("链接");
  });

  it("一句话用途只在展示时截断", () => {
    expect(truncateSummary("短")).toBe("短");
    const long = "字".repeat(SUMMARY_CARD_MAX + 10);
    const truncated = truncateSummary(long);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.length).toBe(SUMMARY_CARD_MAX + 1);
  });
});

describe("管理端：图片行解析", () => {
  it("最少只需要 UUID | 替代文本，用途默认 detail", () => {
    const [line] = parseImageLines(`${UUID} | 首页截图`);
    expect(line?.ok).toBe(true);
    expect(line?.input).toMatchObject({
      media_id: UUID,
      position: 0,
      kind: "detail",
      alt: "首页截图",
      caption: "",
      taken_on: null,
    });
  });

  it("完整五段都被解析，position 按行号", () => {
    const lines = parseImageLines(
      [
        `${UUID} | 效果图 | cover | 首页 | 2026-10-16`,
        `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb | 成果截图 | evidence | 测试全绿`,
      ].join("\n"),
    );
    expect(lines.every((line) => line.ok)).toBe(true);
    expect(lines[0]?.input).toMatchObject({
      position: 0,
      kind: "cover",
      caption: "首页",
      taken_on: "2026-10-16",
    });
    expect(lines[1]?.input).toMatchObject({ position: 1, kind: "evidence", taken_on: null });
  });

  it("UUID 不合法时逐行报错，不静默丢弃", () => {
    const lines = parseImageLines("not-a-uuid | 图 | cover");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.ok).toBe(false);
    expect(lines[0]?.error).toContain("第 1 行");
    expect(lines[0]?.error).toContain("UUID");
  });

  it("缺替代文本时报错（alt 是硬要求）", () => {
    const [line] = parseImageLines(`${UUID} |   | cover`);
    expect(line?.ok).toBe(false);
    expect(line?.error).toContain("替代文本");
  });

  it("用途不在枚举里时报错", () => {
    const [line] = parseImageLines(`${UUID} | 图 | thumbnail`);
    expect(line?.ok).toBe(false);
    expect(line?.error).toContain("cover / detail / evidence");
  });

  it("拍摄日期格式不对时报错（不接受随意写法）", () => {
    const [line] = parseImageLines(`${UUID} | 图 | cover | 说明 | 2026/10/16`);
    expect(line?.ok).toBe(false);
    expect(line?.error).toContain("YYYY-MM-DD");
  });

  it("空行被忽略，行号仍按非空行的顺序", () => {
    const lines = parseImageLines(`\n${UUID} | 图一\n\nnot-a-uuid | 图二\n`);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.ok).toBe(true);
    expect(lines[1]?.error).toContain("第 2 行");
  });
});

describe("管理端：链接行解析", () => {
  it("github 归类为 repo，其它为 demo", () => {
    const { links, errors } = parseLinkLines(
      ["GitHub 仓库 | https://github.com/ScurryCat/Blogs", "演示 | https://example.com/demo"].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(links.map((link) => link.kind)).toEqual(["repo", "demo"]);
  });

  it("非 http(s) 的地址被拒绝（不接受 javascript: / 本机路径）", () => {
    const { links, errors } = parseLinkLines("恶意 | javascript:alert(1)");
    expect(links).toEqual([]);
    expect(errors[0]).toContain("http");
  });

  it("缺标题或地址时报错，位置可读", () => {
    expect(parseLinkLines("只有标题").errors[0]).toContain("第 1 行");
    expect(parseLinkLines("标题 |").errors[0]).toContain("第 1 行");
  });

  it("空输入不报错（链接是可选的）", () => {
    expect(parseLinkLines("")).toEqual({ links: [], errors: [] });
  });
});
