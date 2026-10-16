"use client";

/**
 * INS 资料区的 COOP 快捷入口（插槽：`InsProfileSlots.coop`，由 T03 预留、T00 接线）。
 *
 * 为什么在这里也读一次公开接口：卡片名与「最近在看的站点」必须是**同一份记录**
 * （07 §4：INS 与 COOP 读取同一记录）。这里只取第一页的头两条，不复制正文、
 * 不做第二份缓存；读取失败或还没有公开友链时，退化成一条普通入口链接 ——
 * 不显示空的假卡片，也不显示坏按钮。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { COOP_PATH } from "./paths";
import { useFriendLinks } from "./use-links";
import styles from "./coop.module.css";

export function CoopEntry({ limit = 2 }: { limit?: number }): ReactNode {
  const links = useFriendLinks(null, limit + 1);
  const names =
    links.state.status === "ready" ? links.state.items.slice(0, limit).map((item) => item.name) : [];

  return (
    <div className={styles.entry} data-coop-entry={links.state.status}>
      <SiteLink className={styles.entryLink} href={COOP_PATH} source="phone-internal">
        我的协助者
      </SiteLink>
      {names.length > 0 ? (
        <span className={styles.entryNames}>真实友链：{names.join(" · ")}</span>
      ) : (
        <span className={styles.entryNames}>真实站点友链，不是角色联系人</span>
      )}
    </div>
  );
}
