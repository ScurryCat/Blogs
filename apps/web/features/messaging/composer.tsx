"use client";

/**
 * 自由输入区（08 §3 的「自己说一句」）。
 *
 * 三条体验约束都来自 08 §5 与验收要求：
  - 正文 ≥16px、点击区域 ≥44px；
  - **首次展开时**说明输入会发送给模型服务（08 §3），之后不再重复打扰；
  - 输入长度按**码点**计数（与后端 `len()` 一致），超限时明确提示而不是静默截断。
 *
 * 降级时**不清空输入**：AI 不可用 / 额度用尽时，草稿留在框里，用户可以直接再试，
 * 也可以点「回到话题」继续剧情（08 §7）。
 */

import { useCallback, useId, useRef, useState, type ReactNode } from "react";

import { codepointLength } from "./types";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** 当前是否允许发送（在途、剧情结束、AI 停用时为 false）。 */
  canSend: boolean;
  /** 单次输入上限（码点）。 */
  maxCodepoints: number;
  /** 发送中：按钮显示状态并禁用，避免重复点击。 */
  sending: boolean;
  /** 剧情已结束时不显示输入框，只显示原因。 */
  disabledReason?: string | null;
}

export function Composer({
  value,
  onChange,
  onSend,
  canSend,
  maxCodepoints,
  sending,
  disabledReason = null,
}: ComposerProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [explained, setExplained] = useState(false);
  const fieldId = useId();
  const noticeId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const used = codepointLength(value);
  const overLimit = used > maxCodepoints;

  const expand = useCallback(() => {
    setExpanded(true);
    setExplained(true);
    // 展开后把焦点给输入框（键盘用户不必再 Tab 一次）。
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const submit = useCallback(() => {
    if (!canSend || sending || overLimit || used === 0) return;
    onSend();
  }, [canSend, onSend, overLimit, sending, used]);

  if (disabledReason) {
    return (
      <div className="msg-composer msg-composer-disabled">
        <p className="msg-composer-note" role="note">
          {disabledReason}
        </p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="msg-composer">
        <button type="button" className="msg-btn msg-btn-say" onClick={expand}>
          自己说一句
        </button>
      </div>
    );
  }

  return (
    <div className="msg-composer">
      {explained ? (
        <p className="msg-composer-note" id={noticeId}>
          你主动发送后，这条输入与最近几条会话上下文会发送给模型服务；
          预设选项不会发送。这是非官方同人互动，回复由 AI 生成。
        </p>
      ) : null}
      <label className="msg-composer-label" htmlFor={fieldId}>
        想说的话
      </label>
      <textarea
        id={fieldId}
        ref={inputRef}
        className="msg-input"
        value={value}
        rows={3}
        aria-describedby={noticeId}
        aria-invalid={overLimit}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // 中文/日文输入法组合过程中，Enter 只用来确认候选词：
          // 组合中的 Ctrl/Cmd+Enter 也不能当成发送，否则会误发半截拼音或候选字。
          // 229 是部分浏览器在 IME 组合期间给 keyCode 的哨兵值（旧 WebKit）。
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          // Ctrl / Cmd + Enter 发送；单独的 Enter 允许换行（手机上更安全）。
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="msg-composer-actions">
        <p className={`msg-counter${overLimit ? " over" : ""}`}>
          {used} / {maxCodepoints}
          {overLimit ? "（超出上限，请删掉一些）" : ""}
        </p>
        <button
          type="button"
          className="msg-btn msg-btn-send"
          onClick={submit}
          disabled={!canSend || sending || overLimit || used === 0}
        >
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
