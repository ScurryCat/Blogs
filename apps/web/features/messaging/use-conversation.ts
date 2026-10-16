"use client";

/**
 * 角色消息的会话状态机（08 §3）。
 *
 * 这个 hook 承担 08 §3「混合对话如何切换」里全部的前端不变量：
 *
 *  - **同一个角色只有一个 controller**：进入页面时先引导访客会话（拿到 CSRF token），
 *    再按角色 id 取得（或创建）那一段会话 —— 两个标签页拿到的是同一段；
 *  - **一个在途请求**：`pending !== "none"` 时拒绝新的发送 / 选择；
 *  - **晚到的响应不写回**：每个响应都校验 conversation id 与当前一致，
 *    切换角色后旧响应到达时直接丢弃（验收用例 4 的前端一半）；
 *  - **幂等重试**：同一条输入重试时**复用同一个** `client_request_id`，
 *    因此网络重试不会重复调用上游（验收用例 3）；文本改了才换新键；
 *  - **降级保留输入**：AI 不可用时草稿留在输入框里，用户可以直接再试或回到剧情；
 *  - **卸载即 abort**：模块退出不留挂起请求（验收 §1）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import {
  chooseOption,
  clearConversation,
  createConversation,
  isNotFound,
  isStaleStory,
  isUnauthorized,
  openSession,
  restartStory,
  resumeTopic,
  sendMessage,
} from "./api";
import {
  aiNotice,
  newClientId,
  normalizeInput,
  type ChatNotice,
  type ConversationView,
  type SessionView,
} from "./types";

export type ConversationPhase = "loading" | "ready" | "error" | "missing";
export type PendingAction = "none" | "sending" | "choosing" | "resuming" | "restarting" | "clearing";

export interface ConversationController {
  phase: ConversationPhase;
  view: ConversationView | null;
  session: SessionView | null;
  error: string | null;
  notice: ChatNotice | null;
  pending: PendingAction;
  draft: string;
  setDraft: (value: string) => void;
  /** 是否可以发送自由输入（剧情结束、AI 停用、在途时都不可发）。 */
  canSend: boolean;
  description: string;
  send: () => void;
  choose: (choiceId: string) => void;
  resume: () => void;
  restart: () => void;
  clear: () => void;
  reload: () => void;
}

