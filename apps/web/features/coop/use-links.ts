"use client";

/**
 * COOP 的读取状态（公开列表 / 标签 / 单条详情）。
 *
 * 三件事必须做对（验收 §1「模块退出取消读取与监听」）：
 *   1. 切换标签或卸载时 `abort()` 掉旧请求；
 *   2. 晚到的响应靠 `cancelled` / `signal.aborted` 拦住，不写回状态；
 *   3. 失败是**明确的失败态**，不是空列表（空列表只表示「真的没有已发布友链」）。
 *
 * 「加载中」是**派生状态**（`requestKey` 与结果配对），不是在 effect 里同步 setState：
 * 后者会触发级联渲染（React 的 `set-state-in-effect`），T04 的 `useLoader` 已经
 * 把这条经验写进注释，这里沿用同一套做法，不新增豁免。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError } from "@/lib/api/client";

import { getFriendLink, listFriendLinks, listFriendTags } from "./api";
import { release, track } from "./inflight";
import type { FriendLinkDetail, FriendLinkSummary, FriendTag } from "./types";

export const PAGE_SIZE = 12;

export type CoopListState =
  | { status: "loading" }
  | { status: "ready"; items: FriendLinkSummary[]; nextCursor: string | null }
  | { status: "failed"; message: string };

export interface FriendLinksController {
  state: CoopListState;
  reload: () => void;
  loadMore: () => void;
  loadingMore: boolean;
  /** 加载下一页失败时的原因；首屏失败走 state.failed。 */
  moreError: string | null;
}

function describe(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return "这些友链已经不可见了。";
    return `读取失败（HTTP ${error.status} · ${error.code}）`;
  }
  return "连不上服务，暂时读不到友链。";
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof DOMException && error.name === "AbortError";
}

interface ListResult {
  key: string;
  status: "ready" | "failed";
  items: FriendLinkSummary[];
  nextCursor: string | null;
  message: string | null;
}

interface MoreResult {
  key: string;
  loading: boolean;
  error: string | null;
}

export function useFriendLinks(tag: string | null, pageSize: number = PAGE_SIZE): FriendLinksController {
  const [nonce, setNonce] = useState(0);
  const requestKey = `${tag ?? ""}\u0000${pageSize}\u0000${nonce}`;
  const [result, setResult] = useState<ListResult | null>(null);
  const [more, setMore] = useState<MoreResult>({ key: requestKey, loading: false, error: null });
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = track(new AbortController());
    let cancelled = false;
    cursorRef.current = null;

    listFriendLinks({ tag, limit: pageSize }, controller.signal)
      .then((page) => {
        if (cancelled) return;
        cursorRef.current = page.next_cursor;
        setResult({
          key: requestKey,
          status: "ready",
          items: page.items,
          nextCursor: page.next_cursor,
          message: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error, controller.signal)) return;
        setResult({
          key: requestKey,
          status: "failed",
          items: [],
          nextCursor: null,
          message: describe(error),
        });
      })
      .finally(() => release(controller));

    return () => {
      cancelled = true;
      controller.abort();
      release(controller);
    };
  }, [requestKey, tag, pageSize]);

  const state: CoopListState =
    result && result.key === requestKey
      ? result.status === "ready"
        ? { status: "ready", items: result.items, nextCursor: result.nextCursor }
        : { status: "failed", message: result.message ?? "读取失败" }
      : { status: "loading" };

  const loadingMore = more.key === requestKey && more.loading;
  const moreError = more.key === requestKey ? more.error : null;

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    if (more.key === requestKey && more.loading) return;
    setMore({ key: requestKey, loading: true, error: null });
    const controller = track(new AbortController());
    listFriendLinks({ tag, cursor, limit: pageSize }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        cursorRef.current = page.next_cursor;
        setResult((current) =>
          current && current.key === requestKey && current.status === "ready"
            ? {
                ...current,
                items: [...current.items, ...page.items],
                nextCursor: page.next_cursor,
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (isAbort(error, controller.signal)) return;
        setMore({ key: requestKey, loading: false, error: describe(error) });
      })
      .finally(() => {
        release(controller);
        setMore((current) =>
          current.key === requestKey ? { ...current, loading: false } : current,
        );
      });
  }, [tag, pageSize, more.key, more.loading, requestKey]);

  return { state, reload, loadMore, loadingMore, moreError };
}

export interface FriendTagsController {
  tags: FriendTag[];
  /** 标签读取失败不阻塞列表：只是筛选器少了一排按钮。 */
  failed: boolean;
}

export function useFriendTags(): FriendTagsController {
  const [tags, setTags] = useState<FriendTag[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = track(new AbortController());
    let cancelled = false;
    listFriendTags(controller.signal)
      .then((payload) => {
        if (cancelled) return;
        setTags(payload.items);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error, controller.signal)) return;
        setTags([]);
        setFailed(true);
      })
      .finally(() => release(controller));
    return () => {
      cancelled = true;
      controller.abort();
      release(controller);
    };
  }, []);

  return { tags, failed };
}

export type CoopDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; detail: FriendLinkDetail }
  | { status: "failed"; message: string };

export interface FriendDetailController {
  state: CoopDetailState;
  retry: () => void;
}

interface DetailResult {
  key: string;
  status: "ready" | "failed";
  detail: FriendLinkDetail | null;
  message: string | null;
}

/** 展开某张卡片时才读正文（列表不含 `story`）。 */
export function useFriendDetail(linkId: string | null): FriendDetailController {
  const [nonce, setNonce] = useState(0);
  const requestKey = `${linkId ?? ""}\u0000${nonce}`;
  const [result, setResult] = useState<DetailResult | null>(null);

  useEffect(() => {
    if (!linkId) return;
    const controller = track(new AbortController());
    let cancelled = false;
    getFriendLink(linkId, controller.signal)
      .then((detail) => {
        if (cancelled) return;
        setResult({ key: requestKey, status: "ready", detail, message: null });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error, controller.signal)) return;
        setResult({ key: requestKey, status: "failed", detail: null, message: describe(error) });
      })
      .finally(() => release(controller));
    return () => {
      cancelled = true;
      controller.abort();
      release(controller);
    };
  }, [requestKey, linkId]);

  const state: CoopDetailState = !linkId
    ? { status: "idle" }
    : result && result.key === requestKey
      ? result.status === "ready" && result.detail
        ? { status: "ready", detail: result.detail }
        : { status: "failed", message: result.message ?? "读取失败" }
      : { status: "loading" };

  const retry = useCallback(() => setNonce((value) => value + 1), []);
  return { state, retry };
}
