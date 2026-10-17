/**
 * 顶部五栏目与内容归属（任务书 §2.1 / §8.1）。
 *
 * 断言的是**配置与归属规则**，以及页头是否真的按同一份配置渲染：
 *  - 固定五项、名称 / 副标题 / 目的地与任务书一致，天气不再是一级栏目；
 *  - 子页面高亮按内容归属（文章详情归文章、手记 / INS / 放课后 / 图库 / 留言归生活、
 *    作品详情归作品），不是 URL 完全相等；
 *  - COOP 归属在统一配置中明确（关于），不新增第六个栏目；
 *  - 「作品」链接显式带 enter-showcase 意图且 href 仍是 /showcase；
 *  - 移动端与桌面端是同一份 DOM / 同一份配置（只有一个 nav、五项）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COOP_PATH,
  COOP_SECTION_KEY,
  GALLERY_PATH,
  GUESTBOOK_PATH,
  MAIN_NAV,
  WEATHER_PATH,
  activeSection,
  navItem,
  normalizePathname,
} from "@/features/navigation/site-nav";
import { SiteHeader } from "@/components/ui/site-header";
import { SiteNavLinks } from "@/features/navigation/site-nav-links";
import { click, render, resetDocument } from "../helpers/render";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

// 页头里的日历 / 音效与本节无关，且需要音频与 rAF 环境：替换成空实现，
// 让断言只落在「五栏目 + Logo」上。
vi.mock("@/features/runtime/legacy-fx", () => ({
  SoundToggle: () => null,
}));
vi.mock("@/components/ui/header-calendar", () => ({
  HeaderCalendar: () => null,
}));

beforeEach(() => {
  pathname = "/";
});

afterEach(() => {
  resetDocument();
});

describe("顶部五栏目配置", () => {
  it("固定五项，顺序 / 主谓 / 副标题 / 目的地与任务书 §2.1 一致", () => {
    expect(MAIN_NAV.map((item) => item.key)).toEqual([
      "posts",
      "life",
      "showcase",
      "map",
      "about",
    ]);
    expect(MAIN_NAV.map((item) => item.label)).toEqual(["文章", "生活", "作品", "地图", "关于"]);
    expect(MAIN_NAV.map((item) => item.sub)).toEqual([
      "情报档案",
      "勒布朗",
      "我的殿堂",
      "东京漫游",
      "人物档案",
    ]);
    expect(MAIN_NAV.map((item) => item.href)).toEqual([
      "/posts",
      "/apps/leblanc",
      "/showcase",
      "/map",
      "/about",
    ]);
  });

  it("天气不再占一级栏目，但天气页本身仍存在", () => {
    expect(MAIN_NAV.map((item) => item.href)).not.toContain(WEATHER_PATH);
    expect(MAIN_NAV.map((item) => item.key as string)).not.toContain("weather");
    expect(WEATHER_PATH).toBe("/weather");
    expect(activeSection(WEATHER_PATH)).toBeNull();
  });

  it("只有「作品」带 enter-showcase 意图，且保留正确 href", () => {
    const withIntent = MAIN_NAV.filter((item) => item.intent !== undefined);
    expect(withIntent).toHaveLength(1);
    expect(withIntent[0]?.key).toBe("showcase");
    expect(withIntent[0]?.intent).toBe("enter-showcase");
    expect(withIntent[0]?.href).toBe("/showcase");
    // 旧照片地址不属于作品殿堂边界，配置里不给它任何意图或六栏目条目。
    expect(MAIN_NAV.some((item) => item.href.includes("/showcase/photos"))).toBe(false);
  });

  it("COOP 归属在统一配置中明确为「关于」，且不新增第六个栏目", () => {
    expect(COOP_SECTION_KEY).toBe("about");
    expect(COOP_PATH).toBe("/apps/coop");
    expect(activeSection(COOP_PATH)).toBe("about");
    expect(navItem(COOP_SECTION_KEY).key).toBe("about");
    // COOP 不是顶部栏目：它由「关于」承担（不出现 /apps/coop 的顶部项）。
    expect(MAIN_NAV.some((item) => item.href === COOP_PATH)).toBe(false);
  });

  it("生活相关入口使用真实路由常量", () => {
    expect(GALLERY_PATH).toBe("/gallery");
    expect(GUESTBOOK_PATH).toBe("/guestbook");
    expect(activeSection(GUESTBOOK_PATH)).toBe("life");
  });
});

describe("子页面按内容归属高亮", () => {
  const cases: Array<[string, string | null, string]> = [
    ["/posts", "posts", "文章索引"],
    ["/posts/css-p5-menu", "posts", "文章详情归文章"],
    ["/posts/css-p5-menu?from=home", "posts", "带查询串仍是文章"],
    ["/apps/leblanc", "life", "生活首页"],
    ["/apps/journal", "life", "手记归生活"],
    ["/apps/journal/123", "life", "手记详情归生活"],
    ["/apps/ins", "life", "INS 归生活"],
    ["/apps/ins/collections", "life", "INS 子页归生活"],
    ["/apps/leisure", "life", "放课后归生活"],
    ["/apps/leisure?screen=game", "life", "放课后子视图归生活"],
    ["/gallery", "life", "图库归生活"],
    ["/gallery?view=albums", "life", "图库相册视图归生活"],
    ["/guestbook", "life", "留言归生活"],
    ["/showcase/photos", "life", "旧照片地址归生活（不算作品殿堂）"],
    ["/showcase", "showcase", "作品首页"],
    ["/showcase/projects/p5-blog", "showcase", "作品详情归作品"],
    ["/map", "map", "地图"],
    ["/about", "about", "关于"],
    [COOP_PATH, "about", "COOP 归关于"],
    ["/", null, "首页不强行高亮"],
    ["/weather", null, "天气不占一级栏目"],
    ["/apps/metanav", null, "异世界导航不属于五栏目"],
    ["/velvet", null, "技能全书不属于五栏目"],
    ["/admin/journal", null, "管理端不属于公开栏目"],
  ];

  for (const [path, expected, reason] of cases) {
    it(`${path} → ${expected ?? "无高亮"}（${reason}）`, () => {
      expect(activeSection(path)).toBe(expected);
    });
  }

  it("统一去掉查询 / 哈希与结尾斜杠", () => {
    expect(normalizePathname("/posts/?x=1#y")).toBe("/posts");
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname(null)).toBe("/");
  });
});

describe("页头渲染（桌面与移动端同一份配置）", () => {
  it("只有一个主导航，五项与配置完全一致，且没有天气项", () => {
    pathname = "/";
    const { container } = render(<SiteNavLinks />);
    const navs = container.querySelectorAll("nav.hud-nav");
    expect(navs).toHaveLength(1);
    const links = [...container.querySelectorAll<HTMLAnchorElement>(".hud-nav a")];
    expect(links).toHaveLength(MAIN_NAV.length);
    expect(links.map((link) => link.getAttribute("data-k"))).toEqual(
      MAIN_NAV.map((item) => item.key),
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      MAIN_NAV.map((item) => item.href),
    );
    expect(container.textContent).not.toContain("天气");
    // 主标签 + P5 副标题都在同一行文字里（移动端只靠 CSS 隐藏副标题，不换数组）。
    for (const [index, item] of MAIN_NAV.entries()) {
      expect(links[index]?.textContent).toContain(item.label);
      expect(links[index]?.textContent).toContain(item.sub);
    }
  });

  it("按当前路径给正确的栏目加 aria-current=page", () => {
    const expectations: Array<[string, string | null]> = [
      ["/posts/css-p5-menu", "posts"],
      ["/apps/journal/123", "life"],
      ["/gallery", "life"],
      ["/showcase/projects/x", "showcase"],
      ["/map", "map"],
      ["/apps/coop", "about"],
      ["/weather", null],
      ["/", null],
    ];
    for (const [currentPath, expected] of expectations) {
      pathname = currentPath;
      const { container, unmount } = render(<SiteNavLinks />);
      const current = [
        ...container.querySelectorAll<HTMLAnchorElement>(".hud-nav a[aria-current='page']"),
      ];
      if (expected === null) {
        expect(current, `${currentPath} 不该高亮任何栏目`).toHaveLength(0);
      } else {
        expect(current, `${currentPath} 应高亮 ${expected}`).toHaveLength(1);
        expect(current[0]?.getAttribute("data-k")).toBe(expected);
      }
      unmount();
    }
  });

  it("SiteHeader 的 Logo 返回首页，五栏目在页头里", () => {
    pathname = "/posts";
    const { container } = render(<SiteHeader />);
    const brand = container.querySelector<HTMLAnchorElement>("a.brand");
    expect(brand?.getAttribute("href")).toBe("/");
    expect(brand?.getAttribute("aria-label")).toContain("首页");
    expect(container.querySelectorAll(".hud-nav a")).toHaveLength(5);
    // Logo 是普通链接，点击仍走站内导航（真实 href 保留）。
    click(brand);
    expect(brand?.getAttribute("href")).toBe("/");
  });
});
