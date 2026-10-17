/**
 * 作品展厅视图（T06；验收 5「正常空内容不靠 3D 场景或假统计填充」）。
 *
 * 覆盖：
 *  - 卡片显示真实字段（一句话用途 / 技术栈 / 维护状态）；
 *  - **没有效果图时**给出明确说明，而不是占位图或假统计；
 *  - 「攻略记录」：专题公开时是 `SiteLink`（metaverse-entry），未公开时**不显示标题**；
 *  - 空态不编造作品；
 *  - 列表视图（表格）与卡片视图切换；
 *  - 「加载更多」带 maintenance / cursor 并追加；失败给重试。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectGallery } from "./project-gallery";
import { ProjectReading } from "./project-reading";
import { makeApiProject, makeApiProjectSummary, stubFetch, type FetchStub } from "./test-support";
import type { ProjectDetail, ProjectSummary } from "./types";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

function summary(overrides: Record<string, unknown> = {}): ProjectSummary {
  return makeApiProjectSummary(overrides) as unknown as ProjectSummary;
}

function detail(overrides: Record<string, unknown> = {}): ProjectDetail {
  return makeApiProject(overrides) as unknown as ProjectDetail;
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("ProjectGallery", () => {
  it("渲染卡片：标题 / 一句话用途 / 技术栈 / 维护状态", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[
          summary({
            title: "这个 P5 博客",
            summary: "把静态博客改造成怪盗基地",
            tech_stack: ["Next.js", "FastAPI"],
            maintenance: "maintained",
            maintenance_label: "持续维护",
          }),
        ]}
        initialCursor={null}
        maintenance={null}
      />,
    );
    const card = container.querySelector("[data-project]");
    expect(card?.getAttribute("href")).toBe("/showcase/projects/p5-blog");
    expect(container.textContent).toContain("这个 P5 博客");
    expect(container.textContent).toContain("把静态博客改造成怪盗基地");
    expect(container.textContent).toContain("Next.js");
    expect(container.textContent).toContain("持续维护");
    unmount();
  });

  it("没有效果图时明确说明，不放占位图（也不显示任何统计数字）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[summary({ cover: null })]}
        initialCursor={null}
        maintenance={null}
      />,
    );
    expect(container.textContent).toContain("这件作品还没有效果图");
    expect(container.querySelector("img")).toBeNull();
    // 「不生成奖项或虚构数字」：卡片里没有星数 / 用户数之类的字样。
    expect(container.textContent).not.toMatch(/\d+\s*(人|星|次使用|下载)/);
    unmount();
  });

  it("没有公开专题时不显示攻略记录标题", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[summary({ palace: null })]}
        initialCursor={null}
        maintenance={null}
      />,
    );
    expect(container.textContent).toContain("暂时没有可读的攻略记录");
    unmount();
  });

  it("空态说明不编造成果", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery initialProjects={[]} initialCursor={null} maintenance={null} />,
    );
    expect(container.querySelector("[data-projects-empty]")).not.toBeNull();
    expect(container.textContent).toContain("不会用占位卡片、假统计或虚构奖项填充版面");
    unmount();
  });

  it("服务端读取失败时只显示失败态", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[]}
        initialCursor={null}
        maintenance={null}
        loadError="读取作品失败（HTTP 503）：上游不可用"
      />,
    );
    expect(container.querySelector("[data-projects-error]")).not.toBeNull();
    expect(container.querySelector("[data-projects-empty]")).toBeNull();
    expect(container.textContent).toContain("HTTP 503");
    unmount();
  });

  it("列表视图渲染成表格，且攻略记录列与专题状态一致", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[
          summary({ slug: "a", title: "作品 A", palace: { slug: "p1", title: "专题一", summary: "" } }),
          summary({ slug: "b", title: "作品 B", palace: null }),
        ]}
        initialCursor={null}
        maintenance={null}
      />,
    );
    click(container.querySelector('[data-view="list"]'));
    expect(container.querySelector("[data-project-table]")).not.toBeNull();
    expect(container.querySelectorAll("[data-project-row]")).toHaveLength(2);
    expect(container.textContent).toContain("专题一");
    expect(container.textContent).toContain("暂时没有可读的攻略记录");
    unmount();
  });

  it("「加载更多」带 maintenance 与游标，并追加结果", async () => {
    stub = stubFetch([
      {
        match: "/api/v1/projects",
        body: { items: [makeApiProjectSummary({ slug: "second", title: "第二件" })], next_cursor: null },
      },
    ]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[summary({ slug: "first", title: "第一件" })]}
        initialCursor="cursor-1"
        maintenance="active"
      />,
    );
    click(container.querySelector("[data-load-more]"));
    await advance(30);
    expect(stub.requests).toHaveLength(1);
    const url = stub.requests[0]!.url;
    expect(url).toContain("maintenance=active");
    expect(url).toContain("cursor=cursor-1");
    expect(container.querySelectorAll("[data-project]")).toHaveLength(2);
    unmount();
  });

  it("加载更多失败时给出原因与重试，已显示的作品不消失", async () => {
    stub = stubFetch([{ match: "/api/v1/projects", throws: true }]);
    const { container, unmount } = render(
      <ProjectGallery
        initialProjects={[summary({ slug: "first", title: "第一件" })]}
        initialCursor="cursor-1"
        maintenance={null}
      />,
    );
    click(container.querySelector("[data-load-more]"));
    await advance(400);
    expect(container.querySelectorAll("[data-project]")).toHaveLength(1);
    expect(container.querySelector("[data-load-more-error]")).not.toBeNull();
    unmount();
  });

  it("筛选链接写进 URL（可分享 / 刷新）", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectGallery initialProjects={[]} initialCursor={null} maintenance={null} />,
    );
    expect(container.querySelector('[data-filter="all"]')?.getAttribute("href")).toBe("/showcase");
    expect(container.querySelector('[data-filter="active"]')?.getAttribute("href")).toBe(
      "/showcase?maintenance=active",
    );
    unmount();
  });
});

describe("ProjectReading（作品详情）", () => {
  it("四个分节都渲染；空字段给明确说明而不是隐藏整块", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectReading
        project={detail({
          role: "发起与实现",
          problem: "",
          tradeoffs: "",
          outcomes: "",
        })}
      />,
    );
    expect(container.textContent).toContain("发起与实现");
    expect(container.querySelector('[data-section-empty="problem"]')?.textContent).toContain(
      "还没有写要解决的问题",
    );
    expect(container.querySelector('[data-section-empty="tradeoffs"]')).not.toBeNull();
    expect(container.querySelector('[data-section-empty="outcomes"]')).not.toBeNull();
    unmount();
  });

  it("攻略记录：专题公开时给出 metaverse-entry 链接", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectReading
        project={detail({ palace: { slug: "phantom-base", title: "怪盗据点工程", summary: "" } })}
      />,
    );
    const entry = container.querySelector("[data-guide-entry]");
    expect(entry?.getAttribute("href")).toBe("/apps/metanav/palaces/phantom-base");
    expect(container.textContent).toContain("怪盗据点工程");
    unmount();
  });

  it("攻略记录：专题撤回后不露出隐藏标题", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectReading project={detail({ palace: null, title: "仍然在的作品" })} />,
    );
    expect(container.querySelector("[data-guide-unavailable]")).not.toBeNull();
    expect(container.textContent).not.toContain("隐藏");
    expect(container.textContent).toContain("仍然在的作品");
    unmount();
  });

  it("没有链接时给明确说明；有链接时新标签打开且带 rel=noopener", () => {
    stub = stubFetch([]);
    const without = render(<ProjectReading project={detail({ links: [] })} />);
    expect(without.container.textContent).toContain("还没有公开的仓库或演示地址");
    without.unmount();

    const withLinks = render(
      <ProjectReading
        project={detail({
          links: [{ kind: "repo", label: "GitHub 仓库", url: "https://github.com/ScurryCat/Blogs" }],
        })}
      />,
    );
    const anchor = withLinks.container.querySelector("[data-project-link]");
    expect(anchor?.getAttribute("href")).toBe("https://github.com/ScurryCat/Blogs");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
    withLinks.unmount();
  });

  it("图集只显示非封面图，且每张都有 alt 与真实尺寸", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectReading
        project={detail({
          // 显式指定封面：默认封面用的是另一个 media_id，
          // 不指定的话图集会把「默认封面」也当成一张附图。
          cover: {
            media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            position: 0,
            kind: "cover",
            alt: "效果图",
            caption: "",
            taken_on: null,
            width: 1600,
            height: 900,
            variants: [
              { name: "w640.webp", width: 640, height: 360, bytes: 1, url: "/api/v1/media/a/w640.webp" },
            ],
          },
          images: [
            {
              media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              position: 0,
              kind: "cover",
              alt: "效果图",
              caption: "",
              taken_on: null,
              width: 1600,
              height: 900,
              variants: [
                { name: "w640.webp", width: 640, height: 360, bytes: 1, url: "/api/v1/media/a/w640.webp" },
              ],
            },
            {
              media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              position: 1,
              kind: "evidence",
              alt: "测试输出",
              caption: "全部通过",
              taken_on: null,
              width: 800,
              height: 600,
              variants: [
                { name: "w640.webp", width: 640, height: 480, bytes: 1, url: "/api/v1/media/b/w640.webp" },
              ],
            },
          ],
        })}
      />,
    );
    const figures = [...container.querySelectorAll("[data-figure-media-id]")];
    expect(figures).toHaveLength(1);
    const img = figures[0]?.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("测试输出");
    expect(img?.getAttribute("width")).toBe("800");
    expect(figures[0]?.textContent).toContain("成果证据");
    expect(figures[0]?.textContent).toContain("全部通过");
    unmount();
  });

  it("没有效果图时说明「还没有效果图」，不画占位图", () => {
    stub = stubFetch([]);
    const { container, unmount } = render(
      <ProjectReading project={detail({ cover: null, images: [] })} />,
    );
    expect(container.querySelector(".pls-hero-empty")?.textContent).toContain("还没有效果图");
    expect(container.querySelector("img")).toBeNull();
    unmount();
  });
});

describe("手机模块（PhoneAppModule 形状）", () => {
  it("phone-app 导出 default / screens / dispose，且 screens 只列真的实现的屏", async () => {
    // 变量名不能叫 `module`（Next 的 lint 规则禁止给 module 赋值/遮蔽）。
    const phoneApp = await import("./phone-app");
    expect(typeof phoneApp.default).toBe("function");
    expect(phoneApp.screens).toEqual(["projects", "project", "photos", "album"]);
    expect(typeof phoneApp.dispose).toBe("function");
    // 与 phone-view 的枚举保持同步（改一处忘另一处会让宿主回退桌面屏）。
    const { SHOWCASE_APP_SCREENS } = await import("./phone-view");
    expect([...phoneApp.screens]).toEqual([...SHOWCASE_APP_SCREENS]);
  });

  it("dispose 取消全部在途请求（晚到的响应不写回状态）", async () => {
    const { disposeShowcase, inflightCount, trackRequest } = await import("./inflight");
    const controller = new AbortController();
    const release = trackRequest(controller);
    expect(inflightCount()).toBe(1);
    disposeShowcase();
    expect(controller.signal.aborted).toBe(true);
    expect(inflightCount()).toBe(0);
    release();
  });

  it("slug 校验拒绝任意路径（非法 item 显示「不存在」而不是执行路径）", async () => {
    const { isSlug } = await import("./phone-view");
    expect(isSlug("p5-blog")).toBe(true);
    expect(isSlug("../etc/passwd")).toBe(false);
    expect(isSlug("UPPER")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("中文")).toBe(false);
    expect(isSlug(null)).toBe(false);
  });

  it("清单是 10 字段且图标是仓库里真实存在的资源", async () => {
    const { SHOWCASE_MANIFEST } = await import("./phone-manifest");
    expect(Object.keys(SHOWCASE_MANIFEST).sort()).toEqual(
      [
        "canonical_path",
        "feature_flag",
        "icon",
        "id",
        "kind",
        "loader",
        "name",
        "order",
        "state_version",
        "subtitle",
      ].sort(),
    );
    expect(SHOWCASE_MANIFEST.kind).toBe("embedded");
    expect(SHOWCASE_MANIFEST.canonical_path).toBe("/showcase");
    expect(SHOWCASE_MANIFEST.icon.startsWith("/assets/legacy/img/icon/")).toBe(true);
    // 第三轮任务书 §4.1：殿堂只留作品，副标题从「作品与照片」改为「作品」。
    expect(SHOWCASE_MANIFEST.subtitle).toBe("作品");
  });
});
