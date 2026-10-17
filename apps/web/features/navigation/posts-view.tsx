"use client";

/**
 * `/posts` 独立文章索引（任务书 §2.2）：搜索、分类、归档三件事集中在这里。
 *
 * - 数据由服务端页面用现有链路（`readPublishedPosts()`）读好后传入，不退回旧静态文章；
 * - `?view=archive` 由服务端页面解析成 `initialView`，因此归档视图可直接分享 / 刷新；
 * - 视图切换只改地址栏（`history.replaceState`），不重新请求、不丢筛选；
 * - 分类按文章的塔罗分类（`post.category`），搜索覆盖标题 / 标签 / 正文，与旧首页索引一致；
 * - 空态显示真实「没有命中」，不生成占位文章。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { type Post } from "@/features/legacy/posts";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { PostRow } from "@/features/navigation/post-row";

export type PostsViewMode = "list" | "archive";

export interface PostsViewProps {
  items: readonly Post[];
  /** 由 `/posts?view=archive` 解析得到；缺省为列表视图。 */
  initialView?: PostsViewMode;
  /** 数据源降级说明（API 打开但读取失败）；无降级为 null。 */
  degraded?: string | null;
}

/** 分类计数：按文章出现顺序（数据已按日期倒序），稳定可预期。 */
function categoryOptions(items: readonly Post[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of items) counts.set(post.category, (counts.get(post.category) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

function filterPosts(
  items: readonly Post[],
  query: string,
  category: string | null,
): Post[] {
  const needle = query.trim().toLowerCase();
  return items.filter((post) => {
    if (category && post.category !== category) return false;
    if (!needle) return true;
    return `${post.title} ${post.tags.join(" ")} ${post.content}`.toLowerCase().includes(needle);
  });
}

/** 归档视图：按年份分组（与旧首页归档同一套标记与样式）。 */
function ArchiveView({ items }: { items: readonly Post[] }): ReactNode {
  const years = [...new Set(items.map((post) => post.date.slice(0, 4)))];
  return (
    <div className="arc pv-archive">
      {years.map((year) => (
        <div className="arc-y" id={`year-${year}`} key={year}>
          <p className="arc-yr" aria-hidden="true">
            {year}
          </p>
          <ul className="arc-l" aria-label={`${year} 年`}>
            {items
              .filter((post) => post.date.startsWith(year))
              .map((post) => (
                <li key={post.slug}>
                  <SiteLink href={`/posts/${encodeURIComponent(post.slug)}`} source="top-nav">
                    <time dateTime={post.date}>{post.date.slice(5).replace("-", ".")}</time>
                    <span>{post.title}</span>
                    <em>{post.arc[1] || post.category}</em>
                  </SiteLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function PostsView({
  items,
  initialView = "list",
  degraded = null,
}: PostsViewProps): ReactNode {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // 视图 = 本地手动切换的覆盖值；没有覆盖时以服务端解析的 `?view=` 为准。
  // 这样直接访问 /posts?view=archive、刷新或前进后退都回到正确视图，且不需要
  // 在 effect 里同步 prop（避免级联渲染）。
  const [viewOverride, setViewOverride] = useState<PostsViewMode | null>(null);
  const view: PostsViewMode = viewOverride ?? initialView;
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `/` 聚焦搜索框（沿用旧首页索引的键盘行为）。
  useEffect(() => {
    const onSlash = (event: KeyboardEvent) => {
      const element = document.activeElement;
      if (
        event.key === "/" &&
        !(element instanceof HTMLElement && /INPUT|TEXTAREA/.test(element.tagName))
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  const categories = useMemo(() => categoryOptions(items), [items]);
  const hits = useMemo(() => filterPosts(items, query, category), [items, query, category]);

  /** 切换视图：只更新地址栏（可分享、可刷新），不重新请求数据。 */
  const switchView = (next: PostsViewMode) => {
    setViewOverride(next);
    if (typeof window === "undefined") return;
    const href = next === "archive" ? "/posts?view=archive" : "/posts";
    window.history.replaceState(window.history.state, "", href);
  };

  return (
    <>
      {degraded ? (
        <p className="data-notice" role="status">
          数据未更新：{degraded}
        </p>
      ) : null}
      <header className="sec-h">
        <span className="no">02</span>
        <h1 id="posts-h">
          <span className="en">Intelligence Archive</span>
          <span className="cn">情报档案</span>
        </h1>
        <p className="aside" aria-live="polite">
          <b>{hits.length}</b> / {items.length} TARGETS
        </p>
      </header>
      <p className="pv-lead">
        完整文章索引：搜索标题 / 标签 / 正文，按塔罗分类筛选；归档视图按年份排列。
        首页只保留摘要，长期查找从这里开始。
      </p>

      <div className="pv-bar">
        <label className="search">
          <span className="sr-only">搜索文章</span>
          <input
            ref={inputRef}
            id="q"
            type="search"
            placeholder="搜索标题 / 标签 / 正文"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div className="pv-tabs" role="group" aria-label="切换文章视图">
          <button
            className="pv-tab"
            type="button"
            aria-pressed={view === "list"}
            onClick={() => switchView("list")}
          >
            <span>列表</span>
          </button>
          <button
            className="pv-tab"
            type="button"
            aria-pressed={view === "archive"}
            onClick={() => switchView("archive")}
          >
            <span>归档</span>
          </button>
        </div>
      </div>

      <div className="chips" role="group" aria-label="按分类筛选">
        <button
          className="chip"
          type="button"
          aria-pressed={category === null}
          onClick={() => setCategory(null)}
        >
          <span>
            全部<b>{items.length}</b>
          </span>
        </button>
        {categories.map((item) => (
          <button
            className="chip"
            type="button"
            aria-pressed={category === item.name}
            key={item.name}
            onClick={() => setCategory(item.name)}
          >
            <span>
              {item.name}
              <b>{item.count}</b>
            </span>
          </button>
        ))}
      </div>

      {hits.length === 0 ? (
        <div className="empty">
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站空态插图。 */}
          <img src="/assets/legacy/img/morgana-thief.webp" alt="" loading="lazy" />
          <b>一个目标都没找到</b>
          <span>换个关键词，或者点「全部」。</span>
        </div>
      ) : view === "archive" ? (
        <ArchiveView items={hits} />
      ) : (
        <ol className="rows">
          {hits.map((post) => (
            <PostRow post={post} key={post.slug} />
          ))}
        </ol>
      )}
    </>
  );
}
