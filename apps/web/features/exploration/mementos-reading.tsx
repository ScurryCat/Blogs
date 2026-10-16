"use client";

/**
 * 印象空间 · 单条问题记录（`/apps/metanav/mementos/<slug>`）。
 *
 * 结构与 07 §6 的字段一一对应：
 *
 *   问题（`title`）→ 背景（`background`）→ 尝试（`attempts`）→ 结果（`outcome`）
 *   → 验证链接（`evidence_links`）→ 关联文章 / 作品。
 *
 * 三条界面规则：
 *
 *  1. **工作状态与发布状态分开显示**：「已解决」不等于「所有人都能看到」；
 *     页脚明确写出这条记录当前是否已发布，避免站主自己看混。
 *  2. **已解决必须有实际说明**：`outcome` 为空时显示明确的缺项提示，
 *     而不是留一个空标题（服务端已经拒绝这种状态，这里是兜底展示）。
 *  3. **关联内容撤回后整条消失**：服务端不会下发隐藏标题，界面也不补占位；
 *     一条都没有时说明「没有关联的公开内容」，并链接到分类探索。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";
import "@/features/exploration/exploration.css";

import {
  CATEGORY_EXPLORATION_PATH,
  mementosBackHref,
  MEMENTOS_PATH,
} from "./paths";
import {
  evidenceKindLabel,
  isWorkStatus,
  type RecordDetail,
} from "./types";

export interface MementosReadingProps {
  record: RecordDetail;
  /** 返回列表时保留的筛选（从 URL 的 `work_status` 读出，可为 null）。 */
  backWorkStatus?: string | null;
}

export function MementosReading({
  record,
  backWorkStatus = null,
}: MementosReadingProps): ReactNode {
  const back = mementosBackHref(isWorkStatus(backWorkStatus) ? backWorkStatus : null);

  return (
    <article className="pme-wrap" data-record-reading={record.slug}>
      <header className="pme-bar">
        <div>
          <p className="pme-kicker">{"// MEMENTOS"}</p>
          <h1 className="pme-title">{record.title}</h1>
          <p className="pme-lead">
            <span className="pme-badge" data-work-status={record.work_status}>
              {record.work_status_label}
            </span>
            {" "}
            {record.work_status === "resolved" && record.resolved_at
              ? `解决于 ${record.resolved_at.slice(0, 10)}`
              : `记录于 ${record.published_at.slice(0, 10)}`}
          </p>
        </div>
      </header>

      <section className="pme-panel">
        <h2 className="pme-section-title">背景</h2>
        <p className="pme-body" data-record-background="">
          {record.background || "站主还没有补充背景说明。"}
        </p>
      </section>

      <section className="pme-panel">
        <h2 className="pme-section-title">尝试</h2>
        <p className="pme-body" data-record-attempts="">
          {record.attempts || "站主还没有补充尝试过程。"}
        </p>
      </section>

      <section className="pme-panel">
        <h2 className="pme-section-title">
          {record.work_status === "resolved" ? "结果" : "当前结果"}
        </h2>
        {record.outcome ? (
          <p className="pme-body" data-record-outcome="">
            {record.outcome}
          </p>
        ) : (
          <p className="pme-hint" data-record-outcome-missing="">
            {record.work_status === "resolved"
              ? "这条记录标成「已解决」但还没有结果说明。"
              : "还没有结论：这条记录仍在「" + record.work_status_label + "」。"}
          </p>
        )}

        {record.evidence_links.length ? (
          <>
            <h3 className="pme-section-title">验证链接</h3>
            <ul className="pme-links" data-record-evidence="">
              {record.evidence_links.map((link) => (
                <li key={`${link.kind}:${link.url}`}>
                  {/* 站外地址：原生 <a>，不走 SiteLink；schema 只接受 http/https。 */}
                  <a href={link.url} target="_blank" rel="noreferrer noopener">
                    {evidenceKindLabel(link.kind)}：{link.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="pme-hint" data-record-evidence-empty="">
            这条记录没有公开的验证链接 —— 有些问题确实没有可以贴出来的证据，
            这里就如实留空。
          </p>
        )}
      </section>

      <section className="pme-panel">
        <h2 className="pme-section-title">关联内容</h2>
        {record.posts.length === 0 && record.projects.length === 0 ? (
          <p className="pme-hint" data-record-related-empty="">
            没有关联的公开文章或作品。
            {" "}
            <SiteLink href={CATEGORY_EXPLORATION_PATH} source="phone-link">
              按文章分类探索
            </SiteLink>
            也可以找到相关的零散笔记。
          </p>
        ) : (
          <>
            {record.posts.length ? (
              <ul className="pme-links" data-record-posts="">
                {record.posts.map((item) => (
                  <li key={item.id}>
                    {/* 站内链接一律用 SiteLink（不要自己写 onClick 拦截）。 */}
                    <SiteLink href={item.href} source="phone-link">
                      文章：{item.title}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            ) : null}
            {record.projects.length ? (
              <ul className="pme-links" data-record-projects="">
                {record.projects.map((item) => (
                  <li key={item.id}>
                    <SiteLink href={item.href} source="phone-link">
                      作品：{item.title}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <div className="pme-actions">
        <SiteLink className="pme-button pme-button-ghost" href={back} source="phone-link">
          ← 回到问题记录列表
        </SiteLink>
        <SiteLink className="pme-button pme-button-ghost" href={MEMENTOS_PATH} source="phone-link">
          看全部记录
        </SiteLink>
      </div>

      <p className="pme-hint">
        这一页是站主整理的问题日志（不是公开请求板）：状态描述的是站主自己的进度，
        不构成对读者的处理承诺。
      </p>
    </article>
  );
}
