"use client";

/**
 * INS 应用视图（客户端壳）。
 *
 * 这是「服务端取数据 → 客户端交互」的接缝：
 *  - 独立页 `app/apps/ins/page.tsx` 在服务端读第一页，把**可序列化**的结果传进来；
 *  - 手机内置视图（`phone-view.tsx`）直接复用 `InsShell` 与同一批组件；
 *  - 因此手机与 canonical 页面展示同一份数据与同一套界面（03 §1、验收用例 1）。
 *
 * 这里不做数据读取：第一页由调用方决定从哪里来（服务端 SSR 或客户端读取），
 * 避免再次出现「同一页请求两次、两份数据不一致」。
 */

import type { ReactNode } from "react";

import { FeedView } from "./feed-view";
import { InsShell } from "./ins-shell";
import type { InsProfileSlots, InsTabContribution } from "./composition";
import type { Moment } from "./types";

export interface InsAppProps {
  tag?: string | null;
  availableTags?: readonly string[];
  initialFeed?: readonly Moment[] | null;
  initialCursor?: string | null;
  /**
   * 服务端读取第一页失败时的原因。
   *
   * 它交给 `FeedView` 作为**初始错误状态**，而不是在壳里再挂一个独立提示：
   * 客户端会自己重试一次，成功之后这个原因必须消失（否则页面上会同时出现
   * 「读取失败」和已经读到内容的卡片 —— 真实浏览器截图抓到过）。
   */
  feedError?: string | null;
  initialTab?: string;
  tabContributions?: readonly InsTabContribution[];
  profile?: InsProfileSlots;
  headerExtra?: ReactNode;
}

export function InsApp({
  tag = null,
  availableTags = [],
  initialFeed = null,
  initialCursor = null,
  feedError = null,
  initialTab,
  tabContributions = [],
  profile,
  headerExtra,
}: InsAppProps): ReactNode {
  // 用 key 让切换标签时整个信息流重新挂载：游标、预览与滚动记忆都从头开始，
  // 与「切换标签必须重置游标」（05 §6）保持一致。
  const feedKey = `feed:${tag ?? "__all__"}`;
  return (
    <InsShell
      tag={tag}
      availableTags={availableTags}
      initialTab={initialTab}
      tabContributions={tabContributions}
      profile={profile}
      headerExtra={headerExtra}
      renderFeed={() => (
        <div key={feedKey}>
          <FeedView
            tag={tag}
            availableTags={availableTags}
            initial={initialFeed ?? undefined}
            initialCursor={initialCursor}
            initialError={feedError}
          />
        </div>
      )}
    />
  );
}
