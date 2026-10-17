"use client";

/**
 * 条目卡片（07 §3）：封面、名称、进度、评分、短评、分类型进度、长评链接。
 *
 * 三条验收 3 的展示规则在这里落地：
 *  - **总数未知不算完成率**：`completion_ratio` 是 `null` 时只显示
 *    `episodes_label`（「看到第 6 集」），**不画进度条**、不显示 0%；
 *  - **未评分 ≠ 0 分**：`rating === null` 显示「未评分」；
 *  - **通关 ≠ 全成就**：`completed_on` 与 `all_achievements` 分开显示。
 *
 * 剧透短评默认折叠（07 §3）：`notes_have_spoilers` 为真时先显示遮罩，站主/读者
 * 主动点开才渲染正文。
 */

import { useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import styles from "./leisure.module.css";
import { playtimeLabel, ratingLabel, reviewHref } from "./paths";
import type { LeisureEntry } from "./types";

function bestCoverUrl(entry: LeisureEntry): string | null {
  const variants = entry.cover?.variants ?? [];
  const byName = new Map(variants.map((variant) => [variant.name, variant]));
  for (const name of ["w640.webp", "w320.webp", "w1280.webp"]) {
    const found = byName.get(name);
    if (found) return found.url;
  }
  return variants[0]?.url ?? null;
}

export function EntryCard({ entry }: { entry: LeisureEntry }): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = bestCoverUrl(entry);
  const href = reviewHref(entry.review);
  const spoiler = entry.notes_have_spoilers && entry.notes;

  return (
    <li
      className={styles.card}
      data-leisure-entry={entry.id}
      data-kind={entry.kind}
      // 数据属性而不是只靠视觉：验收要能机械地断言「总数未知时没有完成率」。
      // 取值与后端 `completion_ratio` 一致：`unknown` 表示不计算、不画进度条。
      data-completion={
        entry.anime
          ? entry.anime.completion_ratio === null
            ? "unknown"
            : String(entry.anime.completion_ratio)
          : ""
      }
      data-rated={entry.rating === null ? "unrated" : String(entry.rating)}
    >
      {coverUrl && !coverFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- 变体地址由 API 给出。
        <img
          className={styles.cover}
          src={coverUrl}
          alt={`${entry.title} 的封面`}
          loading="lazy"
          onError={() => setCoverFailed(true)}
        />
      ) : (
        // 封面缺失或加载失败都要有清楚的文字状态（任务书 §4.4）。
        // 用纯文本而不是 role="img"：同页进度条已经用了 role="img"，
        // 再加一个会让「进度条」相关的可访问性断言分不清（实测被测试抓到）。
        <div className={styles.coverEmpty}>NO COVER</div>
      )}

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{entry.title}</h3>

        <ul className={styles.chips}>
          {/* 类型牌：追番 / 游戏（P5 商店列表的分类标签语言）。 */}
          <li className={`${styles.chip} ${styles.kindChip}`} data-leisure-kind={entry.kind}>
            {entry.kind === "anime" ? "追番" : "游戏"}
          </li>
          <li className={`${styles.chip} ${styles.progressChip}`}>{entry.progress_label}</li>
          {entry.anime?.season ? <li className={styles.chip}>{entry.anime.season}</li> : null}
          {entry.anime?.airing ? <li className={styles.chip}>连载中</li> : null}
          {entry.game?.platform ? <li className={styles.chip}>{entry.game.platform}</li> : null}
        </ul>

        {entry.rating === null ? (
          <p className={styles.ratingNone}>{ratingLabel(null)}（没有打分，不是 0 分）</p>
        ) : (
          <p className={styles.rating}>{ratingLabel(entry.rating)}</p>
        )}

        {entry.anime ? (
          <div className={styles.meter}>
            <p className={styles.hint}>{entry.anime.episodes_label}</p>
            {entry.anime.completion_ratio === null ? (
              <p className={styles.hint}>总集数还不确定，因此不显示完成率。</p>
            ) : (
              <div
                className={styles.meterBar}
                role="img"
                aria-label={`已看 ${Math.round(entry.anime.completion_ratio * 100)}%`}
              >
                <span
                  className={styles.meterFill}
                  style={{ width: `${Math.round(entry.anime.completion_ratio * 100)}%` }}
                />
              </div>
            )}
          </div>
        ) : null}

        {entry.game ? (
          <p className={styles.hint}>
            {entry.game.playtime_label}
            {entry.game.completed_on ? ` · 通关 ${entry.game.completed_on}` : ""}
            {entry.game.all_achievements === true
              ? " · 全成就"
              : entry.game.all_achievements === false
                ? " · 还没全成就"
                : " · 未记录全成就"}
          </p>
        ) : null}

        {spoiler ? (
          <div className={styles.spoiler}>
            <p className={styles.hint}>
              这条短评含剧透，默认折叠。
              <button
                className={styles.linkButton}
                type="button"
                aria-expanded={revealed}
                onClick={() => setRevealed((value) => !value)}
              >
                {revealed ? "收起剧透" : "展开剧透"}
              </button>
            </p>
            {revealed ? <p className={styles.spoilerBody}>{entry.notes}</p> : null}
          </div>
        ) : entry.notes ? (
          <p className={styles.notes}>{entry.notes}</p>
        ) : null}

        {href && entry.review ? (
          <p className={styles.hint}>
            长评：
            <SiteLink href={href} source="top-nav">
              {entry.review.title}
            </SiteLink>
          </p>
        ) : null}
      </div>
    </li>
  );
}
