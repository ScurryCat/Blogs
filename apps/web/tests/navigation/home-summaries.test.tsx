/**
 * 首页摘要与旧锚点兼容（任务书 §2.2 / §8.1）。
 *
 * 首页保留主题框架但只做摘要：最新文章、精选作品、归档入口。
 * 这里断言：
 *  - `id="posts"` / `id="archive"` 两个旧锚点仍有**有意义**的落点（有内容 + 有入口），
 *    不是悬空锚点，也不再复制完整搜索页；
 *  - 最新文章 / 精选作品只展示真实数据；空数据或读取失败时显示真实空态，不造占位；
 *  - 入口指向 `/posts`、`/posts?view=archive`、`/showcase`（作品入口带殿堂意图）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOME_FEATURED_COUNT,
  HOME_LATEST_COUNT,
  HomeArchiveEntry,
  HomeFeaturedWorks,
  HomeLatestPosts,
} from "@/features/legacy/pages/home-index";
import { posts } from "@/features/legacy/posts";
import type { ProjectSummary } from "@/features/showcase/types";
import { click, render, resetDocument } from "../helpers/render";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// 链接点击交给导航协调器：这里只断言「交给它什么」（href / intent），不验证过场实现。
vi.mock("@/features/runtime/navigation/coordinator", () => ({
  useNavigation: () => ({
    navigate: navigateMock,
    updateUrl: () => undefined,
    commitPhoneTarget: () => undefined,
    navigating: () => false,
    debug: () => ({
      navigating: false,
      source: null,
      intent: null,
      kind: "none",
      token: 0,
      pendingPath: null,
      cancels: 0,
    }),
  }),
}));

const PROJECTS: ProjectSummary[] = [
  {
    id: "project-1",
    slug: "p5-blog",
    title: "这个 P5 博客",
    summary: "把纯静态的 Persona 5 风格博客改造成可发布站点。",
    tech_stack: ["Next.js", "FastAPI"],
    maintenance: "maintained",
    maintenance_label: "持续维护",
    published_at: "2026-10-16T21:28:22+08:00",
    cover: null,
    palace: null,
  },
  {
    id: "project-2",
    slug: "second",
    title: "第二件作品",
    summary: "真实存在的作品摘要。",
    tech_stack: [],
    maintenance: "active",
    maintenance_label: "正在开发",
    published_at: "2026-10-10T00:00:00+08:00",
    cover: null,
    palace: null,
  },
];

afterEach(() => {
  resetDocument();
  navigateMock.mockClear();
});

describe("首页最新文章摘要（旧 /#posts 落点）", () => {
  it("id=posts 有真实摘要内容与「进入情报档案」入口", () => {
    const { container, unmount } = render(<HomeLatestPosts items={posts} />);
    const section = container.querySelector("#posts");
    expect(section, "旧 /#posts 锚点必须有落点").toBeTruthy();
    expect(section?.tagName).toBe("SECTION");
    expect(container.querySelectorAll(".rows .row")).toHaveLength(HOME_LATEST_COUNT);
    // 摘要列表就是真实文章（链接到 canonical 文章页）。
    const first = posts[0];
    expect(container.querySelector<HTMLAnchorElement>(".rows .row-a")?.getAttribute("href")).toBe(
      `/posts/${encodeURIComponent(first?.slug ?? "")}`,
    );
    const toIndex = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.getAttribute("href") === "/posts",
    );
    expect(toIndex, "首页摘要必须给出完整索引入口").toBeTruthy();
    expect(toIndex?.textContent).toContain("情报档案");
    unmount();
  });

  it("没有文章时显示真实空态，不造占位文章", () => {
    const { container, unmount } = render(<HomeLatestPosts items={[]} />);
    expect(container.querySelectorAll(".rows .row")).toHaveLength(0);
    expect(container.textContent).toContain("还没有公开文章");
    unmount();
  });
});

describe("首页精选作品摘要", () => {
  it("只展示传入的真实作品，并链接到作品详情与作品首页", () => {
    const { container, unmount } = render(<HomeFeaturedWorks projects={PROJECTS} />);
    expect(container.querySelectorAll(".n1-work")).toHaveLength(
      Math.min(HOME_FEATURED_COUNT, PROJECTS.length),
    );
    const firstLink = container.querySelector<HTMLAnchorElement>(".n1-work-a");
    expect(firstLink?.getAttribute("href")).toBe("/showcase/projects/p5-blog");
    expect(container.textContent).toContain("这个 P5 博客");
    // 卡片只显示真实字段（技术栈来自 API），不生成奖项 / 数字之类的占位。
    expect(container.textContent).toContain("Next.js · FastAPI");
    unmount();
  });

  it("读取失败时如实说明原因，不生成占位作品", () => {
    const { container, unmount } = render(
      <HomeFeaturedWorks projects={[]} error="连不上接口服务，暂时无法读取作品" />,
    );
    expect(container.querySelectorAll(".n1-work")).toHaveLength(0);
    expect(container.querySelector("[role='status']")?.textContent).toContain("作品暂时读不到");
    expect(container.textContent).toContain("连不上接口服务");
    unmount();
  });

  it("没有公开作品时显示真实空态", () => {
    const { container, unmount } = render(<HomeFeaturedWorks projects={[]} />);
    expect(container.querySelectorAll(".n1-work")).toHaveLength(0);
    expect(container.textContent).toContain("还没有公开作品");
    unmount();
  });

  it("「我的殿堂」入口显式带 enter-showcase 且 href 正确", () => {
    const { container, unmount } = render(<HomeFeaturedWorks projects={PROJECTS} />);
    const hall = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.getAttribute("href") === "/showcase",
    );
    if (!hall) throw new Error("精选作品缺少「我的殿堂」入口");
    click(hall);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]?.[0]).toMatchObject({
      destination: "/showcase",
      source: "top-nav",
      intent: "enter-showcase",
    });
    unmount();
  });
});

describe("首页归档入口（旧 /#archive 落点）", () => {
  it("id=archive 有真实年份计数与直达归档视图的入口", () => {
    const { container, unmount } = render(<HomeArchiveEntry items={posts} />);
    expect(container.querySelector("#archive"), "旧 /#archive 锚点必须有落点").toBeTruthy();
    const years = [...container.querySelectorAll(".n1-years a")];
    expect(years.length).toBeGreaterThan(0);
    for (const link of years) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/posts?view=archive")).toBe(true);
      expect(href).toContain("#year-");
    }
    const archive = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.getAttribute("href") === "/posts?view=archive",
    );
    expect(archive, "必须有打开归档视图的入口").toBeTruthy();
    unmount();
  });

  it("没有文章时显示真实空态", () => {
    const { container, unmount } = render(<HomeArchiveEntry items={[]} />);
    expect(container.querySelectorAll(".n1-years a")).toHaveLength(0);
    expect(container.textContent).toContain("还没有可归档的文章");
    unmount();
  });
});
