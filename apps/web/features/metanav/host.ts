"use client";

/**
 * 视图层里需要 React 的部分（`useLoader`）。
 *
 * 纯类型与纯函数在 `paths.ts`（服务端组件要用的那些）；这里再导出一次，
 * 客户端组件统一从 `./host` 取，import 不会因为两边分裂而到处改。
 */

import { useCallback, useEffect, useState } from "react";

import { classifyFailure, isAbort, type Failure } from "./failure";

export * from "./paths";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; failure: Failure };

/**
 * 可取消的读取。组件卸载或依赖变化时 abort 旧请求，晚到的响应不写回状态
 * （02 §4：模块退出要取消读取与监听）。
 *
 * 为什么把「加载中」做成派生状态而不是在 effect 里同步 `setState({status:"loading"})`：
 * 在 effect 里同步改状态会触发级联渲染（React 的 `set-state-in-effect` 规则），
 * 这里用 `requestKey` 与结果配对 —— key 一变，旧结果自动视为「加载中」。
 * 依赖用 `JSON.stringify` 做成稳定字符串键；调用方给出的 deps 必须覆盖 `load` 捕获的值。
 */
export function useLoader<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): { state: LoadState<T>; reload: () => void } {
  const [nonce, setNonce] = useState(0);
  const requestKey = `${JSON.stringify(deps)}#${nonce}`;
  const [result, setResult] = useState<{ key: string; state: LoadState<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    load(controller.signal)
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, state: { status: "ready", data } });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error)) return;
        setResult({ key: requestKey, state: { status: "failed", failure: classifyFailure(error) } });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方显式给出（见上）
  }, [requestKey]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const state: LoadState<T> =
    result && result.key === requestKey ? result.state : { status: "loading" };
  return { state, reload };
}

/** ISO 时间 → 本机展示用的短时间。 */
export function formatWhen(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}
