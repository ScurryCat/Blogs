"use client";

/**
 * 关于页可复用的只读段（`/about` 的第 02 区，目前由 T02 的旧站快照渲染）。
 *
 * 与 COOP 独立页读**同一个**公开接口 `/api/v1/coop/links`（07 §4：两处读同一记录），
 * 因此站主改一条友链，两处同时变；撤回后两处同时消失。
 *
 * 与旧站快照的区别（验收第 3 条）：旧站那 6 张卡是 P5 角色的**示例数据**
 * （地址全指向 github.com、带 RANK 进度条），不是真实朋友。这一段只渲染
 * `friend_links` 里真实存在的记录，并显式说明角色消息是另一回事。
 *
 * 集成方式（T00 决定）：把 `<CoopLinksSection />` 放进 `/about` 的第 02 区，
 * 替换或并列旧的示例卡片；段落样式在 `coop.module.css` 里，不进迁移样式表。
 */

import { useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { COOP_PATH } from "./paths";
import { CoopView } from "./coop-view";
import styles from "./coop.module.css";

export function CoopLinksSection({ limit = 6 }: { limit?: number }): ReactNode {
  // 嵌入段自带筛选状态：不劫持关于页的 URL 参数（独立页才把筛选写进地址）。
  const [tag, setTag] = useState<string | null>(null);
  const [item, setItem] = useState<string | null>(null);

  return (
    <section className={styles.section} aria-labelledby="coop-section-title">
      <header className={styles.sectionHead}>
        <span className={styles.sectionNo}>02</span>
        <h2 id="coop-section-title">
          <span className={styles.sectionEn}>Confidants</span>
          <span className={styles.sectionCn}>真实友链</span>
        </h2>
        <p className={styles.sectionAside}>
          <SiteLink href={COOP_PATH} source="phone-link">
            在 COOP 通讯录里打开
          </SiteLink>
        </p>
      </header>
      <p className={styles.sectionNote}>
        下面每一条都是真实存在的站点，按站主手动排序；没有 RANK 等级，也没有访问量排名。
        角色消息里的双叶、摩尔加纳属于同人剧情，不在这份名单里。
      </p>
      <CoopView
        compact
        mode="site"
        tag={tag}
        item={item}
        onSelectTag={setTag}
        onSelectItem={setItem}
        pageSize={limit}
      />
    </section>
  );
}
