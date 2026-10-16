"use client";

/**
 * 专题卡片与「进入殿堂」入口。
 *
 * 协议要点（04 §7 / SHARED-CONTRACTS §4）：
 *  - **只有明确点击「进入殿堂」才发送 `metaverse-entry`**：打开应用、打字、匹配结果出现
 *    都不发；直接 URL、刷新、历史前进后退也不重播。
 *  - 手机里通过 `host.openContent` 走宿主，独立页用 `SiteLink`（保留真实 href：
 *    新标签页 / 复制链接 / 无脚本回退都正常，Ctrl/Cmd 点击不经过过场）。
 *  - 动画由共享协调器实现，这里**不创建全屏遮罩、不使用地图人群**。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { recordVisit } from "./footprint";
import type { MetanavHost } from "./host";
import { palacePath } from "./host";
import styles from "./metanav.module.css";
import type { PalaceSummary } from "./types";

/**
 * 记一次本机足迹（04 §9）。返回是否真的持久化了；
 * 存储不可用时**不阻止进入**，只提示这次不会被记住。
 */
function remember(host: MetanavHost, palace: { slug: string; title: string }): void {
  const result = recordVisit(host.state, { slug: palace.slug, title: palace.title });
  if (!result.persisted) {
    host.toast("浏览器存储不可用：可以继续进入殿堂，但这次访问不会被记住。");
  }
}

export function KeywordChips({ palace }: { palace: PalaceSummary }): ReactNode {
  const { name, location, cognition } = palace.keywords;
  return (
    <ul className={styles.keywords} aria-label="认知关键词">
      <li className={styles.keywordChip}>
        <b>目标名</b>
        {name}
      </li>
      <li className={styles.keywordChip}>
        <b>现实地点</b>
        {location}
      </li>
      <li className={styles.keywordChip}>
        <b>认知形态</b>
        {cognition}
      </li>
    </ul>
  );
}

/**
 * 「进入殿堂」。独立页渲染成真实链接，手机里渲染成按钮。
 * 两条路径都发送 `metaverse-entry`。
 */
export function EnterPalace({
  palace,
  host,
  label = "进入殿堂",
  className,
}: {
  palace: PalaceSummary;
  host: MetanavHost;
  label?: string;
  className?: string;
}): ReactNode {
  const href = palacePath(palace.slug);

  if (host.mode === "site") {
    return (
      <SiteLink
        className={className ?? styles.button}
        href={href}
        source="metaverse-entry"
        // 记足迹发生在站点导航之前（SiteLink 的 onClick 先于过场与 push）。
        onClick={() => remember(host, palace)}
      >
        {label}
      </SiteLink>
    );
  }

  return (
    <button
      className={className ?? styles.button}
      type="button"
      onClick={() => {
        remember(host, palace);
        host.openContent({ destination: href, source: "metaverse-entry" });
      }}
    >
      {label}
    </button>
  );
}

export function PalaceCard({
  palace,
  host,
  now,
}: {
  palace: PalaceSummary;
  host: MetanavHost;
  now?: string;
}): ReactNode {
  return (
    <article className={styles.card} data-palace={palace.slug}>
      <p className="kick">{"// Palace"}</p>
      <h3 className={styles.cardTitle}>{palace.title}</h3>
      <p className={styles.excerpt}>{palace.summary}</p>
      <KeywordChips palace={palace} />
      <p className={styles.cardMeta}>
        <span>{palace.post_count} 篇公开文章</span>
        <span>{now ?? ""}</span>
      </p>
      <div className={styles.actions}>
        <EnterPalace palace={palace} host={host} />
      </div>
    </article>
  );
}
