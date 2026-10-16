"use client";

/**
 * INS 应用壳（T03 交付的组合接口，见 `composition.ts`）。
 *
 * 结构（03 §1、08 §2）：
 *
 * ```text
 * INS
 * ├─ 顶部：头像 / 名称 / 简介 + COOP 入口插槽
 * ├─ 页签：动态（内置）· 收藏（内置）· 相册（T06 注入）· 消息（T08 注入）
 * └─ 内容：当前页签
 * ```
 *
 * 硬规则：
 *  - **未接入的页签不显示**：`resolveTabs()` 只输出内置页签与真正注入且
 *    `isAvailable()` 为真的页签，没有「敬请期待」占位按钮（验收用例 5）；
 *  - 消息未接入时**不显示任何在线状态**（不假装在线）；
 *  - 音乐不被本应用重建：这里不创建、不播放任何音频元素（验收用例 6）；
 *  - canonical 页面与手机视图共用这一个壳，因此两处内容一致（03 §1、验收用例 1）。
 */

import { useId, useState, type ReactNode } from "react";

import {
  INS_SAVED_TAB,
  INS_SUBTITLE,
  INS_TITLE,
  resolveTabs,
  type InsProfileSlots,
  type InsTabContribution,
  type InsTabContext,
} from "./composition";
import { SiteLink } from "@/features/runtime/navigation/site-link";

import { SavedView } from "./saved-view";
import type { Moment } from "./types";

export interface InsShellProps {
  /** 当前筛选标签（URL 查询参数）。 */
  tag?: string | null;
  /** 可用标签（已加载动态的并集）。 */
  availableTags?: readonly string[];
  /** 外部页签：T06 相册、T08 消息。未传入就不显示对应页签。 */
  tabContributions?: readonly InsTabContribution[];
  /** 头像区插槽：COOP 入口从这里进。 */
  profile?: InsProfileSlots;
  /** 初始页签（URL 或手机 screen 决定）。 */
  initialTab?: string;
  /** 服务端已经渲染好的第一页（客户端不再重复请求）。 */
  initialFeed?: readonly Moment[];
  initialCursor?: string | null;
  /** 动态页签的渲染函数；手机视图与独立页传入各自的 `FeedView`。 */
  renderFeed: (context: InsTabContext) => ReactNode;
  /** 详情视图（手机里 screen=detail 时使用）；省略时只渲染页签内容。 */
  detail?: ReactNode;
  /** 页面级额外头部（例如「返回手机」）。 */
  headerExtra?: ReactNode;
}

export function InsShell({
  tag = null,
  availableTags = [],
  tabContributions = [],
  profile,
  initialTab,
  initialFeed,
  initialCursor = null,
  renderFeed,
  detail,
  headerExtra,
}: InsShellProps): ReactNode {
  const tabs = resolveTabs(tabContributions);
  const fallback = tabs[0]?.id ?? "feed";
  const [activeTab, setActiveTab] = useState<string>(
    initialTab && tabs.some((tab) => tab.id === initialTab) ? initialTab : fallback,
  );
  const panelId = useId();

  if (detail) {
    return <div className="ins-app">{detail}</div>;
  }

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="ins-app">
      <header className="ins-app-bar">
        <div className="ins-app-title">
          <p className="ins-app-kicker">{"// PHANTOM LOG"}</p>
          <h1>{INS_TITLE}</h1>
          <p className="ins-app-sub">{INS_SUBTITLE}</p>
        </div>
        {headerExtra}
      </header>

      <div className="ins-app-profile">
        <div className="ins-avatar" aria-hidden="true">
          {/* 站点头像沿用旧站已审核素材（本地静态资源，可直接优化）；
              不使用真实 Instagram 商标图标（03 §1）。 */}
          {/* eslint-disable-next-line @next/next/no-img-element -- 尺寸由 CSS 固定为 52×52 的装饰性头像，用原生 <img> 保持与旧站资源路径一致。 */}
          <img src="/assets/legacy/img/icon/joker.webp" alt="" width={52} height={52} />
        </div>
        <div className="ins-app-profile-text">
          <p className="ins-app-name">ScurryCat</p>
          {profile?.bio ?? (
            <p className="ins-app-bio">信息工程在读 · ACM 训练 · 游戏与摄影</p>
          )}
        </div>
        {/* COOP 入口插槽：T07 提供组件后由 T00 接线；未注入时这里什么都不渲染。 */}
        {profile?.coop ? <div className="ins-app-coop">{profile.coop}</div> : null}
      </div>

      <div className="ins-tabbar" role="tablist" aria-label="INS 页签">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${panelId}-${tab.id}`}
            aria-selected={tab.id === active?.id}
            aria-controls={`${panelId}-panel`}
            className={`ins-tab${tab.id === active?.id ? " on" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="ins-panel"
        role="tabpanel"
        id={`${panelId}-panel`}
        aria-labelledby={active ? `${panelId}-${active.id}` : undefined}
      >
        {active?.id === INS_SAVED_TAB ? (
          <SavedView />
        ) : active?.render ? (
          <active.render tag={tag} />
        ) : (
          renderFeed({ tag })
        )}
      </div>

      {/* 相册 / 消息未接入时这里**没有**任何占位说明与坏按钮（验收用例 5）。 */}
      <p className="ins-footnote">
        本应用是本站自己的图文手记，不使用真实 Instagram 登录，也不接入其数据。
        {" "}
        <SiteLink href="/#posts" source="phone-link">长文在博客里</SiteLink>。
      </p>
    </div>
  );
}
