/**
 * 未完成请求的登记表（供 `dispose` 使用）。
 *
 * 为什么需要：`useLoader` 在组件卸载时会 abort 自己的读取，但**用户主动发起的**
 * 请求（认知定位提交）由一个 ref 持有，光靠卸载不会取消。02 §4 要求模块退出时
 * 取消读取与监听、且晚到的响应不得写回状态，因此：
 *
 *  - 组件在提交前把自己的 `AbortController` 登记进来；
 *  - 组件卸载与 `dispose()` 都会 `abortAll()`；
 *  - abort 后 fetch 以 `AbortError` 拒绝，`isAbort()` 会把它吞掉，不写状态。
 */

const controllers = new Set<AbortController>();

/** 登记一个控制器，返回注销函数。 */
export function trackController(controller: AbortController): () => void {
  controllers.add(controller);
  return () => {
    controllers.delete(controller);
  };
}

/** 取消全部未完成请求，返回取消数量（供测试与诊断断言）。 */
export function abortAll(): number {
  const pending = [...controllers];
  controllers.clear();
  for (const controller of pending) controller.abort();
  return pending.length;
}

/** 当前登记在册的未完成请求数量。 */
export function activeRequestCount(): number {
  return controllers.size;
}
