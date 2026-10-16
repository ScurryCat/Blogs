/**
 * 公开文章的服务端读取与 DTO 映射（T01 契约 → 本站渲染模型）。
 *
 * 契约来源：`contracts/openapi.json` 的 `/api/v1/posts`（`PostListOut`）与
 * `/api/v1/posts/{slug}`（`PostDetailOut`），字段 snake_case、列表 `{items, next_cursor}`。
 *
 * **本轮的实际渲染来源是迁移基线**（`features/legacy/posts.ts`，8 篇，slug 与正文原样），
 * 原因是两条硬性事实：
 *  1. `API_INTERNAL_URL` 未配置、后端进程未启动时**不能假装接口存在**（README §「先读这几句」）；
 *  2. 列表接口只给摘要，`min`（阅读时长）与正文搜索需要 `content_md`，
 *     只有详情接口才有；把列表页变成 N+1 次详情请求不是迁移该做的决定。
 *
 * 因此这里提供**已按真实 DTO 写好、并被单测覆盖**的读取与映射，
 * 由 `PHANTOM_POSTS_SOURCE=api` 显式打开（默认 `baseline`）。
 * 打开后：读取失败**不静默降级成空列表**，而是返回 `degraded: true` 与原因，
 * 页面据此显示「数据未更新」，而不是把服务错误伪装成「没有文章」（01 §6）。
 */

import { ApiClientError } from "./client";
import { serverApiRequest, serverApiList } from "./server";
import { posts as baselinePosts, type Post } from "@/features/legacy/posts";

if (typeof window !== "undefined") {
  throw new Error("lib/api/posts.ts 只能在服务端使用；浏览器侧请用 lib/api/client.ts");
}

/** `PostSummaryOut`（列表项）。 */
export interface ApiPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  display_date: string | null;
  published_at: string;
  tags: { id: string; slug: string; name: string }[];
  cover: ApiMedia | null;
}

/** `PostDetailOut`（详情）。 */
export interface ApiPostDetail extends ApiPostSummary {
  content_md: string;
}

export interface ApiMedia {
  id: string;
  width: number;
  height: number;
  variants: { name: string; width: number; height: number; bytes: number; url: string }[];
}

export type PostsSource = "baseline" | "api";

export interface PostsReadResult {
  source: PostsSource;
  items: Post[];
  /** 是否显式打开了 API 数据源（`PHANTOM_POSTS_SOURCE=api`）。 */
  apiEnabled: boolean;
  /** 是否处于降级状态（读不到 API 而使用基线）。 */
  degraded: boolean;
  /** 降级原因；`degraded` 为 false 时是 null。 */
  detail: string | null;
}

export interface PostReadResult {
  source: PostsSource;
  post: Post | null;
  apiEnabled: boolean;
  degraded: boolean;
  detail: string | null;
}

/** 取公开变体里最合适的一张；没有变体时返回 null（页面显示占位而不是坏图）。 */
export function coverUrl(media: ApiMedia | null | undefined): string | null {
  if (!media || !media.variants.length) return null;
  const preferred = ["w1280", "w640", "original"];
  for (const name of preferred) {
    const found = media.variants.find((variant) => variant.name === name);
    if (found) return found.url;
  }
  return media.variants[0]?.url ?? null;
}

/**
 * 把 API 详情映射成站点渲染模型。
 * 阅读时长按正文计算（与基线同一套规则，见 `features/legacy/posts.ts`）；
 * `no`（列表序号）由调用方按列表顺序补，映射阶段给 0。
 */
export function toPost(detail: ApiPostDetail, fallback?: Post): Post {
  const content = detail.content_md ?? "";
  const cjk = (content.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (content.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z]+/g) ?? []).length;
  const date = (detail.display_date ?? detail.published_at ?? "").slice(0, 10);
  return {
    slug: detail.slug,
    title: detail.title,
    date,
    category: detail.category,
    tags: detail.tags.map((tag) => tag.name),
    cover: coverUrl(detail.cover) ?? fallback?.cover ?? "",
    excerpt: detail.excerpt,
    content,
    no: fallback?.no ?? 0,
    ex: detail.excerpt || fallback?.ex || "",
    min: Math.max(1, Math.round(cjk / 450 + words / 220)),
    arc: fallback?.arc ?? ["?", detail.category],
  };
}

function isApiSource(): boolean {
  return process.env.PHANTOM_POSTS_SOURCE === "api";
}

function failureDetail(error: unknown): string {
  if (error instanceof ApiClientError) return `API 返回 ${error.status} ${error.code}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 公开文章列表。默认返回迁移基线；显式打开 API 时读 `/api/v1/posts`。 */
export async function readPublishedPosts(): Promise<PostsReadResult> {
  if (!isApiSource()) {
    return {
      source: "baseline",
      items: baselinePosts,
      apiEnabled: false,
      degraded: false,
      detail: "尚未启用 API 数据源（PHANTOM_POSTS_SOURCE=api）；当前显示迁移基线数据。",
    };
  }
  try {
    const page = await serverApiList<ApiPostSummary>("/posts", { limit: 30 });
    const items = page.items.map((summary) => {
      const fallback = baselinePosts.find((post) => post.slug === summary.slug);
      return toPost({ ...summary, content_md: fallback?.content ?? "" }, fallback);
    });
    return { source: "api", items, apiEnabled: true, degraded: false, detail: null };
  } catch (error) {
    return {
      source: "baseline",
      items: baselinePosts,
      apiEnabled: true,
      degraded: true,
      detail: `读取公开文章失败（${failureDetail(error)}）；当前显示迁移基线数据。`,
    };
  }
}

/** 单篇公开文章。`null` 表示 API 明确返回 404 → 页面应给出真正的 404。 */
export async function readPublishedPost(slug: string): Promise<PostReadResult> {
  const fallback = baselinePosts.find((post) => post.slug === slug) ?? undefined;
  if (!isApiSource()) {
    return {
      source: "baseline",
      post: fallback ?? null,
      apiEnabled: false,
      degraded: false,
      detail: "尚未启用 API 数据源（PHANTOM_POSTS_SOURCE=api）；当前显示迁移基线数据。",
    };
  }
  try {
    const detail = await serverApiRequest<ApiPostDetail>(`/posts/${encodeURIComponent(slug)}`);
    return { source: "api", post: toPost(detail, fallback), apiEnabled: true, degraded: false, detail: null };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return { source: "api", post: null, apiEnabled: true, degraded: false, detail: null };
    }
    return {
      source: "baseline",
      post: fallback ?? null,
      apiEnabled: true,
      degraded: true,
      detail: `读取文章失败（${failureDetail(error)}）；当前显示迁移基线数据。`,
    };
  }
}
