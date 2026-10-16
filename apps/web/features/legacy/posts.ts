/**
 * 文章数据与派生字段。
 *
 * 正文原文是权威数据：`data/posts.json` 由 `tools/legacy-migration/migrate.mjs`
 * 从旧站 `assets/js/posts.js` 逐字转出（8 篇，slug 全部保留，正文 Markdown 一字未改）。
 * 这里复刻旧站 `assets/js/core.js` 的派生规则：排序、摘要、阅读时长、塔罗分类、
 * 文章编号 —— 换了渲染器也不该让列表编号或摘要发生变化。
 *
 * 边界（01 §2 / T01 集成点）：公开文章的**权威来源最终是 FastAPI**。
 * 本文件是迁移期的基线数据，`lib/api/posts.ts` 在服务端优先读 API，
 * 读不到时退回这里，并在交付单登记联调状态。
 */

import { arcanaOf, site } from "./config";
import postsJson from "./data/posts.json";

export interface RawPost {
  slug: string;
  title: string;
  date: string;
  category: string;
  tags: string[];
  cover: string;
  excerpt: string;
  content: string;
}

export interface Post extends Omit<RawPost, "cover"> {
  cover: string;
  /** 列表里的序号（最新的一篇号码最大），与旧站 `no` 一致。 */
  no: number;
  /** 摘要：配置的 excerpt，或正文第一段纯文本，超过 96 字截断。 */
  ex: string;
  /** 阅读时长（分钟，四舍五入，至少 1）。 */
  min: number;
  /** 塔罗分类 [编号, 名称]。 */
  arc: [string, string];
}

/** 去掉 Markdown 标记，得到纯文本（旧站 `PL.strip`）。 */
export function stripMarkdown(input: string): string {
  return input
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*|__|\*/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
}

const BLOCK_START = /^(#|>|\||!!!|```|[-*]\s|\d+\.\s)/;

function firstParagraph(content: string): string {
  return content.split("\n").find((line) => line.trim() && !BLOCK_START.test(line)) ?? "";
}

function readingMinutes(content: string): number {
  const cjk = (content.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (content.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z]+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 450 + words / 220));
}

export const posts: Post[] = [...(postsJson as RawPost[])]
  .sort((a, b) => (a.date < b.date ? 1 : -1))
  .map((post, index, all) => {
    const excerpt = post.excerpt || stripMarkdown(firstParagraph(post.content));
    return {
      ...post,
      cover: `/assets/legacy/${post.cover.replace(/^assets\//, "")}`,
      tags: [...post.tags],
      no: all.length - index,
      ex: excerpt.length > 96 ? excerpt.slice(0, 94) + "…" : excerpt,
      min: readingMinutes(post.content),
      arc: arcanaOf(post.category),
    };
  });

export function findPost(slug: string): Post | null {
  return posts.find((post) => post.slug === slug) ?? null;
}

/** 文章的 canonical 路径（旧站是 `post.html?p=<slug>`，新站是 `/posts/<slug>`）。 */
export function postPath(post: Pick<Post, "slug">): string {
  return `/posts/${encodeURIComponent(post.slug)}`;
}

/** 宫殿索引的标签去重顺序：沿用旧站出现顺序。 */
export function allTags(): string[] {
  return [...new Set(posts.flatMap((post) => post.tags))];
}

export function tagCount(tag: string): number {
  return posts.filter((post) => post.tags.includes(tag)).length;
}

export function archiveYears(): string[] {
  return [...new Set(posts.map((post) => post.date.slice(0, 4)))];
}

/** 站点里的列表 / 归档都按年份分组。 */
export function postsInYear(year: string): Post[] {
  return posts.filter((post) => post.date.startsWith(year));
}

export const siteConfig = site;
