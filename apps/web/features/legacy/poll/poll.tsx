"use client";

/**
 * 问卷 HUD —— 旧站 `assets/js/poll.js` 的 React 迁移（权威状态 9aa6a83）。
 *
 * **样式与语义完全保留**：DOM 结构、类名与 `poll.css` 一一对应，因此
 * 半透明底板、斜四边形票数框、百分比整数 / 小数的分列字号都不变；
 * `base`（73 : 927）仍是配置里的设定值，界面上永远标注「本地展示 · 非全站统计」。
 *
 * 迁移差别（都在所有权层面，不改外观与语义）：
 *  - 旧实现自己 `document.createElement` + `appendChild`，这里由 React 渲染；
 *  - 旧实现用 `PL.onLeave` 在 PJAX 换页时销毁内嵌实例，这里由 React 卸载即清理；
 *  - Escape 关闭浮层改由 OverlayManager 统一排队（不再各自挂 document 监听）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { site } from "../config";
import {
  browserStorage,
  createStore,
  formatPercent,
  normalize,
  type PollConfig,
  type PollState,
  type PollStore,
} from "./model";
import { useOverlay, useOverlayManager } from "@/features/runtime/overlay-manager";

/** 问卷规则是纯逻辑：存储不可用时用内存，交互仍能完成。 */
let sharedStore: PollStore | null = null;
export function getPollStore(): PollStore {
  if (!sharedStore) sharedStore = createStore(browserStorage());
  return sharedStore;
}

