/**
 * 首页摘要：最新文章、精选作品与归档入口（任务书 §2.2）。
 *
 * 首页保留现有主题框架，但**不再复制完整索引**：
 *  - 完整搜索、分类与归档集中到 `/posts`（`features/navigation/posts-view.tsx`）；
 *  - 旧 `/#posts`、`/#archive` 仍有**有意义**的落点：本文件的 `id="posts"` /
 *    `id="archive"` 两个摘要区块，各自带「进入情报档案 / 打开归档」的真实入口，
 *    不出现悬空锚点；
 *  - 「精选作品」只展示 API 真实返回的作品；没有数据或读不到时显示**真实空态**，
 *    不生成占位项目、不编造成绩与数字。
 *
 * 本文件是服务端组件：数据由 `app/page.tsx` 读取后传入，组件本身不发请求。
 */

import type { ReactNode } from "react";

import { type Post } from "@/features/legacy/posts";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { projectImageAlt, projectImageUrl, truncateSummary } from "@/features/showcase/types";
import type { ProjectSummary } from "@/features/showcase/types";

import { PostRow } from "@/features/navigation/post-row";

/** 首页最新文章条数（其余去 `/posts` 看）。 */
export const HOME_LATEST_COUNT = 3;
/** 首页精选作品条数。 */
export const HOME_FEATURED_COUNT = 3;

/**
 * 最新文章摘要。
 *
 * `id="posts"` 是旧站 `index.html#posts` / `/#posts` 的兼容落点：
 * 这里给出最新几篇与「进入情报档案」入口，而不是复制完整搜索页。
 */
export function HomeLatestPosts({
  items,
  limit = HOME_LATEST_COUNT,
}: {
  items: readonly Post[];
  limit?: number;
}): ReactNode {
  const latest = items.slice(0, limit);
  return (
    <section className="shell idx home-sec" id="posts" aria-labelledby="home-posts-h">
      <header className="sec-h">
        <span className="no">02</span>
        <h2 id="home-posts-h">
          <span className="en">Latest Posts</span>
          <span className="cn">最新文章</span>
        </h2>
        <p className="aside" aria-live="polite">
          <b>{latest.length}</b> / {items.length} POSTS
        </p>
      </header>
      {latest.length > 0 ? (
        <ol className="rows">
          {latest.map((post) => (
            <PostRow post={post} key={post.slug} />
          ))}
        </ol>
      ) : (
        <p className="home-empty">还没有公开文章。</p>
      )}
      <p className="home-cta">
        <SiteLink className="btn" href="/posts" source="top-nav">
          <span>进入情报档案 ▸</span>
        </SiteLink>
        <span className="home-hint">完整搜索、分类与归档都在 `/posts`。</span>
      </p>
    </section>
  );
}

/**
 * 精选作品摘要。
 *
 * 没有「精选」标记字段，因此按 API 的公开列表顺序取前几件（真实内容）；
 * `error` 非空时如实说明读不到，**不**伪造作品卡片。
 */
export function HomeFeaturedWorks({
  projects,
  error,
  limit = HOME_FEATURED_COUNT,
}: {
  projects: readonly ProjectSummary[];
  error?: string | null;
  limit?: number;
}): ReactNode {
  const featured = projects.slice(0, limit);
  return (
    <section className="shell home-sec" id="featured-works" aria-labelledby="home-works-h">
      <header className="sec-h">
        <span className="no">04</span>
        <h2 id="home-works-h">
          <span className="en">Showcase</span>
          <span className="cn">精选作品</span>
        </h2>
      </header>
      {error ? (
        <p className="home-empty" role="status">
          作品暂时读不到：{error}。
          <SiteLink href="/showcase" source="top-nav">
            去我的殿堂看看
          </SiteLink>
        </p>
      ) : featured.length === 0 ? (
        <p className="home-empty">
          还没有公开作品。
          <SiteLink href="/showcase" source="top-nav">
            去我的殿堂看看
          </SiteLink>
        </p>
      ) : (
        <ul className="n1-works">
          {featured.map((project) => {
            const cover = project.cover ? projectImageUrl(project.cover) : null;
            return (
              <li className="n1-work" key={project.id}>
                <SiteLink
                  className="n1-work-a"
                  href={`/showcase/projects/${encodeURIComponent(project.slug)}`}
                  source="top-nav"
                  data-project={project.slug}
                >
                  {cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求校验公开引用），next/image 无法代取。 */
                    <img
                      className="n1-work-cover"
                      src={cover}
                      alt={project.cover ? projectImageAlt(project.cover) : ""}
                      width={project.cover?.width ?? 640}
                      height={project.cover?.height ?? 400}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="n1-work-noimg">这件作品还没有效果图</span>
                  )}
                  <span className="n1-work-title">{project.title}</span>
                  {project.summary ? (
                    <span className="n1-work-summary">{truncateSummary(project.summary)}</span>
                  ) : null}
                  {project.tech_stack.length > 0 ? (
                    <span className="n1-work-tech">{project.tech_stack.join(" · ")}</span>
                  ) : null}
                </SiteLink>
              </li>
            );
          })}
        </ul>
      )}
      <p className="home-cta">
        <SiteLink className="btn" href="/showcase" source="top-nav" intent="enter-showcase">
          <span>我的殿堂 ▸</span>
        </SiteLink>
        <span className="home-hint">每件作品只写真实用途、职责与取舍，不列虚构成绩。</span>
      </p>
    </section>
  );
}

/**
 * 归档入口（旧 `/#archive` 的兼容落点）。
 *
 * 这里不复制完整归档列表：按年份给出真实计数，并直达 `/posts?view=archive`。
 */
export function HomeArchiveEntry({ items }: { items: readonly Post[] }): ReactNode {
  const years = [...new Set(items.map((post) => post.date.slice(0, 4)))];
  return (
    <section className="shell home-sec home-archive" id="archive" aria-labelledby="home-arc-h">
      <header className="sec-h">
        <span className="no">05</span>
        <h2 id="home-arc-h">
          <span className="en">Archive</span>
          <span className="cn">归档</span>
        </h2>
      </header>
      {years.length > 0 ? (
        <ul className="n1-years" aria-label="按年份归档">
          {years.map((year) => (
            <li key={year}>
              {/* 直达归档视图里的对应年份（`/posts?view=archive` 由服务端解析）。 */}
              <SiteLink href={`/posts?view=archive#year-${year}`} source="top-nav">
                <b>{year}</b>
                <span>{items.filter((post) => post.date.startsWith(year)).length} 篇</span>
              </SiteLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="home-empty">还没有可归档的文章。</p>
      )}
      <p className="home-cta">
        <SiteLink className="btn red" href="/posts?view=archive" source="top-nav">
          <span>打开归档 ▸</span>
        </SiteLink>
        <span className="home-hint">全部文章按年份排在情报档案的归档视图里。</span>
      </p>
    </section>
  );
}
