/**
 * 未完成请求的登记表（与 metanav 的 `inflight.ts` 同形）。
 *
 * 手机宿主在退出应用时调用模块的 `dispose()`；`AbortController` 只取消
 * **当前**组件树里的请求，`dispose()` 拿不到它们，所以这里集中记一份。
 * 晚到的响应由调用方的 `signal.aborted` / `cancelled` 标志拦住，不写回状态。
 */

const active = new Set<AbortController>();

export function track(controller: AbortController): AbortController {
  active.add(controller);
  controller.signal.addEventListener("abort", () => active.delete(controller), { once: true });
  return controller;
}

export function release(controller: AbortController): void {
  active.delete(controller);
}

export function abortAll(): void {
  for (const controller of [...active]) {
    controller.abort();
  }
  active.clear();
}

export function activeRequestCount(): number {
  return active.size;
}