export function describeChatError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return "这段会话不存在或已经过期。";
    if (error.status === 401) return "访客会话已过期，刷新页面会重新开始一段。";
    if (error.status === 403) return "请求被拒绝（来源或 CSRF 校验失败），刷新页面即可恢复。";
    if (error.status === 429) return "发送太频繁了，等一分钟再试。";
    if (error.status === 409) return error.message;
    return `请求失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) return "连不上服务，请检查网络后重试。";
  if (error instanceof Error && error.message) return `请求失败：${error.message}`;
  return "请求失败。";
}

interface Attempt {
  text: string;
  clientRequestId: string;
}

export function useConversation(characterId: string | null): ConversationController {
  const [phase, setPhase] = useState<ConversationPhase>("loading");
  const [view, setView] = useState<ConversationView | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<ChatNotice | null>(null);
  const [pending, setPending] = useState<PendingAction>("none");
  const [draft, setDraft] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const viewRef = useRef<ConversationView | null>(null);
  const sessionRef = useRef<SessionView | null>(null);
  // 同一条输入的幂等键：文本没变就复用，文本改了才换新的。
  const attemptRef = useRef<Attempt | null>(null);
  const pendingRef = useRef<PendingAction>("none");
  // 最近一次失败的原始错误对象：调用方据此判断「是版本过期还是真的坏了」，
  // 而不是去匹配错误文案。
  const lastErrorRef = useRef<unknown>(null);

  const apply = useCallback((next: ConversationView | null) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const setBusy = useCallback((value: PendingAction) => {
    pendingRef.current = value;
    setPending(value);
  }, []);

  /** 统一的请求包装：abort、晚到响应、错误分类都在这里处理。 */
  const run = useCallback(
    async <T,>(
      task: (signal: AbortSignal) => Promise<T>,
      options: { busy: PendingAction; apply: (value: T) => void; keepNotice?: boolean },
    ): Promise<boolean> => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setBusy(options.busy);
      if (!options.keepNotice) setLocalNotice(null);
      lastErrorRef.current = null;
      try {
        const value = await task(controller.signal);
        if (controller.signal.aborted || !mountedRef.current) return false;
        options.apply(value);
        return true;
      } catch (failure) {
        if (controller.signal.aborted || !mountedRef.current) return false;
        if (failure instanceof DOMException && failure.name === "AbortError") return false;
        lastErrorRef.current = failure;
        setError(describeChatError(failure));
        return false;
      } finally {
        if (mountedRef.current) setBusy("none");
      }
    },
    [setBusy],
  );

  // 引导访客会话 + 取得（或创建）这一段的会话。
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;

    void (async () => {
      try {
        let current = sessionRef.current;
        if (current === null) {
          current = await openSession(controller.signal);
          if (cancelled || controller.signal.aborted) return;
          sessionRef.current = current;
          setSession(current);
        }
        if (characterId === null) {
          if (!cancelled) setPhase("ready");
          return;
        }
        const loaded = await createConversation(current.csrf_token, characterId, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        // 晚到的响应如果属于别的角色，丢弃（切换角色后旧响应不能污染新会话）。
        if (loaded.conversation.character_id !== characterId) return;
        apply(loaded);
        setPhase("ready");
      } catch (failure) {
        if (cancelled || controller.signal.aborted) return;
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        if (isUnauthorized(failure) || isNotFound(failure)) {
          // 会话过期：清掉本地引用，让下一次进入重新引导（不自动重发任何东西）。
          sessionRef.current = null;
          setSession(null);
        }
        setError(describeChatError(failure));
        setPhase(isNotFound(failure) ? "missing" : "error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apply, characterId, reloadToken]);

  // 卸载：取消进行中的请求（验收 §1）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  const reload = useCallback(() => {
    // 用户操作触发的重新加载：这里切回 loading 是安全的（不在 effect 体内）。
    setPhase("loading");
    setError(null);
    setReloadToken((value) => value + 1);
  }, []);

  const withSession = useCallback(
    (action: (csrfToken: string, current: ConversationView) => Promise<ConversationView>) => {
      const current = viewRef.current;
      const active = sessionRef.current;
      if (current === null || active === null) return null;
      const expectedId = current.conversation.id;
      return () =>
        run(
          async (signal) => {
            const next = await action(active.csrf_token, current);
            // 晚到的响应只允许写回它自己那一段会话。
            if (next.conversation.id !== expectedId) {
              throw new Error("响应不属于当前会话");
            }
            return next;
          },
          { busy: "choosing", apply },
        );
    },
    [apply, run],
  );

  const send = useCallback(() => {
    const current = viewRef.current;
    const active = sessionRef.current;
    if (current === null || active === null) return;
    if (pendingRef.current !== "none") return;
    const text = normalizeInput(draft);
    if (!text || current.conversation.can_send === false) return;

    const previous = attemptRef.current;
    const attempt: Attempt =
      previous !== null && previous.text === text
        ? previous
        : { text, clientRequestId: newClientId("msg") };
    attemptRef.current = attempt;

    // ★ 晚到的响应只允许写回它自己那一段会话。切换角色后旧响应到达时，
    //   它的 conversation id 与当前不一致 —— 直接当失败处理，绝不写进新会话。
    const expectedId = current.conversation.id;
    void run(
      async (signal) => {
        const next = await sendMessage(active.csrf_token, expectedId, {
          text: attempt.text,
          clientRequestId: attempt.clientRequestId,
        }, signal);
        if (next.conversation.id !== expectedId) {
          throw new Error("响应不属于当前会话");
        }
        return next;
      },
      { busy: "sending", apply },
    ).then((ok) => {
      if (!mountedRef.current) return;
      const latest = viewRef.current;
      if (ok && latest !== null && (latest.ai.status === "ok" || latest.ai.status === "replayed")) {
        // 只有真的拿到回复才清空草稿与幂等键。
        attemptRef.current = null;
        setDraft("");
      }
    });
  }, [apply, draft, run]);

  const choose = useCallback(
    (choiceId: string) => {
      const current = viewRef.current;
      if (current === null || pendingRef.current !== "none") return;
      const make = withSession((csrfToken, snapshot) =>
        chooseOption(csrfToken, snapshot.conversation.id, {
          choiceId,
          nodeId: snapshot.conversation.node_id,
          nodeVersion: snapshot.conversation.node_version,
          clientMessageId: newClientId("choice"),
        }),
      );
      if (make === null) return;
      void make().then((ok) => {
        if (ok || !mountedRef.current) return;
        // 版本过期：只提示并读取最新状态，**不重复消费**这一次选项。
        if (isStaleStory(lastErrorRef.current)) {
          setLocalNotice({
            tone: "info",
            text: "剧情已经在别处推进了。已经读取当前状态，请重新选一次。",
          });
          reload();
        }
      });
    },
    [reload, withSession],
  );

  const resume = useCallback(() => {
    const make = withSession((csrfToken, snapshot) =>
      resumeTopic(csrfToken, snapshot.conversation.id, snapshot.conversation.node_version),
    );
    if (make === null) return;
    void make();
  }, [withSession]);

  const restart = useCallback(() => {
    const make = withSession((csrfToken, snapshot) =>
      restartStory(csrfToken, snapshot.conversation.id, snapshot.conversation.node_version),
    );
    if (make === null) return;
    void make();
  }, [withSession]);

  const clear = useCallback(() => {
    const current = viewRef.current;
    const active = sessionRef.current;
    if (current === null || active === null) return;
    const conversationId = current.conversation.id;
    void run(
      async (signal) => {
        await clearConversation(active.csrf_token, conversationId, signal);
        return true;
      },
      {
        busy: "clearing",
        apply: () => {
          // 清除之后重新建立一段：不静默保留旧正文。
          viewRef.current = null;
          setView(null);
          attemptRef.current = null;
          setReloadToken((value) => value + 1);
        },
      },
    );
  }, [run]);

  // 提示的优先级：本次操作的本地提示 → AI 侧降级 → 请求错误。
  // 全部是**纯推导**，不用额外的 state+effect 同步（那正是 T05/T07 踩到的 lint 坑）。
  const notice = useMemo<ChatNotice | null>(() => {
    if (localNotice !== null) return localNotice;
    if (view !== null) {
      const fromAi = aiNotice(view.ai);
      if (fromAi !== null) return fromAi;
    }
    if (error !== null) return { tone: "warn", text: error };
    return null;
  }, [error, localNotice, view]);

  return {
    phase,
    view,
    session,
    error,
    notice,
    pending,
    draft,
    setDraft,
    canSend:
      view !== null &&
      pending === "none" &&
      view.conversation.can_send &&
      view.conversation.status !== "finished",
    description: view?.conversation.status === "free" ? "剧情已暂停" : "",
    send,
    choose,
    resume,
    restart,
    clear,
    reload,
  };
}

export { isStaleStory };
