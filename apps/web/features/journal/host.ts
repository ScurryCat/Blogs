"use client";

/**
 * 视图层里需要 React 的部分：宿主接口、可取消的读取、以及请求登记。
 *
 * 纯函数与日期工具在 `paths.ts`（服务端组件要用的那些）；这里再导出一次，
 * 客户端组件统一从 `./host` 取。
 */

import { useCallback, useEffect, useState } from "react";

import { classifyFailure, isAbort, type Failure } from "./failure";
import type { StateAdapter } from "./state";

export * from "./paths";
export * from "./state";

/** 手记视图的宿主：手机内置应用与独立页各提供一个实现（与 nav 的 MetanavHost 同形）。 */
export interface JournalHost {
  mode: "phone" | "site";
  /** 打开站内内容（详情页）。过场效果由来源决定，本模块不播动画。 */
  openContent(request: { destination: string; source: "phone-link" | "top-nav" | "phone-internal" }): void;
  /** 应用内换屏（phone-internal 语义：不遮盖全站）。 */
  changeScreen(screen: string, item?: string | null): void;
  /** 宿主提供的本机状态（目前用于「上次看的是列表还是日历」）。 */
  state: StateAdapter;
  toast(message: string, options?: { tone?: "info" | "error" }): void;
}

export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; failure: Failure };

/**
 * 可取消的读取。组件卸载或依赖变化时 abort 旧请求，晚到的响应不写回状态。
 *
 * 「加载中」是**派生**状态而不是在 effect 里同步 setState（会触发级联渲染并违反
 * React 的 `set-state-in-effect`）：用 `requestKey` 与结果配对，key 一变旧结果自动作废。
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
