"use client";

/**
 * 内容卡片（08 §3）：服务端验证过的**公开**内容引用，前端只负责渲染成站内链接。
 *
 * 三条硬规则：
  1. `url` 是服务端在写入消息时按当前公开状态解析出来的。前端**不**自己拼路径，
     也不接受模型给的任何 URL —— 这里渲染的只是 `kind` + `id` + 由服务端给出的 url。
  2. 一律用 `SiteLink`（T02 的导航协调器）：裸 `<a href="/…">` 或自己写 onClick
     拦截会让部分跳转退化成整页重载，把音乐打断。
  3. 纯文本渲染，没有 `dangerouslySetInnerHTML`：标题与摘要都来自数据库里的用户/模型内容，
     按不可信输入对待。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import type { Card } from "./types";

const KIND_LABEL: Record<string, string> = {
  post: "文章",
  moment: "图文动态",
  path: "站内入口",
};

export interface ContentCardProps {
  card: Card;
  /** 手机里用 phone-internal（短过渡），独立页用 phone-link。 */
  source?: "phone-internal" | "phone-link";
}

export function ContentCard({ card, source = "phone-link" }: ContentCardProps): ReactNode {
  return (
    <SiteLink className="msg-card" href={card.url} source={source}>
      <span className="msg-card-kind">{KIND_LABEL[card.kind] ?? "站内内容"}</span>
      <span className="msg-card-title">{card.title}</span>
      {card.summary ? <span className="msg-card-summary">{card.summary}</span> : null}
    </SiteLink>
  );
}

export function ContentCardList({
  cards,
  source,
}: {
  cards: readonly Card[];
  source?: ContentCardProps["source"];
}): ReactNode {
  if (cards.length === 0) return null;
  return (
    <ul className="msg-cards">
      {cards.map((card) => (
        <li key={`${card.kind}:${card.id}`}>
          <ContentCard card={card} source={source} />
        </li>
      ))}
    </ul>
  );
}

export { KIND_LABEL };
