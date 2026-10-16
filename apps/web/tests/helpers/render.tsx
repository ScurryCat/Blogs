/**
 * 组件测试小工具（不引入任何新依赖）。
 *
 * 项目里没有 @testing-library，React 19 自带 `act` 与 `react-dom/client`，
 * 这足够驱动真实的挂载 / 卸载 / 事件流程，也避免为了测试再加依赖。
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// React 19 要求显式声明这是 act 环境，否则 act() 会警告并同步刷新不稳定。
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
}

export function render(ui: ReactNode): Rendered {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 让 requestAnimationFrame / 定时器推进若干毫秒（组件的「挂载后再读」都在这里发生）。 */
export async function advance(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** 派发一次真实的点击（走 React 的事件系统）。 */
export function click(element: Element | null): void {
  if (!element) throw new Error("click: element is missing");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

/** 派发键盘事件（默认冒泡到 document，供 OverlayManager 的 Escape 使用）。 */
export function key(target: EventTarget, key: string, extra: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  });
}

export function resetDocument(): void {
  document.body.innerHTML = "";
  document.documentElement.className = "";
  window.localStorage.clear();
}
