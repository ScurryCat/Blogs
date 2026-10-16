"use client";

/**
 * 信息流的读取状态（03 §4「必备状态」、03 §7 分页规则）。
 *
 * 必须能区分四种状态，**不能都显示成空列表**：
 *   - `loading` 首次加载（骨架）
 *   - `empty`   确实没有动态 / 该标签没有结果
 *   - `error`   断网、5xx、读取失败（显示原因 + 重试）
 *   - `ready`   有数据（可能还有下一页）
 *
 * 其他规则：
 *   - 「加载更多」是显式操作，**不做无限滚动**（03 §4）；
 *   - 分页结果按 ID 去重并按 `published_at DESC, id DESC` 合并；
 *   - 切换标签**重置游标**（05 §6：游标带筛选指纹，沿用旧游标会 400）；
 *   - 卸载时 abort 进行中的请求，晚到的响应不写回状态（验收 §1）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { fetchMoments } from "./api";
import { FEED_PAGE_SIZE, mergeMoments, type Moment } from "./types";

// 兼容既有导入路径；定义在 types.ts（服务端也要用，见那里的说明）。
export { FEED_PAGE_SIZE };

export type FeedPhase = "loading" | "ready" | "error";

export interface FeedState {
  items: readonly Moment[];
  phase: FeedPhase;
  /** 是否还有下一页（有 `next_cursor` 才有）。 */
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  /** 是否已经完成过一次加载（用于区分「还没加载」与「真的空」）。 */
  loaded: boolean;
  reload: () => void;
  loadMore: () => void;
}

export function describeFeedError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return "这些内容已经不可访问了。";
    if (error.status === 400) return "筛选条件已变化，请重新选择标签。";
    return `读取失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) return "连不上服务，请检查网络后重试。";
  if (error instanceof Error && error.message) return `读取失败：${error.message}`;
  return "读取失败。";
}

export function useMomentFeed(
  tag: string | null,
  options: {
    initial?: readonly Moment[];
    initialCursor?: string | null;
    /**
     * 服务端首屏失败的原因。
     *
     * 它只是**客户端读取的初始错误状态**，不是判决书：客户端接下来会自己重试一次
     * （`initial` 为空时会走 `load("reset")`），成功就把这个原因清掉。
     * 否则会出现「服务端 422、客户端已经读到内容，页面上却同时挂着一个旧的失败提示」。
     */
    initialError?: string | null;
  } = {},
): FeedState {
  const initial = useMemo(() => options.initial ?? [], [options.initial]);
  const initialCursor = options.initialCursor ?? null;
  const initialError = options.initialError ?? null;

  const [items, setItems] = useState<readonly Moment[]>(initial);
  const [phase, setPhase] = useState<FeedPhase>(
    initial.length ? "ready" : initialError ? "error" : "loading",
  );
  const [error, setError] = useState<string | null>(initialError);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(initial.length > 0);
  const [reloadToken, setReloadToken] = useState(0);

  const requestRef = useRef<AbortController | null>(null);
  // 服务端已经给了第一页时，客户端不需要再拉一次同样的数据。
  const skipFirstClientLoad = useRef(initial.length > 0);

  const load = useCallback(
    async (mode: "reset" | "more", nextCursor: string | null) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (mode === "more") setLoadingMore(true);
      else {
        setPhase("loading");
        setError(null);
      }
      try {
        const page = await fetchMoments(
          { tag, cursor: mode === "more" ? nextCursor : null, limit: FEED_PAGE_SIZE },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setItems((previous) =>
          mode === "more" ? mergeMoments(previous, page.items) : mergeMoments([], page.items),
        );
        setCursor(page.next_cursor);
        setPhase("ready");
        setError(null);
        setLoaded(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setError(describeFeedError(failure));
        setPhase("error");
        setLoaded(true);
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    },
    // `tag` 直接进依赖：切换标签时回调身份变化，下面的 effect 会重新拉第一页。
    [tag],
  );

  // 标签变化 / 手动重载：从第一页重新开始（**重置游标**）。
  useEffect(() => {
    if (skipFirstClientLoad.current) {
      skipFirstClientLoad.current = false;
      // 服务端首屏已经就绪，但切换标签必须重新拉：只有标签与初始标签一致时才跳过。
      if (reloadToken === 0) return;
    }
    // 服务端首屏失败时 `initial` 为空，因此这里会自己重试一次（成功后清掉错误）。
    void load("reset", null);
  }, [load, tag, reloadToken]);

  // 卸载：取消进行中的读取（验收 §1：模块退出不留挂起请求）。
  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [],
  );

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    void load("more", cursor);
  }, [cursor, load, loadingMore]);

  return {
    items,
    phase,
    hasMore: Boolean(cursor),
    loadingMore,
    error,
    loaded,
    reload,
    loadMore,
  };
}