/** 按问卷 id 订阅状态；同一题的多份实例会一起更新。 */
export function usePollState(config: PollConfig): PollState {
  const [state, setState] = useState<PollState>({ seen: false, vote: null });
  useEffect(() => {
    const store = getPollStore();
    // 首帧渲染「未投票」的确定性结果（服务端与客户端一致），
    // 挂载后的下一帧再同步本机记录，避免水合不一致与级联渲染。
    const frame = window.requestAnimationFrame(() => setState(store.get(config)));
    const unsubscribe = store.subscribe(config.id, setState);
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [config]);
  return state;
}

function highlighted(text: string, phrases: readonly string[], keyPrefix: string): ReactNode[] {
  const words = [...new Set(phrases)].sort((a, b) => b.length - a.length);
  const nodes: ReactNode[] = [];
  let offset = 0;
  let serial = 0;
  while (offset < text.length) {
    let next = text.length;
    let match = "";
    for (const word of words) {
      const index = text.indexOf(word, offset);
      if (index !== -1 && index < next) {
        next = index;
        match = word;
      }
    }
    if (next > offset) nodes.push(text.slice(offset, next));
    if (!match) break;
    serial += 1;
    nodes.push(
      <strong className="poll-highlight" key={`${keyPrefix}-h${serial}`}>
        {match}
      </strong>,
    );
    offset = next + match.length;
  }
  return nodes;
}

/** 装饰性 Q：与旧站同一份路径数据，`aria-hidden`。 */
function QDecoration(): ReactNode {
  return (
    <svg className="poll-q" viewBox="-4 -8 166 212" aria-hidden="true" focusable="false">
      <path
        fill="#fff"
        stroke="#030303"
        strokeWidth={13}
        paintOrder="stroke fill"
        fillRule="evenodd"
        d="M88 2C43-3 15 31 7 79C-1 128 15 168 53 177C68 181 84 181 99 176L127 194L151 165L124 146C143 121 149 92 140 60C132 27 114 5 88 2ZM82 43C65 40 53 52 47 74C40 98 43 122 56 131C64 137 73 137 80 133L68 124L86 96L102 109C107 98 110 86 107 73C103 55 94 45 82 43Z"
      />
    </svg>
  );
}

/** 标题「怪盗 ch」的四块独立构图；其他标题按普通文本渲染。 */
function PollTitle({ title }: { title: string }): ReactNode {
  if (title !== "怪盗ch") return <p className="poll-title">{title}</p>;
  return (
    <p className="poll-title" aria-label={title}>
      {["怪", "盗", "c", "h"].map((letter, index) => (
        <span className={`poll-tile poll-tile--${index}`} aria-hidden="true" key={index}>
          {letter}
        </span>
      ))}
    </p>
  );
}

export interface PollProps {
  config: PollConfig;
  mode: "inline" | "floating";
  /** 退场中：加 `is-closing`（旧站同名类）并置 `inert`，让淡出可见但不可交互。 */
  closing?: boolean;
  /** 浮层关闭（含键盘 Escape / 关闭按钮）。 */
  onRequestClose?: (keyboard: boolean) => void;
}

export function Poll({ config, mode, closing = false, onRequestClose }: PollProps): ReactNode {
  const store = getPollStore();
  const state = usePollState(config);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const lastVote = useRef<string | null>(state.vote);

  // 票数 = 配置基准 + 本机那一票，直接算即可（不为 useMemo 造依赖）。
  const tally = store.tally(config);
  const percent = formatPercent(tally.pct[config.main] ?? 0);
  const [whole, fraction] = percent.slice(0, -1).split(".");
  const mainOption = config.options.find((option) => option.value === config.main);
  const voteValue = state.vote;

  useEffect(() => {
    // 投票完成后把焦点移到 aria-live 区域一次（旧站行为），不在渲染期做副作用。
    if (voteValue && !lastVote.current) statusRef.current?.focus({ preventScroll: true });
    lastVote.current = voteValue;
  }, [voteValue]);

  const status = voteValue
    ? `已记下你这一票：${config.options.find((option) => option.value === voteValue)?.label ?? ""}`
    : "";

  return (
    <section
      className={`poll poll--${mode}${closing ? " is-closing" : ""}`}
      data-poll-id={config.id}
      aria-labelledby={`${config.id}-question`}
      aria-describedby={`${config.id}-note`}
      inert={closing}
    >
      <div className="poll-panel">
        <QDecoration />
        <div className="poll-intro">
          <PollTitle title={config.title} />
          <p className="poll-question" id={`${config.id}-question`}>
            {highlighted(config.question, config.questionHighlight, "q")}
          </p>
        </div>
        <div
          className="poll-result"
          role="img"
          aria-label={`${mainOption?.label ?? ""}：${percent}。本地展示，非全站统计`}
        >
          <div className="poll-bar" aria-hidden="true" style={{ "--poll-fill": `${tally.pct[config.main] ?? 0}%` } as React.CSSProperties}>
            <i className="poll-fill" />
            <span className="poll-result-label">{mainOption?.label ?? ""}</span>
          </div>
          <b className="poll-percent" aria-hidden="true">
            <span className="poll-number">
              <span className="poll-whole">{whole}</span>
              <span className="poll-fraction">{`.${fraction ?? "0"}`}</span>
            </span>
            <span className="poll-sign">%</span>
          </b>
        </div>
        <div className="poll-actions" role="group" aria-label="选择你的答案">
          {config.options.map((option) => {
            const selected = voteValue === option.value;
            return (
              <button
                className={`poll-choice${selected ? " is-selected" : ""}`}
                type="button"
                data-value={option.value}
                disabled={Boolean(voteValue)}
                aria-pressed={selected}
                aria-label={`${option.label}${selected ? "，已选择" : ""}`}
                key={option.value}
                onClick={() => store.vote(config, option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {config.comment ? (
          <p className="poll-comment">
            <span className="poll-author">{`@${config.comment.author}`}</span>
            <span className="poll-message">
              {highlighted(config.comment.text, config.comment.highlight, "c")}
            </span>
          </p>
        ) : null}
        <p className="poll-status" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} ref={statusRef}>
          {status}
        </p>
        <p className="poll-note" id={`${config.id}-note`}>
          本地展示 · 非全站统计
        </p>
      </div>
      {mode === "floating" ? (
        <button
          className="poll-close"
          type="button"
          aria-label="关闭问卷"
          onClick={(event) => onRequestClose?.(event.detail === 0)}
        >
          ×
        </button>
      ) : null}
    </section>
  );
}

/** 内嵌实例：没有关闭控件（设计：内嵌不显示浮层关闭控件）。 */
export function InlinePoll({ config }: { config: PollConfig }): ReactNode {
  return <Poll config={config} mode="inline" />;
}

/**
 * 默认问卷：右下角的浮层 + 「怪盗ch · 问卷」启动器。
 * 关闭只记录「见过」，不增加票数；已见过时不会自动弹出，但启动器一直在。
 */
export function DefaultPoll(): ReactNode {
  const raw = site.poll;
  const config = useMemo(() => (raw ? normalize(raw) : null), [raw]);
  const overlays = useOverlayManager();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef(0);

  useEffect(() => {
    if (!config) return;
    if (getPollStore().get(config).seen) return;
    const go = () => {
      if (getPollStore().get(config).seen) return;
      // 手机（模态对话框）开着时不要把问卷弹到它上面：Escape 会先关掉最上面那层，
      // 若问卷压在手机上，分享链接进来按 Escape 就关不掉手机（真实浏览器验收抓到过）。
      if (overlays.has("phone")) return;
      setOpen(true);
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(go, { timeout: 2200 })
        : window.setTimeout(go, 1600);
    return () => {
      if (typeof window.cancelIdleCallback === "function" && typeof idle === "number") {
        window.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle as number);
      }
      window.clearTimeout(closeTimer.current);
    };
  }, [config, overlays]);

  const requestClose = useCallback(
    (keyboard: boolean) => {
      setOpen(false);
      setClosing(true);
      getPollStore().markSeen(config!);
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => setClosing(false), reduced ? 0 : 220);
      if (keyboard) launcherRef.current?.focus({ preventScroll: true });
    },
    [config],
  );

  useOverlay(
    {
      id: "poll-floating",
      onEscape: () => {
        if (!open) return false;
        requestClose(true);
        return true;
      },
    },
    open,
  );

  if (!config) return null;

  return (
    <>
      {open || closing ? (
        <Poll config={config} mode="floating" closing={closing} onRequestClose={requestClose} />
      ) : null}
      <button
        ref={launcherRef}
        className="poll-launcher"
        type="button"
        hidden={open}
        aria-label="打开怪盗ch本地问卷"
        onClick={() => {
          setClosing(false);
          setOpen(true);
          window.setTimeout(() => {
            document
              .querySelector<HTMLElement>(`.poll[data-poll-id="${config.id}"] .poll-close`)
              ?.focus();
          }, 0);
        }}
      >
        怪盗ch · 问卷
      </button>
    </>
  );
}
