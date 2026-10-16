"use client";

/**
 * 一对一角色会话视图（08 §2 / §3 / §5）。
 *
 * 结构：
 *
 * ```text
 * ┌ 角色头部：头像 / 名字 / 「同人 · 非官方」标注 / 重开 · 清除
 * ├ 状态条：剧情已暂停 · AI 降级原因 · 请求错误（纯文本，不隐藏）
 * ├ 消息区：预设剧情气泡 · 访客气泡 · AI 气泡（带 AI 标记）· 内容卡片
 * ├ 选择区：2–3 个预设选项 / 「回到话题」/ 「重新开始」
 * └ 输入区：「自己说一句」→ 展开输入框（首次展开解释会发送什么）
 * ```
 *
 * 与「场景对话」的区别（08 §5）：这里**没有**大立绘与姓名牌，只有头像 + 气泡 + 选择态。
 * 动态页与自由输入的视觉是本站的原创适配，不声称逐像素还原原版。
 *
 * 无障碍与适配：正文 ≥16px、点击区 ≥44px、气泡用 `<ol>` 保持顺序语义、
 * 提示用 `role="status"`、`prefers-reduced-motion` 时滚动瞬时完成。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import { aiBadgeIndices, lastMessageId, type ConversationView as View, type Limits } from "./types";
import type { ConversationController } from "./use-conversation";

export interface ConversationViewProps {
  controller: ConversationController;
  characterName: string;
  characterHandle: string;
  avatar: string;
  avatarAlt: string;
  storyVersion: string;
  limits: Limits | null;
  /** 手机里用 phone-internal，独立页用 phone-link。 */
  linkSource?: "phone-internal" | "phone-link";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ConversationView({
  controller,
  characterName,
  characterHandle,
  avatar,
  avatarAlt,
  storyVersion,
  limits,
  linkSource = "phone-link",
}: ConversationViewProps): ReactNode {
  const { view, phase, notice, pending, draft, setDraft, canSend } = controller;
  const listRef = useRef<HTMLOListElement | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const badges = useMemo(() => (view ? aiBadgeIndices(view.messages) : new Set<number>()), [view]);
  const lastId = view ? lastMessageId(view) : null;

  /**
   * 新消息到达时滚到底部。
   *
   * **只滚消息列表这个容器**，不用 `scrollIntoView` —— 后者会把整个窗口也一起滚下去，
   * 实测结果是「发完一条，整页跳到输入框在顶部、气泡全看不见」。
   * 减少动态效果时瞬时完成（不播放平滑滚动）。
   */
  useEffect(() => {
    if (lastId === null || lastId === lastIdRef.current) return;
    lastIdRef.current = lastId;
    const node = listRef.current;
    if (node === null) return;
    const behaviour: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior: behaviour });
    } else {
      // jsdom 没有实现 Element.scrollTo；真实浏览器永远走上面那条。
      node.scrollTop = node.scrollHeight;
    }
  }, [lastId]);

  const onClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    controller.clear();
  }, [confirmClear, controller]);

  if (phase === "loading") {
    return (
      <div className="msg-app" aria-busy="true">
        <p className="msg-state" role="status">
          正在打开与{characterName}的会话…
        </p>
      </div>
    );
  }

  if (phase === "missing" || view === null) {
    return (
      <div className="msg-app">
        <div className="msg-state" role="status">
          <p className="msg-state-kicker">NO CONVERSATION</p>
          <h2>这段会话现在打不开</h2>
          <p>{controller.error ?? "它可能已经过期。"}</p>
          <button type="button" className="msg-btn" onClick={controller.reload}>
            重新打开
          </button>
        </div>
      </div>
    );
  }

  const { conversation, node, messages, usage } = view;
  const paused = conversation.status === "free";
  const finished = conversation.status === "finished";
  const hasChoices = node !== null && node.choices.length > 0 && !paused && !finished;

  return (
    <div className="msg-app">
      <header className="msg-thread-bar">
        <span className="msg-avatar msg-avatar-lg" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- 固定尺寸的装饰性头像，沿用旧站资源。 */}
          <img src={avatar} alt={avatarAlt} width={48} height={48} />
        </span>
        <div className="msg-thread-id">
          <h2 className="msg-thread-name">{characterName}</h2>
          <p className="msg-thread-handle">@{characterHandle}</p>
          <p className="msg-thread-tags">
            <span className="msg-tag msg-tag-fan">非官方同人</span>
            <span className="msg-tag">剧本 v{storyVersion}</span>
          </p>
        </div>
        <div className="msg-thread-actions">
          <button
            type="button"
            className="msg-btn msg-btn-quiet"
            onClick={controller.restart}
            disabled={pending !== "none"}
          >
            重新开始
          </button>
          <button
            type="button"
            className="msg-btn msg-btn-quiet"
            onClick={onClear}
            disabled={pending !== "none"}
          >
            {confirmClear ? "确认清除？" : "清除记录"}
          </button>
        </div>
      </header>

      {/* 状态条：明确说明当前发生了什么，不做隐晦暗示（08 §7）。 */}
      {notice !== null ? (
        <p
          className={`msg-notice msg-notice-${notice.tone}`}
          role="status"
          data-testid="msg-notice"
        >
          {notice.text}
        </p>
      ) : null}

      {conversation.status === "free" ? (
        <p className="msg-paused" role="status">
          剧情暂停在「{conversation.paused_node_id ?? conversation.node_id}」—— 聊完可以回到刚才的话题。
        </p>
      ) : null}

      <ol className="msg-list" ref={listRef} aria-label={`与${characterName}的消息`}>
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            avatar={avatar}
            avatarAlt={avatarAlt}
            name={characterName}
            showAiBadge={badges.has(index)}
            source={linkSource}
          />
        ))}
      </ol>

      {hasChoices && node !== null ? (
        <div className="msg-choices" role="group" aria-label="预设回复">
          <p className="msg-choices-hint">选择一条回复，或者自己说一句：</p>
          <ul className="msg-choice-list">
            {node.choices.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  className="msg-choice"
                  onClick={() => controller.choose(choice.id)}
                  disabled={pending !== "none"}
                >
                  {choice.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {paused && node !== null && node.resume_text ? (
        <div className="msg-choices">
          <p className="msg-choices-hint">聊完了？回到刚才的话题：</p>
          <button
            type="button"
            className="msg-choice msg-choice-resume"
            onClick={controller.resume}
            disabled={pending !== "none"}
          >
            回到话题
          </button>
        </div>
      ) : null}

      {finished ? (
        <div className="msg-choices">
          <p className="msg-choices-hint">
            这段剧情到这里就结束了。自由聊天只在剧情进行中可用 —— 想继续可以重新开始。
          </p>
          <button
            type="button"
            className="msg-choice"
            onClick={controller.restart}
            disabled={pending !== "none"}
          >
            重新开始这段剧情
          </button>
        </div>
      ) : null}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={controller.send}
        canSend={canSend}
        sending={pending === "sending"}
        maxCodepoints={limits?.input_max_codepoints ?? 1000}
        disabledReason={
          finished
            ? "这段剧情已经结束，自由聊天暂时关闭；重新开始后可以继续聊。"
            : null
        }
      />

      <p className="msg-usage">
        {usage.requests_today === null
          ? `自由聊天每天最多 ${usage.daily_limit} 次`
          : `今天已用 ${usage.requests_today} / ${usage.daily_limit} 次自由聊天`}
        {usage.remaining === 0 ? "（今天的额度已经用完，预设剧情不受影响）" : ""}
      </p>
    </div>
  );
}

export type { View };
