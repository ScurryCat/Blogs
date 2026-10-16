"use client";

/**
 * 轻提示（02 §4 的宿主能力之一）。
 *
 * 应用通过 `host.toast()` 使用；这里只维护一个队列与 `role="status"` 容器，
 * 不用它冒充成功提示：只有真实发生的动作才会调用它。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ToastMessage {
  id: number;
  text: string;
  tone: "info" | "error";
}

export interface ToastService {
  show(text: string, options?: { tone?: "info" | "error"; duration?: number }): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastService | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const serial = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback<ToastService["show"]>(
    (text, options) => {
      serial.current += 1;
      const id = serial.current;
      const tone = options?.tone ?? "info";
      setMessages((current) => [...current, { id, text, tone }]);
      const duration = options?.duration ?? 3200;
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const value = useMemo<ToastService>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
        {messages.map((message) => (
          <p className={`toast${message.tone === "error" ? " toast--error" : ""}`} key={message.id}>
            {message.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastService {
  const service = useContext(ToastContext);
  return useMemo<ToastService>(
    () => service ?? { show: () => undefined, dismiss: () => undefined },
    [service],
  );
}
