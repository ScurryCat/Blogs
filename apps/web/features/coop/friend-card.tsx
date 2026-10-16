"use client";

/**
 * 协助者卡片。
 *
 * 硬规则（都是别的包踩过的坑）：
 *  - 简介与相识故事是**纯文本**，用 React 文本节点渲染，绝不 `dangerouslySetInnerHTML`
 *    （验收第 2 条；T02 已把 Markdown 改成节点树）。
 *  - 外链用 `externalLinkAttributes()` 兜底：地址不合法就**不生成 `<a>`**，
 *    只显示一段说明（`javascript:` / `data:` 永远不会成为可执行外链）。
 *  - 离开本站要在视觉与无障碍上都可辨识：`target="_blank"` + `rel="noopener noreferrer"`
 *    + 可见的「外部 · 新窗口」提示 + 含站点名的 `aria-label`。
 *  - **没有** RANK 等级、进度条、访问次数、在线状态或「最新动态」：本站不存这些数据。
 */

import type { ReactNode } from "react";

import { externalLinkAttributes } from "./urls";
import { FriendAvatar } from "./friend-avatar";
import type { CoopDetailState } from "./use-links";
import type { FriendLinkSummary } from "./types";
import styles from "./coop.module.css";

export interface FriendCardProps {
  link: FriendLinkSummary;
  expanded: boolean;
  detail: CoopDetailState;
  onToggle: (id: string) => void;
  onRetryDetail: () => void;
  /** 标题层级：独立页与手机用 h3，嵌入段用 h4，避免破坏所在页面的标题结构。 */
  headingLevel?: 3 | 4;
}

export function FriendCard({
  link,
  expanded,
  detail,
  onToggle,
  onRetryDetail,
  headingLevel = 3,
}: FriendCardProps): ReactNode {
  const external = externalLinkAttributes(link.url);
  const Heading = headingLevel === 4 ? "h4" : "h3";

  return (
    <article
      className={styles.card}
      data-coop-card="true"
      data-friend-id={link.id}
      data-friend-state={expanded ? "expanded" : "collapsed"}
    >
      <header className={styles.cardHead}>
        <FriendAvatar name={link.name} avatar={link.avatar} />
        <div className={styles.cardTitle}>
          <Heading className={styles.name}>{link.name}</Heading>
          {link.arcana ? (
            <span className={styles.arcana} title="站主给的装饰主题，不是等级">
              {link.arcana}
            </span>
          ) : null}
        </div>
      </header>

      {/* 纯文本：标签之外不做任何富文本解析。 */}
      {link.summary ? <p className={styles.summary}>{link.summary}</p> : null}

      {link.tags.length > 0 ? (
        <ul className={styles.cardTags} aria-label={`${link.name} 的内容标签`}>
          {link.tags.map((tag) => (
            <li key={tag} className={styles.cardTag}>
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.actions}>
        {external ? (
          <a
            className={styles.external}
            href={external.href}
            target={external.target}
            rel={external.rel}
            aria-label={`访问 ${link.name}（外部站点，在新窗口打开）`}
            data-coop-external="safe"
          >
            访问网站
            <span className={styles.externalHint}>外部 · 新窗口</span>
          </a>
        ) : (
          // 地址没通过 http(s) 校验：不生成链接，也不假装能跳转。
          <span className={styles.unsafe} role="note" data-coop-external="blocked">
            地址未通过安全校验，已停止跳转
          </span>
        )}

        {link.has_story ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={`coop-story-${link.id}`}
            onClick={() => onToggle(link.id)}
          >
            {expanded ? "收起相识故事" : "展开相识故事"}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className={styles.story} id={`coop-story-${link.id}`} data-coop-story-state={detail.status}>
          {detail.status === "loading" ? <p role="status">正在读取相识故事…</p> : null}
          {detail.status === "failed" ? (
            <p role="alert">
              {detail.message}
              <button type="button" className={styles.toggle} onClick={onRetryDetail}>
                重试
              </button>
            </p>
          ) : null}
          {detail.status === "ready" ? (
            detail.detail.story ? (
              <p>{detail.detail.story}</p>
            ) : (
              <p>这条友链没有写相识故事。</p>
            )
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
