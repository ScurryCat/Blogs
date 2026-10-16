"use client";

/**
 * 在途请求登记（T06）。
 *
 * 宿主在关闭手机、换 App 或换屏时调用模块的 `dispose()`；**晚到的响应不得写回状态**
 * （验收 §1「模块退出取消读取与监听」）。这里用与 T04 相同的做法：把当前在途的
 * `AbortController` 记在一个模块级集合里，视图卸载时取消自己的那一个，`dispose()` 取消全部。
 *
 * 为什么不用 `AbortSignal.any` 之类的组合：保持最小实现，行为一眼能读。
 */

const inflight = new Set<AbortController>();

/** 登记一个请求；返回的 `release()` 必须在 finally 里调用。 */
export function trackRequest(controller: AbortController): () => void {
  inflight.add(controller);
  return () => {
    inflight.delete(controller);
  };
}

/** 取消全部在途请求（宿主调用 `dispose()` 时）。 */
export function disposeShowcase(): void {
  for (const controller of [...inflight]) {
    controller.abort();
    inflight.delete(controller);
  }
}

/** 仅测试使用：当前在途请求数量。 */
export function inflightCount(): number {
  return inflight.size;
}
