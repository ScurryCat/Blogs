/**
 * 首页的静态区块：预告信（最新一篇）与归档。
 * 服务端渲染，不依赖浏览器 API；文章数据由页面从 `readPublishedPosts()` 传入
 * （默认是迁移基线，显式打开 API 数据源后即来自 FastAPI）。
 */

import type { ReactNode } from "react";

import { postPath, type Post } from "@/features/legacy/posts";
import { Calendar } from "@/features/legacy/text/calendar";
import { rn } from "@/features/legacy/text/ransom";
import { Ticker } from "@/features/legacy/text/ticker";
import { SiteLink } from "@/features/runtime/navigation/site-link";

function Tags({ tags }: { tags: readonly string[] }): ReactNode {
  return (
    <span className="tags">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </span>
  );
}

export function HomeTicker(): ReactNode {
  return <Ticker />;
}

/** 预告信 = 最新一篇（`items` 已按日期倒序）。 */
export function CallingCard({ post }: { post: Post | undefined }): ReactNode {
  if (!post) return null;
  const href = postPath(post);
  return (
    <section className="shell cc" id="latest" aria-labelledby="cc-h">
      <header className="sec-h">
        <span className="no">01</span>
        <h2 id="cc-h">
          <span className="en">Calling Card</span>
          <span className="cn">最新</span>
        </h2>
      </header>
      <article className="cc-card on-red">
        <SiteLink className="cc-art" href={href} source="top-nav" tabIndex={-1} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站封面资源。 */}
          <img src={post.cover} alt="" loading="lazy" />
        </SiteLink>
        <div className="cc-body">
          <p className="cc-to">TO: 每一位深夜还在读的人</p>
          <h3 className="cc-t rn">
            <SiteLink href={href} source="top-nav">
              {rn(post.title, 11)}
            </SiteLink>
          </h3>
          <p className="cc-ex">{post.ex}</p>
          <div className="cc-meta">
            <Calendar date={post.date} slot={post.category} />
            <Tags tags={post.tags} />
          </div>
          <p className="cc-sign">— The Phantom Thieves</p>
          <SiteLink className="btn" href={href} source="top-nav">
            <span>Read it ▸ 阅读全文</span>
          </SiteLink>
        </div>
      </article>
    </section>
  );
}

export function ArchiveSection({ items }: { items: readonly Post[] }): ReactNode {
  const years = [...new Set(items.map((post) => post.date.slice(0, 4)))];
  return (
    <section className="shell arc" id="archive" aria-labelledby="arc-h">
      <header className="sec-h">
        <span className="no">03</span>
        <h2 id="arc-h">
          <span className="en">Archive</span>
          <span className="cn">归档</span>
        </h2>
      </header>
      {years.map((year) => (
        <div className="arc-y" key={year}>
          <p className="arc-yr" aria-hidden="true">
            {year}
          </p>
          <ul className="arc-l" aria-label={`${year} 年`}>
            {items
              .filter((post) => post.date.startsWith(year))
              .map((post) => (
                <li key={post.slug}>
                  <SiteLink href={postPath(post)} source="top-nav">
                    <time dateTime={post.date}>{post.date.slice(5).replace("-", ".")}</time>
                    <span>{post.title}</span>
                    <em>{post.category}</em>
                  </SiteLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
