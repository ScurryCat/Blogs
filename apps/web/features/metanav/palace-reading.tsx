/**
 * 专题阅读页的**展示层**（纯组件，服务端与客户端都能渲染）。
 *
 * 结构按 04 §4A：介绍 → 推荐起点 → 有序章节 / 文章 → 相关内容。
 * 每个链接旁显示真实标题，不只显示神秘的章节代号。
 *
 * 它不自己取数据：服务端渲染时数据来自 `API_INTERNAL_URL` 读取，
 * 浏览器侧由 `PalaceReadingLoader` 同源读取后传进来 —— 两条路径共用这一个视图。
 * 链接用 `SiteLink`，因此「进入另一座殿堂」依旧走 `metaverse-entry`，
 * 而直接打开本页（刷新 / 分享 / 历史返回）**不重播**过场（04 §7）。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { PalaceEntryLink } from "./palace-entry-link";
import { formatDate, postPath } from "./paths";
import styles from "./metanav.module.css";
import { KeywordChips } from "./palace-card";
import type { PalaceDetail, PalaceSummary, PostSummary } from "./types";

function Chapter({ post, index }: { post: PostSummary; index: number }): ReactNode {
  return (
    <li className={styles.chapter}>
      <span className={styles.chapterNo}>{`CH.${String(index + 1).padStart(2, "0")}`}</span>
      <span>
        <h3 className={styles.chapterTitle}>
          <SiteLink href={postPath(post.slug)} source="phone-link">
            {post.title}
          </SiteLink>
          {index === 0 ? <span className={styles.recommend}>推荐起点</span> : null}
        </h3>
        <p className={styles.cardMeta}>
          <span>{formatDate(post.display_date ?? post.published_at)}</span>
          <span>{post.category}</span>
          {post.tags.map((tag) => (
            <span key={tag.slug}>#{tag.name}</span>
          ))}
        </p>
        {post.excerpt ? <p className={styles.excerpt}>{post.excerpt}</p> : null}
      </span>
    </li>
  );
}

export function PalaceReading({
  palace,
  related = [],
  onBack,
}: {
  palace: PalaceDetail;
  /** 相关专题（其他公开殿堂），由调用方决定取哪些；没有就整块不显示。 */
  related?: readonly PalaceSummary[];
  /** 手机内渲染时传入：返回由宿主换屏完成，不再跳独立路由（否则手机会被关闭）。 */
  onBack?: () => void;
}): ReactNode {
  const [first, ...rest] = palace.posts;

  return (
    <div className={styles.wrap} data-palace={palace.slug}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Palace · 已进入"}</p>
          <h2 className={styles.title}>{palace.title}</h2>
          <p className={styles.lead}>{palace.summary}</p>
        </div>
        <nav className={styles.actions} aria-label="殿堂操作">
          {onBack ? (
            <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={onBack}>
              回到导航
            </button>
          ) : (
            <SiteLink className={`${styles.button} ${styles.buttonGhost}`} href="/apps/metanav" source="phone-link">
              回到导航
            </SiteLink>
          )}
        </nav>
      </header>

      <p className={styles.cardMeta}>
        <span>{palace.post_count} 篇公开文章</span>
        <span>发布 {formatDate(palace.published_at)}</span>
      </p>
      <KeywordChips palace={palace} />

      {first ? (
        <section className={styles.result} aria-labelledby="metanav-start">
          <p className="kick">{"// Start Here"}</p>
          <h3 className={styles.cardTitle} id="metanav-start">
            推荐起点：{first.title}
          </h3>
          <p className={styles.excerpt}>{first.excerpt}</p>
          <div className={styles.actions}>
            <SiteLink className={styles.button} href={postPath(first.slug)} source="phone-link">
              从这一篇开始
            </SiteLink>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="metanav-chapters">
        <p className="kick">{"// Chapters"}</p>
        <h3 className={styles.cardTitle} id="metanav-chapters">
          章节（按站主维护的顺序）
        </h3>
        {palace.posts.length ? (
          <ol className={styles.chapters}>
            {palace.posts.map((post, index) => (
              <Chapter key={post.slug} post={post} index={index} />
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>这座殿堂暂时没有公开文章。</p>
        )}
      </section>

      {rest.length === 0 && first ? (
        <p className={styles.hint}>
          这一座只关联了一篇文章：站主还没有继续往下写。没有「必须闯关」的下一章。
        </p>
      ) : null}

      {related.length ? (
        <section className={styles.footprint} aria-labelledby="metanav-related">
          <p className="kick">{"// Related"}</p>
          <h3 className={styles.cardTitle} id="metanav-related">
            其他公开殿堂
          </h3>
          <ul className={styles.results}>
            {related.map((item) => (
              <li className={styles.result} key={item.slug}>
                <p className={styles.cardTitle}>
                  <PalaceEntryLink className={styles.linkButton} slug={item.slug} title={item.title}>
                    {item.title}
                  </PalaceEntryLink>
                </p>
                <p className={styles.excerpt}>{item.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
