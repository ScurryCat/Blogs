"use client";

/**
 * 手记正文页（独立页 `/apps/journal/<id>` 与手机详情共用）。
 *
 *  - 内容来自公开端点，因此草稿 / 私密记录在这里天然是 404（服务端过滤，不是前端隐藏）；
 *  - `content_md` 用 T02 的 Markdown 视图渲染成 **React 节点树**（没有
 *    `dangerouslySetInnerHTML`，不执行任意 HTML）；
 *  - 图片走公开变体地址（`private, no-store`），原图从不出现在公开页面；
 *  - 关联长文只显示**公开文章**（服务端已过滤），链接用 `SiteLink`（`top-nav`）。
 */

import { useState, type ReactNode } from "react";

import { parseContent } from "@/features/legacy/markdown";
import { MarkdownView } from "@/features/legacy/markdown/view";
import { SiteLink } from "@/features/runtime/navigation/site-link";

import styles from "./journal.module.css";
import { JournalOwnerEditEntry } from "./owner-entry";
import { imageUrl, parseCalendarDate } from "./paths";
import type { JournalEntryDetail } from "./types";

export function EntryReading({ entry }: { entry: JournalEntryDetail }): ReactNode {
  const parts = parseCalendarDate(entry.entry_date);
  // Markdown → React 节点树（`parseContent` 是纯函数，与文章页共用同一套解析器）。
  const parsed = parseContent(entry.content_md ?? "");

  return (
    <article className={styles.reading} data-journal-reading={entry.id}>
      <header className={styles.readingHead}>
        <p className={styles.readingDate}>{parts ? parts.label : entry.entry_date}</p>
        <h1 className={styles.readingTitle}>{entry.title || "（无标题）"}</h1>
        <ul className={styles.cardMeta}>
          {entry.mood ? (
            <li className={`${styles.chip} ${styles.moodChip}`}>心情：{entry.mood}</li>
          ) : null}
          {entry.location ? <li className={styles.chip}>地点：{entry.location}</li> : null}
        </ul>
        {/* 站主快捷入口：仅确认已登录后渲染；普通访客完全看不到。 */}
        <div className={styles.ownerActions} data-owner-actions="journal-reading">
          <JournalOwnerEditEntry entryId={entry.id} />
        </div>
      </header>

      {entry.images.length ? (
        <div className={styles.gallery}>
          {entry.images.map((image) => {
            const url = imageUrl(image);
            if (!url) return null;
            return (
              <ReadingFigure
                key={image.media_id}
                url={url}
                alt={image.alt}
                width={image.width}
                height={image.height}
              />
            );
          })}
        </div>
      ) : null}

      {entry.content_md ? (
        <div className={styles.readingBody}>
          <MarkdownView result={parsed} />
        </div>
      ) : (
        <p className={styles.hint}>这一篇没有正文，只有上面的记录。</p>
      )}

      {entry.post ? (
        <p className={styles.noticeInfo}>
          详细内容在长文里：
          <SiteLink href={`/posts/${encodeURIComponent(entry.post.slug)}`} source="top-nav">
            {entry.post.title}
          </SiteLink>
        </p>
      ) : null}
    </article>
  );
}

/**
 * 正文图片：加载失败时显示可读占位（任务书 §4.3 / §8.3「图片失败要有可理解的显示」）。
 * 独立组件持状态，一张失败不影响同页其他图片。
 */
function ReadingFigure({
  url,
  alt,
  width,
  height,
}: {
  url: string;
  alt: string;
  width: number;
  height: number;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={styles.figure}>
      {failed ? (
        <p className={styles.figureFailed} role="status">
          这张图片加载失败，可能已被撤回。
        </p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 变体地址由 API 给出。
        <img src={url} alt={alt} width={width} height={height} onError={() => setFailed(true)} />
      )}
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  );
}
