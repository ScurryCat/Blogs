/**
 * 未完成请求的登记表（`dispose()` 用）。
 *
 * 宿主协议要求「模块退出时取消订阅与未完成请求」。`useLoader` 在组件卸载时已经
 * abort 自己的请求，但它管不到**事件回调里发起的**请求（例如「重访一篇手记」的
 * 校验读取）。这里登记这些请求，`dispose()` 一次全部取消。
 *
 * 与 nav 的 `inflight.ts` 同一做法：晚到的响应由 `isAbort()` 拦住，不写回状态。
 */

const active = new Set<AbortController>();

export function track<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  active.add(controller);
  const promise = run(controller.signal);
  const done = () => active.delete(controller);
  promise.then(done, done);
  return promise;
}

export function abortAll(): void {
  for (const controller of [...active]) {
    controller.abort();
    active.delete(controller);
  }
}

export function activeRequestCount(): number {
  return active.size;
}
