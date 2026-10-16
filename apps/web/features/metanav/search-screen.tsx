"use client";

/**
 * 普通搜索（04 §6 末）。
 *
 *  - 接受 1–80 个码点的词；多个空格分隔词按**全部命中**处理；
 *  - 搜公开文章与公开殿堂的标题 / 别名 / 标签 / 摘要，**首版不检索草稿**；
 *  - 排名规则由服务端统一决定（`kind` 只用于区分同分），前端不再算一套；
 *  - 结果里的 `href` 是服务端生成的本站地址，前端不自己拼第三方地址；
 *  - 未找到与服务故障是两种反馈。
 */

import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { searchNav } from "./api";
import { classifyFailure, isAbort, validateSearchQuery, type Failure } from "./failure";
import type { MetanavHost } from "./host";
import styles from "./metanav.module.css";
import type { SearchItem } from "./types";

type SearchState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; items: SearchItem[]; nextCursor: string | null; q: string }
  | { status: "failed"; failure: Failure };

const KIND_LABEL: Record<string, string> = { post: "文章", palace: "殿堂" };

function ResultLink({ item, host }: { item: SearchItem; host: MetanavHost }): ReactNode {
  const open = () => {
    // 打开文章是普通站点跳转；进入殿堂才是认知入口（04 §7）。
    const source = item.kind === "palace" ? "metaverse-entry" : "phone-link";
    host.openContent({ destination: item.href, source });
  };
  return (
    <button className={styles.linkButton} type="button" onClick={open}>
      {item.title}
    </button>
  );
}

export function SearchScreen({ host }: { host: MetanavHost }): ReactNode {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"" | "post" | "palace">("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>({ status: "idle" });

  const run = useCallback(
    async (options: { q: string; cursor?: string } = { q: query }) => {
      const validation = validateSearchQuery(options.q);
      setError(validation);
      if (validation) {
        setState({ status: "idle" });
        return;
      }
      setState({ status: "running" });
      try {
        const page = await searchNav({
          q: options.q.trim(),
          kind: kind || undefined,
          cursor: options.cursor,
        });
        setState((previous) => ({
          status: "done",
          q: options.q.trim(),
          nextCursor: page.next_cursor,
          items:
            options.cursor && previous.status === "done"
              ? [...previous.items, ...page.items]
              : page.items,
        }));
      } catch (failure) {
        if (isAbort(failure)) return;
        setState({ status: "failed", failure: classifyFailure(failure) });
      }
    },
    [kind, query],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run({ q: query });
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Search"}</p>
          <h2 className={styles.title}>普通搜索</h2>
          <p className={styles.lead}>
            查公开文章与公开殿堂的标题、别名、标签与摘要。多个词用空格分开，会按「全部命中」处理；
            中文词组按子串匹配，不做分词。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="导航方式">
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("palaces")}>
            已发现殿堂
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("resolve")}>
            认知定位
          </button>
          <button className={styles.tab} type="button" aria-current="true">
            普通搜索
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("mugen")}>
            印象空间
          </button>
        </nav>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="metanav-q">
            搜索词
          </label>
          <input
            className={styles.input}
            id="metanav-q"
            name="q"
            value={query}
            maxLength={80}
            autoComplete="off"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "metanav-q-error" : undefined}
            onChange={(event) => setQuery(event.target.value)}
          />
          {error ? (
            <p className={styles.fieldError} id="metanav-q-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className={styles.field}>
          <span className={styles.label}>范围</span>
          <div className={styles.tabs}>
            {(
              [
                ["", "两者都要"],
                ["post", "只看文章"],
                ["palace", "只看殿堂"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value || "all"}
                className={styles.tab}
                type="button"
                aria-current={kind === value ? "true" : "false"}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.button} type="submit" disabled={state.status === "running"}>
            {state.status === "running" ? "搜索中…" : "搜索"}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {state.status === "failed" ? (
          <div className={styles.empty} role="alert">
            <p>{state.failure.message}</p>
            <p className={styles.hint}>这和「没有找到」不同：服务恢复了再搜一次就会好。</p>
          </div>
        ) : null}

        {state.status === "done" && state.items.length === 0 ? (
          <p className={styles.empty}>
            没有找到与「{state.q}」相关的公开内容。换个词，或者到「印象空间」按分类翻。
          </p>
        ) : null}

        {state.status === "done" && state.items.length ? (
          <>
            <ul className={styles.results} data-results={state.items.length}>
              {state.items.map((item) => (
                <li className={styles.result} key={`${item.kind}:${item.id}`}>
                  <p className={styles.cardTitle}>
                    <span className={styles.badge}>{KIND_LABEL[item.kind] ?? item.kind}</span>
                    <ResultLink item={item} host={host} />
                  </p>
                  {item.excerpt ? <p className={styles.excerpt}>{item.excerpt}</p> : null}
                </li>
              ))}
            </ul>
            {state.nextCursor ? (
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  onClick={() => {
                    void run({ q: state.q, cursor: state.nextCursor ?? undefined });
                  }}
                >
                  继续往下看
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
