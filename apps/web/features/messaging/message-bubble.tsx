"use client";

/**
 * 一条消息气泡（08 §5「消息页」的视觉语言）。
 *
 * 与「场景对话」区分开（08 §5 第 2 条）：这里**不用**大立绘与姓名牌，
 * 只有头像 + 气泡 + 选择态，符合原版短信/SNS 的层次。
 *
 * 硬规则：
  - 正文是纯文本，绝不用 `dangerouslySetInnerHTML`（模型输出与访客输入都是不可信输入）；
  - **AI 生成的消息必须自带可辨识标记**（08 §1）。一次生成的多个短气泡只在
    第一条上挂标记，避免在 390px 上把正文挤走；
  - `attribution` 是服务端给的来源说明，直接显示，不用图标暗示代替文字。
 */

import type { ReactNode } from "react";

import { ContentCardList } from "./content-card";
import { messageAnchor } from "./paths";
import { bubbleSide, formatTimestamp, type Message } from "./types";

export interface MessageBubbleProps {
  message: Message;
  /** 1:1 会话里对方的头像与名字。 */
  avatar: string;
  avatarAlt: string;
  name: string;
  /** 这一条是否显示 AI 标记（同一次生成只有第一条显示）。 */
  showAiBadge: boolean;
  source?: "phone-internal" | "phone-link";
}

export function MessageBubble({
  message,
  avatar,
  avatarAlt,
  name,
  showAiBadge,
  source,
}: MessageBubbleProps): ReactNode {
  const side = bubbleSide(message);
  const timestamp = formatTimestamp(message.created_at);

  if (side === "note") {
    return (
      <li className="msg-row msg-row-note" id={messageAnchor(message.id)}>
        <p className="msg-note" role="note">
          {message.text}
        </p>
      </li>
    );
  }

  const outgoing = side === "out";
  return (
    <li
      className={`msg-row ${outgoing ? "msg-row-out" : "msg-row-in"}`}
      id={messageAnchor(message.id)}
    >
      {outgoing ? null : (
        <span className="msg-avatar" aria-hidden="true">
          {/* 头像只用仓库内的旧站素材；黑白化由样式表处理（原版短信头像是单色图标）。 */}
          {/* eslint-disable-next-line @next/next/no-img-element -- 固定 40×40 的装饰性头像，沿用旧站资源路径。 */}
          <img src={avatar} alt={avatarAlt} width={40} height={40} />
        </span>
      )}
      <div className="msg-bubble-wrap">
        {outgoing ? null : (
          <p className="msg-sender">
            <span className="msg-sender-name">{name}</span>
            {timestamp ? <span className="msg-time">{timestamp}</span> : null}
          </p>
        )}
        <div className={`msg-bubble ${outgoing ? "msg-bubble-out" : "msg-bubble-in"}`}>
          {/* 纯文本：换行由 CSS 的 white-space 处理，不解析任何标记。 */}
          <p className="msg-text">{message.text}</p>
        </div>
        {message.cards.length > 0 ? (
          <ContentCardList cards={message.cards} source={source} />
        ) : null}
        {outgoing ? (
          <p className="msg-meta">
            <span className="msg-time">{timestamp}</span>
          </p>
        ) : null}
        {showAiBadge && message.is_ai ? (
          <p className="msg-ai-badge">
            <span className="msg-ai-mark" aria-hidden="true">
              AI
            </span>
            {message.attribution || "AI 生成的同人回复"}
          </p>
        ) : null}
      </div>
    </li>
  );
}
