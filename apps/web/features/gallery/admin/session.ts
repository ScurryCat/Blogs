"use client";

/**
 * 管理写操作的共享状态：会话 / CSRF / 错误文案（T06）。
 *
 * 与 T03 的 `features/ins/admin/session.ts` **同形但独立**：那个文件在
 * `features/ins/` 下（T03 独占），跨包 import 别人的内部 hook 会在对方重构时无声破裂
 * （T04 的交付单也遇到过同类耦合）。这里只依赖 T01 的公开接口
 * `features/auth/api.ts` 与 `lib/api/client.ts`。
 *
 * 边界：
 *  - 站主会话与 CSRF token 只来自 `GET /api/v1/auth/session`（T01 契约），
 *    **不写 localStorage / sessionStorage**（05 §5.8）；
 *  - 412（版本冲突）必须保留未保存输入并提示读取新版，**不自动覆盖**（05 §7）；
 *  - 这个 hook 不做「路由保护」：隐藏入口不是安全边界，权限永远由 FastAPI 判断（01 §3）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { fetchSession, type SessionStatus } from "@/features/auth/api";
import { describeLoginError } from "@/features/auth/validation";

export interface AdminSessionState {
  session: SessionStatus | null;
  phase: "loading" | "ready" | "unavailable";
  message: string | null;
  refresh: () => Promise<SessionStatus | null>;
  describe: (error: unknown) => string;
  isConflict: (error: unknown) => boolean;
}

export function useShowcaseAdminSession(): AdminSessionState {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<SessionStatus | null> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const payload = await fetchSession(controller.signal);
      setSession(payload);
      setPhase("ready");
      setMessage(null);
      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      setPhase("unavailable");
      setMessage(describeLoginError(error));
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    void (async () => {
      try {
        const payload = await fetchSession(controller.signal);
        setSession(payload);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("unavailable");
        setMessage(describeLoginError(error));
      }
    })();
    // 卸载时取消未完成的读取（验收 §1）。
    return () => controller.abort();
  }, []);

  const describe = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) {
      if (error.status === 412) {
        return "内容已在别处更新（版本冲突）。请重新读取最新版本后再提交，未保存的输入会保留。";
      }
      if (error.status === 428) return "缺少版本条件，请重新读取这个相册再提交。";
      if (error.status === 401) return "登录已失效，请到 /admin/login 重新登录。";
      if (error.status === 403) return "请求来源或 CSRF 校验失败，请刷新页面后重试。";
      if (error.status === 409) return error.message || "当前状态不允许这个操作。";
      if (error.status === 422) return "提交的内容不合法，请检查字段提示。";
      return error.message || `操作失败（HTTP ${error.status}）。`;
    }
    if (error instanceof ApiTransportError) return "无法连接到服务，请检查网络后重试。";
    return "操作失败，请稍后重试。";
  }, []);

  const isConflict = useCallback(
    (error: unknown) => error instanceof ApiClientError && error.status === 412,
    [],
  );

  return { session, phase, message, refresh, describe, isConflict };
}

/** 字段级错误（`error.fields`）→ `{字段: 第一条说明}`，用于表单内联提示。 */
export function fieldMessages(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError)) return {};
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(error.fields ?? {})) {
    const first = Array.isArray(messages) ? messages[0] : undefined;
    if (first) result[key] = first;
  }
  return result;
}
