/**
 * 文章页 `/posts/[slug]`（旧站 `post.html?p=<slug>` + `assets/js/post.js`）。
 *
 * - 正文在**服务端**渲染：Markdown 的对话 / `!!!` 扩展由 `MarkdownView` 输出 React 元素，
 *   不经过 `dangerouslySetInnerHTML`（01 §8）；
 * - 非法 slug 走 `notFound()` → **真正的 404**，不统一跳回首页掩盖错误（01 §5）；
 * - 数据由 `readPublishedPost()` 提供（默认迁移基线；配置后读 FastAPI 详情），
 *   上下篇取自同一来源的列表；
 * - 面包屑、预告信头图、塔罗分类、阅读时长、上下篇与目录都按旧站结构保留。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { MarkdownView } from "@/features/legacy/markdown/view";
import { parseContent } from "@/features/legacy/markdown";
import { PostProgress } from "@/features/legacy/pages/post-progress";
import { postPath, posts as baselinePosts, type Post } from "@/features/legacy/posts";
import { Calendar } from "@/features/legacy/text/calendar";
import { rnP5 } from "@/features/legacy/text/ransom";
import { readPublishedPost, readPublishedPosts } from "@/lib/api/posts";
import { SiteLink } from "@/features/runtime/navigation/site-link";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** 迁移基线的 8 个 slug 在构建期预渲染；API 数据源下新 slug 走按需渲染。 */
export function generateStaticParams(): { slug: string }[] {
  return baselinePosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const read = await readPublishedPost(decodeURIComponent(slug));
  if (!read.post) return { title: "目标不存在" };
  return { title: read.post.title, description: read.post.ex };
}

export default async function PostPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const [read, list] = await Promise.all([readPublishedPost(decoded), readPublishedPosts()]);

  const post = read.post;
  if (!post) notFound();

  const index = list.items.findIndex((item) => item.slug === post.slug);
  const newer: Post | undefined = index > 0 ? list.items[index - 1] : undefined;
  const older: Post | undefined = index >= 0 ? list.items[index + 1] : undefined;

  const parsed = parseContent(post.content);
  const tocItems = parsed.toc.filter((entry) => entry.lv === 2);

  const side = (target: Post | undefined, className: string, label: string): ReactNode =>
    target ? (
      <SiteLink className={className} href={postPath(target)} source="top-nav">
        {/* eslint-disable-next-line @next/next/no-img-element -- 旧站封面资源。 */}
        <img src={target.cover} alt="" loading="lazy" />
        <span>
          <span className="kick">{label}</span>
          <b>{target.title}</b>
        </span>
      </SiteLink>
    ) : (
      <span className="none">{className === "pv" ? "NO OLDER TARGET" : "NO NEWER TARGET"}</span>
    );

  return (
    <>
      {read.apiEnabled && read.degraded ? (
        <p className="data-notice" role="status">
          数据未更新：{read.detail}
        </p>
      ) : null}
      <header className="ph">
        <div className="ph-bg" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站封面资源。 */}
          <img src={post.cover} alt="" />
        </div>
        <div className="shell ph-in">
          <nav className="crumb" aria-label="面包屑">
            <SiteLink href="/" source="top-nav">
              HOME
            </SiteLink>
            <span aria-hidden="true">/</span>
            <SiteLink href="/posts" source="top-nav">
              INTELLIGENCE ARCHIVE
            </SiteLink>
            <span aria-hidden="true">/</span>
            <span>{post.category}</span>
          </nav>
          <div className="ph-card">
            <p className="kick">Calling card · No.{String(post.no).padStart(2, "0")}</p>
            <h1 className="ph-t rnp-t">{rnP5(post.title, post.no * 13)}</h1>
            <div className="ph-meta">
              <Calendar date={post.date} slot={post.category} />
              <span className="tarot" aria-label={`分类 ${post.category}，塔罗 ${post.arc[1]}`}>
                <b aria-hidden="true">{post.arc[0]}</b>
                <span aria-hidden="true">{post.arc[1]}</span>
              </span>
              <span className="read">≈ {post.min} MIN READ</span>
              <span className="tags">
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </span>
            </div>
          </div>
        </div>
      </header>
      <div className="shell post-grid">
        <article className="md" id="article">
          <MarkdownView result={parsed} />
        </article>
        {tocItems.length ? (
          <aside className="toc" aria-label="文章目录">
            <p className="kick">Contents</p>
            <ol>
              {tocItems.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`}>{entry.text}</a>
                </li>
              ))}
            </ol>
          </aside>
        ) : null}
      </div>
      <section className="shell done" aria-label="上下篇">
        <p className="done-t" aria-hidden="true">
          Mission<span>Complete</span>
        </p>
        <nav className="pn" aria-label="更多文章">
          {side(older, "pv", "◂ Older")}
          {side(newer, "nx", "Newer ▸")}
        </nav>
      </section>
      <PostProgress headingIds={tocItems.map((entry) => entry.id)} />
    </>
  );
}
