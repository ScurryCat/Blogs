"use client";

/**
 * 印象空间：按类别深入零散笔记（04 §4C）。
 *
 *  - 使用现有文章分类作为「路径」，每条路径旁有普通中文解释；
 *  - 进入后显示该类的**公开**文章，可继续按标签筛选（分类没有文章时给出空态，
 *    不生成虚构文章来撑满轨道）；
 *  - 「随便深入」只从**当前已加载的公开结果**里挑一条，不伪装成 AI 判断；
 *  - 不按注册、访问天数或等级锁住技术文章。
 */

import { useMemo, useState, type ReactNode } from "react";

import { listPostsByCategory } from "./api";
import type { MetanavHost } from "./host";
import { formatDate, postPath, useLoader } from "./host";
import styles from "./metanav.module.css";
import { MUGEN_PATHS, pickRandom, type MugenPath } from "./mugen";
import type { PostSummary } from "./types";

function PostRow({ post, host }: { post: PostSummary; host: MetanavHost }): ReactNode {
  return (
    <li className={styles.result}>
      <p className={styles.cardTitle}>
        <button
          className={styles.linkButton}
          type="button"
          onClick={() =>
            host.openContent({ destination: postPath(post.slug), source: "phone-link" })
          }
        >
          {post.title}
        </button>
      </p>
      <p className={styles.cardMeta}>
        <span>{formatDate(post.display_date ?? post.published_at)}</span>
        {post.tags.map((tag) => (
          <span key={tag.slug}>#{tag.name}</span>
        ))}
      </p>
      {post.excerpt ? <p className={styles.excerpt}>{post.excerpt}</p> : null}
    </li>
  );
}

function PathDetail({ path, host }: { path: MugenPath; host: MetanavHost }): ReactNode {
  const { state, reload } = useLoader(
    (signal) => listPostsByCategory(path.category, signal),
    [path.category],
  );
  const [tag, setTag] = useState<string | null>(null);

  const posts = useMemo(
    () => (state.status === "ready" ? state.data.items : []),
    [state],
  );
  const tags = useMemo(() => {
    const collected = new Map<string, string>();
    for (const post of posts) for (const item of post.tags) collected.set(item.slug, item.name);
    return [...collected.entries()].map(([slug, name]) => ({ slug, name }));
  }, [posts]);
  const visible = tag ? posts.filter((post) => post.tags.some((item) => item.slug === tag)) : posts;

  return (
    <section className={styles.result} data-path={path.category}>
      <p className="kick">{`// ${path.category}`}</p>
      <h3 className={styles.cardTitle}>
        {path.label} <span className={styles.pathHint}>（{path.hint}）</span>
      </h3>

      {state.status === "loading" ? <p className={styles.hint}>正在读取这一类…</p> : null}

      {state.status === "failed" ? (
        <div role="alert">
          <p>{state.failure.message}</p>
          <button className={styles.button} type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      ) : null}

      {state.status === "ready" && posts.length === 0 ? (
        <p className={styles.empty}>这个分类下还没有公开文章。</p>
      ) : null}

      {posts.length ? (
        <>
          {tags.length ? (
            <div className={styles.tabs} aria-label="按标签筛选">
              <button
                className={styles.tab}
                type="button"
                aria-current={tag === null ? "true" : "false"}
                onClick={() => setTag(null)}
              >
                全部
              </button>
              {tags.map((item) => (
                <button
                  key={item.slug}
                  className={styles.tab}
                  type="button"
                  aria-current={tag === item.slug ? "true" : "false"}
                  onClick={() => setTag(item.slug)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}
          <ul className={styles.results}>
            {visible.map((post) => (
              <PostRow key={post.slug} post={post} host={host} />
            ))}
          </ul>
          {visible.length === 0 ? <p className={styles.hint}>这个标签下暂时没有文章。</p> : null}
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              onClick={() => {
                // 只从当前已加载的公开结果里挑，不假装是 AI 推荐。
                const target = pickRandom(visible);
                if (!target) return;
                host.openContent({ destination: postPath(target.slug), source: "phone-link" });
              }}
            >
              随便深入一篇
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function MugenScreen({ host }: { host: MetanavHost }): ReactNode {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Mementos"}</p>
          <h2 className={styles.title}>印象空间</h2>
          <p className={styles.lead}>
            按类别往下翻，是发现零散文章的另一种路径。这里没有随机迷宫，也没有等级锁：
            所有公开文章都能直接读。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="导航方式">
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("palaces")}>
            已发现殿堂
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("resolve")}>
            认知定位
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("search")}>
            普通搜索
          </button>
          <button className={styles.tab} type="button" aria-current="true">
            印象空间
          </button>
        </nav>
      </header>

      <ul className={styles.paths}>
        {MUGEN_PATHS.map((path) => (
          <li className={styles.path} key={path.category}>
            <span className={styles.pathLabel}>{path.label}</span>
            <span className={styles.pathHint}>{path.hint}</span>
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              aria-expanded={active === path.category}
              onClick={() => setActive(active === path.category ? null : path.category)}
            >
              {active === path.category ? "收起" : "沿这条路径深入"}
            </button>
          </li>
        ))}
      </ul>

      {active ? <PathDetail path={MUGEN_PATHS.find((item) => item.category === active)!} host={host} /> : null}
    </div>
  );
}
