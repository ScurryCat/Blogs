/**
 * 文章行（列表 / 摘要共用）—— 展示型组件，不含任何状态。
 *
 * 首页「最新文章」摘要与 `/posts` 独立索引共用同一份行结构与旧的 `.row` 样式，
 * 不复制两套文章卡片。它被服务端组件（首页摘要）与客户端组件（`/posts` 筛选）
 * 同时引用，因此这里不产生任何浏览器状态。
 */

import type { ReactNode } from "react";

import { postPath, type Post } from "@/features/legacy/posts";
import { Calendar } from "@/features/legacy/text/calendar";
import { SiteLink } from "@/features/runtime/navigation/site-link";

export function Tags({ tags }: { tags: readonly string[] }): ReactNode {
  return (
    <span className="tags">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </span>
  );
}

export function PostRow({ post }: { post: Post }): ReactNode {
  return (
    <li className="row">
      <SiteLink className="row-a" href={postPath(post)} source="top-nav">
        <span className="row-no" aria-hidden="true">
          {String(post.no).padStart(2, "0")}
        </span>
        <span className="row-date">
          <Calendar date={post.date} slot={post.category} />
        </span>
        <span className="row-main">
          <span className="row-cat">
            {post.arc[0]} · {post.arc[1]} · {post.min} MIN
          </span>
          <span className="row-t">{post.title}</span>
          <span className="row-ex">{post.ex}</span>
          <Tags tags={post.tags} />
        </span>
        <span className="row-art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站封面资源。 */}
          <img src={post.cover} alt="" loading="lazy" />
        </span>
      </SiteLink>
    </li>
  );
}
