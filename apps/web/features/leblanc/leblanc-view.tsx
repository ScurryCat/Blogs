"use client";

/**
 * 勒布朗近况（07 §3「勒布朗：每天回来看看发生了什么」）。
 *
 * 这是一个**可组合视图**：首页 `app/page.tsx` 归 T02，本模块只交付组件 + 一份接线申请
 * （见交付单 §「集成申请」）。当前在 `/apps/leblanc` 有一个可直接访问的独立页，
 * 便于真实浏览器验收与站主自查。
 *
 * ## 硬性要求：一个应用 API 失败不得让音乐或整页消失（验收 5）
 *
 * 因此：
 *  - **每一块各自读取、各自失败**：日记块与放课后块是两个独立的 loader，
 *    互不 await、互不影响；任何一块失败只让那一块显示降级文案，其它块照常渲染；
 *  - 音乐控制读的是根布局里那个**唯一的** `<audio>`（`useAudioSnapshot` +
 *    `useAudioOrDefault`），它不经过任何 API 请求，因此 API 全挂也不会消失；
 *    并且**不自动播放**（验收 5 / 硬规则：不自动开启声音）；
 *  - 装饰性热点（柜台上的手记、桌上的手机、墙上的照片）只是**辅助**：
 *    同一屏必须有带中文标签的普通 `SiteLink`，不要求精确点中小物件；
 *  - 小屏纵向阅读：CSS 用单列网格，桌面两列。
 *
 * 不自动调用 AI、不自动开启声音：本组件没有任何模型调用，也没有 `play()` 的自动触发。
 */

