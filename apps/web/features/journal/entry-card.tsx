"use client";

/**
 * 存档卡（07 §3）：日期、星期、标题、心情、地点、摘要、缩略图。
 *
 * 日期**按字符串渲染**（`parseCalendarDate`），不经过 `new Date(iso)` 再取本地日期 ——
 * 那正是「UTC 转成本地时区后错一天」的来源（验收 2）。
 *
 * 站内链接用 `SiteLink`（T02 的约定：不要自己写 onClick 拦截；冒泡阶段会与 Next 的
 * 全局点击处理抢时序，表现为部分跳转整页重载、音乐被打断）。
 *
 * 结构：`<li>` 是两列网格（日期槽 + `<a>` 主体），因此 `<a>` 里**只放 `<span>`**，
 * 不产生 `div` 套在 `<a>` 里的非法结构，也不会出现「链接里再套链接」。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { imageUrl, entryPath, parseCalendarDate } from "./paths";
import styles from "./journal.module.css";
import type { JournalEntrySummary } from "./types";

export function EntryCard({
  entry,
  onOpen,
}: {
  entry: JournalEntrySummary;
  /** 手机宿主里用 `host.openContent`（来源 `phone-link`）；独立页不传，用默认来源。 */
  onOpen?: (entry: JournalEntrySummary) => void;
}): ReactNode {
  const parts = parseCalendarDate(entry.entry_date);
  const thumbs = entry.images
    .map((image) => ({ image, url: imageUrl(image) }))
    .filter((item): item is { image: (typeof entry.images)[number]; url: string } =>
      Boolean(item.url),
    );

  return (
    <li className={styles.card}>
      <span className={styles.cardDate} aria-hidden="true">
        <span className={styles.cardDay}>{parts ? parts.day : "--"}</span>
        <span className={styles.cardMonth}>
          {parts ? `${parts.year}.${parts.month}` : entry.entry_date}
        </span>
        <span className={styles.cardWeekday}>{parts ? parts.weekday : ""}</span>
      </span>
      <SiteLink
        href={entryPath(entry.id)}
        source={onOpen ? "phone-link" : "top-nav"}
        className={styles.cardBody}
        onClick={(event) => {
          // 保留真实 href（新标签页 / 复制链接 / 无脚本回退都正常）；
          // 只有普通左键交给宿主，修饰键与中键放行给浏览器。
          if (!onOpen) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (event.button !== 0) return;
          onOpen(entry);
        }}
      >
        <span className={styles.cardTitle}>{entry.title || "（无标题）"}</span>
        <span className={styles.cardMeta}>
          {parts ? <span className="sr-only">{parts.label}</span> : null}
          {entry.mood ? (
            <span className={`${styles.chip} ${styles.moodChip}`}>{entry.mood}</span>
          ) : null}
          {entry.location ? <span className={styles.chip}>{entry.location}</span> : null}
          {entry.images.length ? (
            <span className={styles.chip}>{entry.images.length} 张图</span>
          ) : null}
        </span>
        {entry.excerpt ? <span className={styles.cardExcerpt}>{entry.excerpt}</span> : null}
      </SiteLink>
      {thumbs.length ? (
        <ul className={styles.thumbs} aria-label="这篇手记的图片">
          {thumbs.slice(0, 3).map(({ image, url }) => (
            <li key={image.media_id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 变体地址由 API 给出，首版不共享缓存，不用 next/image。 */}
              <img className={styles.thumb} src={url} alt={image.alt} loading="lazy" />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
