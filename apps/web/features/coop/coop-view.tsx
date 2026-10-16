"use client";

/**
 * COOP 主视图：标签筛选、协助者卡片、详情展开与申请入口。
 *
 * 手机内置应用与独立页渲染的是**同一个** `CoopView`，只是宿主不同：
 *  - 独立页把 `tag` / `item` 交给 URL 查询参数（可分享、可刷新、Back 可用）；
 *  - 手机把它交给宿主的 `screen` / `item`（标签筛选是应用内状态，见 phone-app.tsx）。
 *
 * 空态与失败态分开：空态说明「站主还没有公开友链」并给出申请入口；
 * 失败态给出原因与重试，**不把失败伪装成空列表**。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { FriendCard } from "./friend-card";
import { useFriendDetail, useFriendLinks, useFriendTags } from "./use-links";
import styles from "./coop.module.css";

export interface CoopViewProps {
  tag: string | null;
  /** 展开的友链 id；非法值由调用方规整为 null。 */
  item: string | null;
  mode: "site" | "phone";
  onSelectTag: (tag: string | null) => void;
  onSelectItem: (id: string | null) => void;
  /** 嵌入视图（关于页 / INS 资料区）用紧凑标题，不重复整页文案。 */
  compact?: boolean;
  pageSize?: number;
}

export function CoopView({
  tag,
  item,
  mode,
  onSelectTag,
  onSelectItem,
  compact = false,
  pageSize,
}: CoopViewProps): ReactNode {
  const links = useFriendLinks(tag, pageSize);
  const tags = useFriendTags();
  const detail = useFriendDetail(item);
  const items = links.state.status === "ready" ? links.state.items : [];

  return (
    <div
      className={compact ? styles.wrapCompact : styles.wrap}
      data-coop-view={mode}
      data-coop-state={links.state.status}
      data-coop-tag={tag ?? ""}
      data-coop-count={items.length}
    >
      {compact ? null : (
        <header className={styles.head}>
          <p className={styles.kicker}>CONFIDANTS · 协助者</p>
          <h2 className={styles.title}>友链通讯录</h2>
          <p className={styles.lead}>
            这里只放<strong>真实站点</strong>：站主认识的人与常去的地方。角色消息里的双叶、
            摩尔加纳属于同人剧情，不是这里的友链。
          </p>
        </header>
      )}

      {tags.tags.length > 0 ? (
        <ul className={styles.filters} aria-label="按标签筛选">
          <li>
            <button
              type="button"
              className={`${styles.chip} ${tag === null ? styles.chipOn : ""}`}
              aria-pressed={tag === null}
              onClick={() => onSelectTag(null)}
            >
              全部
            </button>
          </li>
          {tags.tags.map((entry) => (
            <li key={entry.normalized}>
              <button
                type="button"
                className={`${styles.chip} ${tag === entry.name ? styles.chipOn : ""}`}
                aria-pressed={tag === entry.name}
                onClick={() => onSelectTag(entry.name)}
              >
                {entry.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {links.state.status === "loading" ? (
        <p className={styles.state} role="status">
          正在读取协助者…
        </p>
      ) : null}

      {links.state.status === "failed" ? (
        <p className={styles.stateError} role="alert">
          {links.state.message}
          <button type="button" className={styles.toggle} onClick={links.reload}>
            重试
          </button>
        </p>
      ) : null}

      {links.state.status === "ready" && items.length === 0 ? (
        <div className={styles.empty} role="status" data-coop-empty="true">
          <p>
            {tag
              ? `没有带「${tag}」标签的已发布友链。`
              : "站主还没有公开任何友链 —— 这里不会用示例条目凑数。"}
          </p>
          <ApplyHint />
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className={styles.grid}>
          {items.map((link) => (
            <li key={link.id}>
              <FriendCard
                link={link}
                headingLevel={compact ? 4 : 3}
                expanded={item === link.id}
                detail={item === link.id ? detail.state : { status: "idle" }}
                onToggle={(id) => onSelectItem(item === id ? null : id)}
                onRetryDetail={detail.retry}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {links.state.status === "ready" && links.state.nextCursor ? (
        <p className={styles.more}>
          <button type="button" className={styles.toggle} onClick={links.loadMore} disabled={links.loadingMore}>
            {links.loadingMore ? "正在读取…" : "读取更多协助者"}
          </button>
          {links.moreError ? <span role="alert">{links.moreError}</span> : null}
        </p>
      ) : null}

      {links.state.status === "ready" && items.length > 0 ? <ApplyHint /> : null}
    </div>
  );
}

/** 申请入口：指向**已有**的留言板与联络方式，不新建匿名自动发布的申请库。 */
export function ApplyHint(): ReactNode {
  return (
    <p className={styles.apply} data-coop-apply="true">
      想交换友链？用现有的联系方式告诉我：
      <SiteLink href="/guestbook" source="phone-link">
        留言板
      </SiteLink>
      <SiteLink href="/about" source="phone-link">
        关于页的联络方式
      </SiteLink>
      审核通过后由站主手动添加，不会自动发布。
    </p>
  );
}
