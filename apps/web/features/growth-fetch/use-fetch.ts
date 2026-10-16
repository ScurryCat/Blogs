"use client";

/**
 * T09 共用的可取消读取 hook（天鹅绒房间与印象空间两处视图都用它）。
 *
 * 为什么单独一个文件而不是各写一份：这个 hook 解决的是两个**具体踩过的坑**，
 * 复制两份意味着两处会分别漂移：
 *
 *  1. **卸载 / 换参数时取消在途读取**，晚到的响应不写回状态
 *     （ACCEPTANCE §1「模块退出取消读取与监听」）。
 *  2. **不在 effect 体里同步 `setState`**：那会触发级联渲染，被 ESLint 的
 *     `react-hooks/set-state-in-effect` 判为错误（T04 / T06 都为此重写过一遍）。
 *     这里的做法是「请求键 + 结果配对」：键一变，旧结果自动视为「加载中」，
 *     不需要任何同步 setState。
 *
 * `depsKey` 是一个**字符串**而不是依赖数组：调用方用 `JSON.stringify` 之类的
 * 稳定序列化表达「这次请求的参数是什么」。字符串比较天然稳定，
 * 不会因为每次渲染新建的对象 / 数组 / 回调让 effect 反复触发。
 */

import { useCallback, useEffect, useState } from "react";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; error: unknown };

export function useFeatureFetch<T>(
  depsKey: string,
  load: (signal: AbortSignal) => Promise<T>,
): { state: FetchState<T>; reload: () => void } {
  const [nonce, setNonce] = useState(0);
  const requestKey = `${depsKey}#${nonce}`;
  const [result, setResult] = useState<{ key: string; state: FetchState<T> } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    load(controller.signal)
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, state: { status: "ready", data } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ key: requestKey, state: { status: "failed", error } });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `load` 刻意不进依赖数组：它每次渲染都是新函数，放进去会让请求无限重发。
    // 调用方用 `depsKey` 表达「什么变了就要重新请求」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const state: FetchState<T> = result && result.key === requestKey ? result.state : { status: "loading" };
  return { state, reload };
}
