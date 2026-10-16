"use client";

/**
 * 弹层管理器（02 §9）。
 *
 * 目的：问卷浮层、手机、图片预览、转场遮罩不再互相争抢 Escape、滚动锁与焦点。
 * 规则：
 *  - 每一层用 `push()` 登记，返回注销函数（React 里放 effect 清理）；
 *  - **Escape 只给最上层**：从栈顶往下找第一个能处理 Escape 的层，处理完就停，
 *    不同时关闭多层；
 *  - 滚动锁按「需要锁的层数」计数，最后一层退出时恢复；
 *  - 关闭后的焦点归还由各层自己提供 `restoreFocus`，管理器只负责在退出时调用。
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface OverlayEntry {
  id: string;
  /** 返回 `true` 表示这一层消费了 Escape。 */
  onEscape?: () => boolean;
  /** 是否需要锁定页面滚动。 */
  lockScroll?: boolean;
  /** 退出时把焦点还给谁（例如触发按钮）。 */
  restoreFocus?: () => void;
}

export interface OverlayManager {
  push(entry: OverlayEntry): () => void;
  top(): OverlayEntry | null;
  has(id: string): boolean;
  depth(): number;
  /** 从栈顶往下找第一个能处理 Escape 的层；返回是否被消费。 */
  handleEscape(): boolean;
}

const SCROLL_LOCK_CLASS = "ov-lock";

export function createOverlayManager(): OverlayManager {
  const stack: OverlayEntry[] = [];

  const syncScrollLock = () => {
    const shouldLock = stack.some((entry) => entry.lockScroll);
    document.documentElement.classList.toggle(SCROLL_LOCK_CLASS, shouldLock);
  };

  return {
    push(entry) {
      stack.push(entry);
      syncScrollLock();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const position = stack.lastIndexOf(entry);
        if (position !== -1) stack.splice(position, 1);
        syncScrollLock();
        entry.restoreFocus?.();
      };
    },
    top: () => stack[stack.length - 1] ?? null,
    has: (id) => stack.some((entry) => entry.id === id),
    depth: () => stack.length,
    handleEscape() {
      // 只关一层：找到最上面那个声明了 Escape 的层，交给它。
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const entry = stack[index];
        if (entry?.onEscape) return entry.onEscape();
      }
      return false;
    },
  };
}

const OverlayContext = createContext<OverlayManager | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }): ReactNode {
  // 惰性初始化，不在渲染期读写 ref（React Compiler 的 react-hooks/refs）。
  const [manager] = useState(createOverlayManager);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (manager.handleEscape()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [manager]);

  return <OverlayContext.Provider value={manager}>{children}</OverlayContext.Provider>;
}

const ESCAPE_FALLBACK: OverlayManager = {
  push: () => () => undefined,
  top: () => null,
  has: () => false,
  depth: () => 0,
  handleEscape: () => false,
};

export function useOverlayManager(): OverlayManager {
  const manager = useContext(OverlayContext);
  return useMemo(() => manager ?? ESCAPE_FALLBACK, [manager]);
}

/** 登记一个弹层，返回注销函数；`enabled` 为 false 时不登记。 */
export function useOverlay(entry: OverlayEntry, enabled = true): void {
  const manager = useOverlayManager();
  const ref = useRef(entry);
  // 每次提交后刷新「最新的那层回调」；读取只发生在事件/生命周期里，不在渲染期。
  useEffect(() => {
    ref.current = entry;
  });
  useEffect(() => {
    if (!enabled) return;
    return manager.push({
      id: entry.id,
      onEscape: () => ref.current.onEscape?.() ?? false,
      lockScroll: ref.current.lockScroll,
      restoreFocus: () => ref.current.restoreFocus?.(),
    });
  }, [manager, enabled, entry.id]);
}

export { SCROLL_LOCK_CLASS };
