"use client";

/**
 * 宫殿索引（文章列表 + 搜索 + 标签筛选）—— 旧站 `assets/js/home.js` 的 `idx` 段迁移。
 *
 * 保留：`/` 聚焦搜索框、标签筛选、命中计数、空态、行内日历 / 塔罗编号 / 阅读时长。
 * 监听在卸载时移除（旧站靠 `PL.onLeave` 做同一件事）。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { type Post } from "@/features/legacy/posts";
import { Calendar } from "@/features/legacy/text/calendar";
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

function Row({ post }: { post: Post }): ReactNode {
  return (
    <li className="row">
      <SiteLink className="row-a" href={`/posts/${encodeURIComponent(post.slug)}`} source="top-nav">
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

export function HomePalaceIndex({ items }: { items: readonly Post[] }): ReactNode {
  const tags = useMemo(() => [...new Set(items.flatMap((post) => post.tags))], [items]);
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onSlash = (event: KeyboardEvent) => {
      const element = document.activeElement;
      if (event.key === "/" && !(element instanceof HTMLElement && /INPUT|TEXTAREA/.test(element.tagName))) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (post) =>
        (!tag || post.tags.includes(tag)) &&
        (!needle || `${post.title} ${post.tags.join(" ")} ${post.content}`.toLowerCase().includes(needle)),
    );
  }, [items, query, tag]);

  return (
    <section className="shell idx" id="posts" aria-labelledby="idx-h">
      <header className="sec-h">
        <span className="no">02</span>
        <h2 id="idx-h">
          <span className="en">Palace Index</span>
          <span className="cn">文章</span>
        </h2>
        <p className="aside" aria-live="polite">
          <b id="hit">{hits.length}</b> / {items.length} TARGETS
        </p>
      </header>
      <div className="tools">
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
        <div className="chips" role="group" aria-label="按标签筛选">
          <button
            className="chip"
            type="button"
            data-t=""
            aria-pressed={tag === ""}
            onClick={() => setTag("")}
          >
            <span>
              全部<b>{items.length}</b>
            </span>
          </button>
          {tags.map((item) => (
            <button
              className="chip"
              type="button"
              data-t={item}
              aria-pressed={tag === item}
              key={item}
              onClick={() => setTag(item)}
            >
              <span>
                {item}
                <b>{items.filter((post) => post.tags.includes(item)).length}</b>
              </span>
            </button>
          ))}
        </div>
      </div>
      <ol className="rows" id="rows">
        {hits.length ? (
          hits.map((post) => <Row post={post} key={post.slug} />)
        ) : (
          <li className="empty">
            {/* eslint-disable-next-line @next/next/no-img-element -- 旧站空态插图。 */}
            <img src="/assets/legacy/img/morgana-thief.webp" alt="" loading="lazy" />
            <b>一个目标都没找到</b>
            <span>换个关键词，或者点「全部」。</span>
          </li>
        )}
      </ol>
    </section>
  );
}
