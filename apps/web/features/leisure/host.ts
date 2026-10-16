"use client";

/**
 * 视图层里需要 React 的部分：宿主接口与可取消的读取。
 * 纯函数在 `paths.ts`（服务端组件要用的那些）；这里再导出一次。
 */

import { useCallback, useEffect, useState } from "react";

import { classifyFailure, isAbort, type Failure } from "./failure";
import type { StateAdapter } from "./state";

export * from "./paths";

export interface LeisureHost {
  mode: "phone" | "site";
  openContent(request: { destination: string; source: "phone-link" | "top-nav" }): void;
  changeScreen(screen: string): void;
  state: StateAdapter;
  toast(message: string, options?: { tone?: "info" | "error" }): void;
}

export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; failure: Failure };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方显式给出
  }, [requestKey]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const state: LoadState<T> =
    result && result.key === requestKey ? result.state : { status: "loading" };
  return { state, reload };
}
