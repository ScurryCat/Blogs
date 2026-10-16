/**
 * T06 作品页面的测试替身。
 *
 * 与相册共用同一套 `stubFetch`（`features/gallery/test-support.ts`，同属 T06 的包），
 * 这里只补上作品 DTO 的构造器。
 */

export { stubFetch, flush, vi } from "@/features/gallery/test-support";
export type { FetchStub, RecordedRequest, StubRoute } from "@/features/gallery/test-support";

const MEDIA_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function variants(mediaId: string, width: number, height: number) {
  return [
    {
      name: "w320.webp",
      width: 320,
      height: Math.round((height / width) * 320),
      bytes: 1,
      url: `/api/v1/media/${mediaId}/w320.webp`,
    },
    {
      name: "w640.webp",
      width: 640,
      height: Math.round((height / width) * 640),
      bytes: 2,
      url: `/api/v1/media/${mediaId}/w640.webp`,
    },
  ];
}

/** 与后端 `ProjectImageOut` 同形（16:9 截图）。 */
export function makeApiProjectImage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const mediaId = (overrides.media_id as string) ?? MEDIA_ID;
  const width = (overrides.width as number) ?? 1600;
  const height = (overrides.height as number) ?? 900;
  return {
    media_id: mediaId,
    position: 0,
    kind: "cover",
    alt: "改造后的首页",
    caption: "",
    taken_on: null,
    width,
    height,
    variants: variants(mediaId, width, height),
    ...overrides,
  };
}

/** 与后端 `ProjectSummaryOut` 同形（列表卡片）。 */
export function makeApiProjectSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const slug = (overrides.slug as string) ?? "p5-blog";
  // id 从 slug 派生：否则「加载更多」把两个不同 slug 的样例追加到一起时
  // 会出现重复 key（React 会打印警告并可能漏渲染）。
  const suffix = Buffer.from(slug).toString("hex").padEnd(12, "0").slice(0, 12);
  return {
    id: `33333333-3333-4333-8333-${suffix}`,
    slug,
    title: "这个 P5 博客",
    summary: "把静态博客改造成怪盗基地",
    tech_stack: ["Next.js", "FastAPI"],
    maintenance: "maintained",
    maintenance_label: "持续维护",
    published_at: "2026-10-16T04:00:00Z",
    cover: makeApiProjectImage(),
    palace: null,
    ...overrides,
  };
}

/** 与后端 `ProjectDetailOut` 同形。 */
export function makeApiProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // 默认值必须能被 `overrides` 覆盖：第一版把 `images` / `links` 写在 `...overrides`
  // **之后**，于是它们永远是默认值 —— 测试里看起来像「组件多渲染了一个 figure」。
  return {
    ...makeApiProjectSummary(overrides),
    role: (overrides.role as string) ?? "发起、设计与实现",
    problem: (overrides.problem as string) ?? "旧站是纯静态 HTML，无法发布图文与相册",
    tradeoffs: (overrides.tradeoffs as string) ?? "先做同源 API，不引入 Redis 与任务队列",
    outcomes:
      (overrides.outcomes as string) ??
      "旧站 53 项测试保持通过；新站有真实迁移与浏览器验收",
    links: (overrides.links as unknown[]) ?? [
      { kind: "repo", label: "GitHub 仓库", url: "https://github.com/ScurryCat/Blogs" },
    ],
    images: (overrides.images as unknown[]) ?? [makeApiProjectImage()],
  };
}

export const PROJECT_MEDIA_ID = MEDIA_ID;