import { type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";
import { useAudioOrDefault, useAudioSnapshot } from "@/features/runtime/audio/audio-service";
import { getCalendar, listAllEntries } from "@/features/journal/api";
import { formatEntryDate } from "@/features/journal/paths";
import type { JournalCalendar, JournalEntrySummary } from "@/features/journal/types";
import { useLoader as useJournalLoader } from "@/features/journal/host";
import { listAllEntries as listLeisure } from "@/features/leisure/api";
import { useLoader as useLeisureLoader } from "@/features/leisure/host";
import { ratingLabel } from "@/features/leisure/paths";
import type { LeisureEntry } from "@/features/leisure/types";

import styles from "./leblanc.module.css";

/** 一句近况。站主手动维护的**真实**文案，不是模型生成（07 §3）。 */
export const CURRENT_STATUS = "在把博客从静态页面改成怪盗基地，顺手记录每天在追什么、玩什么。";

export function LeblancView(): ReactNode {
  return (
    <section className={styles.wrap} aria-label="勒布朗近况">
      <header className={styles.head}>
        <p className="kick">{"// LeBlanc"}</p>
        <h1 className={styles.title}>勒布朗</h1>
        <p className={styles.status}>{CURRENT_STATUS}</p>
      </header>

      {/*
        三个块彼此独立：任何一个失败都不会影响其它块，也不会影响页头、音乐与页脚。
        这正是验收 5 要保证的行为。
      */}
      <div className={styles.grid}>
        <JournalBlock />
        <LeisureBlock kind="anime" />
        <LeisureBlock kind="game" />
        <MusicBlock />
      </div>

      <nav className={styles.links} aria-label="勒布朗里的普通链接">
        <SiteLink href="/apps/journal" source="top-nav">
          看全部手记
        </SiteLink>
        <SiteLink href="/apps/leisure" source="top-nav">
          看追番与游戏
        </SiteLink>
        <SiteLink href="/guestbook" source="top-nav">
          去留言
        </SiteLink>
        <SiteLink href="/apps/metanav" source="top-nav">
          异世界导航
        </SiteLink>
      </nav>

      <p className={styles.footnote}>
        这些入口是普通链接，键盘和屏幕阅读器都能直接用；装饰性的热点只是辅助，
        不需要精确点中场景里的小物件。
      </p>
    </section>
  );
}

/** 最近一篇公开手记（独立读取；失败只降级这一块）。 */
function JournalBlock(): ReactNode {
  const { state, reload } = useJournalLoader(
    (signal) => Promise.all([listAllEntries({}, signal, 1), getCalendar({}, signal)]),
    ["leblanc-journal"],
  );

  return (
    <article className={styles.card} data-leblanc-block="journal">
      <h2 className={styles.cardTitle}>最近的手记</h2>
      {state.status === "loading" ? (
        <p className={styles.degraded} role="status">
          正在读取…
        </p>
      ) : null}
      {state.status === "failed" ? (
        <DegradedBlock message="手记现在读不到，其它内容不受影响。" onRetry={reload} />
      ) : null}
      {state.status === "ready" ? <JournalBody data={state.data} /> : null}
    </article>
  );
}

function JournalBody({
  data,
}: {
  data: [JournalEntrySummary[], JournalCalendar];
}): ReactNode {
  const [entries, calendar] = data;
  const latest = entries[0];
  if (!latest) {
    return <p className={styles.degraded}>还没有公开的手记。</p>;
  }
  return (
    <>
      <p className={styles.meta}>
        {formatEntryDate(latest.entry_date)}
        {latest.mood ? ` · ${latest.mood}` : ""}
        {latest.location ? ` · ${latest.location}` : ""}
      </p>
      <p className={styles.entryTitle}>{latest.title || "（无标题）"}</p>
      {latest.excerpt ? <p className={styles.excerpt}>{latest.excerpt}</p> : null}
      <p className={styles.cardActions}>
        <SiteLink href={`/apps/journal/${encodeURIComponent(latest.id)}`} source="top-nav">
          读这一篇
        </SiteLink>
        <span className={styles.meta}>
          共 {calendar.total_entries} 篇公开手记（按 {calendar.timezone} 计）
        </span>
      </p>
    </>
  );
}

/** 当前追番 / 游戏各一条（两块独立读取，一块失败不影响另一块）。 */
function LeisureBlock({ kind }: { kind: "anime" | "game" }): ReactNode {
  const { state, reload } = useLeisureLoader(
    (signal) => listLeisure(kind, signal, 1),
    [`leblanc-${kind}`],
  );
  const label = kind === "anime" ? "正在追" : "正在玩";

  return (
    <article className={styles.card} data-leblanc-block={kind}>
      <h2 className={styles.cardTitle}>{label}</h2>
      {state.status === "loading" ? (
        <p className={styles.degraded} role="status">
          正在读取…
        </p>
      ) : null}
      {state.status === "failed" ? (
        <DegradedBlock message={`${label}的记录读不到，其它内容不受影响。`} onRetry={reload} />
      ) : null}
      {state.status === "ready" ? <LeisureBody entries={state.data} kind={kind} /> : null}
    </article>
  );
}

function LeisureBody({
  entries,
  kind,
}: {
  entries: LeisureEntry[];
  kind: "anime" | "game";
}): ReactNode {
  // 「正在追 / 正在玩」优先展示进行中的那条；没有就退回最近更新的一条。
  const active =
    entries.find((entry) => entry.progress === (kind === "anime" ? "watching" : "playing")) ??
    entries[0];
  if (!active) {
    return (
      <p className={styles.degraded}>
        还没有公开的{kind === "anime" ? "追番" : "游戏"}记录。
      </p>
    );
  }
  return (
    <>
      <p className={styles.entryTitle}>{active.title}</p>
      <p className={styles.meta}>
        {active.progress_label}
        {active.anime ? ` · ${active.anime.episodes_label}` : ""}
        {active.game ? ` · ${active.game.playtime_label}` : ""}
        {` · ${ratingLabel(active.rating)}`}
      </p>
      {active.notes ? <p className={styles.excerpt}>{active.notes}</p> : null}
      <p className={styles.cardActions}>
        <SiteLink href={`/apps/leisure?screen=${kind}`} source="top-nav">
          看全部{kind === "anime" ? "追番" : "游戏"}
        </SiteLink>
      </p>
    </>
  );
}

/**
 * 现有音乐控制的只读镜像。
 *
 * 它**不发起任何 API 请求**，读的是根布局里的唯一 `<audio>`，因此：
 *  - 任何应用 API 失败都不会让这一块消失；
 *  - 不会创建第二个播放器，也不会自动播放（用户必须自己点）。
 */
function MusicBlock(): ReactNode {
  const audio = useAudioOrDefault();
  const snapshot = useAudioSnapshot();

  const state = snapshot.empty ? "empty" : snapshot.unavailable ? "unavailable" : "ready";

  return (
    <article className={styles.card} data-leblanc-block="music" data-music-state={state}>
      <h2 className={styles.cardTitle}>音乐</h2>
      {state === "empty" ? (
        <p className={styles.degraded}>还没有曲子。</p>
      ) : state === "unavailable" ? (
        <p className={styles.degraded}>音频现在取不到（清单里有曲子，但文件读不出来）。</p>
      ) : (
        <>
          <p className={styles.entryTitle}>{snapshot.title}</p>
          <p className={styles.meta}>
            {snapshot.artist ? `${snapshot.artist} · ` : ""}
            {Math.round(snapshot.volume * 100)}% 音量
          </p>
          <p className={styles.cardActions}>
            <button
              className={styles.button}
              type="button"
              onClick={() => audio.toggle()}
              // 不自动播放：只有站主/访客自己点才会出声。
              data-music-toggle="leblanc"
            >
              {snapshot.playing ? "暂停" : "播放"}
            </button>
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              onClick={() => audio.next()}
            >
              下一首
            </button>
          </p>
        </>
      )}
    </article>
  );
}

function DegradedBlock({ message, onRetry }: { message: string; onRetry: () => void }): ReactNode {
  return (
    <div role="status">
      <p className={styles.degraded}>{message}</p>
      <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}
