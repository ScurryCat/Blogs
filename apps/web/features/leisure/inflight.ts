/**
 * 未完成请求的登记表（`dispose()` 用）：模块退出时取消未完成请求（02 §4）。
 * 与 journal 的 `inflight.ts` 同一做法。
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
