"use client";

/**
 * 管理写操作的共享状态：会话 / CSRF / 错误文案（T03）。
 *
 * 边界：
 *  - 站主会话与 CSRF token 只来自 `GET /api/v1/auth/session`（T01 契约），
 *    **不写 localStorage / sessionStorage**（05 §5.8）；
 *  - 所有写操作走 `features/auth/api.ts` 与 `features/ins/api.ts`（共享客户端，写不重试）；
 *  - 412（版本冲突）必须保留未保存输入并提示读取新版，**不自动覆盖**（05 §7）；
 *  - 这个 hook 不做「路由保护」：隐藏入口不是安全边界，权限永远由 FastAPI 判断（01 §3）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { fetchSession, type SessionStatus } from "@/features/auth/api";
import { describeLoginError, needsFreshSession } from "@/features/auth/validation";

export interface AdminSessionState {
  session: SessionStatus | null;
  /** 挂载时读取会话的状态。 */
  phase: "loading" | "ready" | "unavailable";
  message: string | null;
  /** 重新读取会话（拿到新的 CSRF token）。 */
  refresh: () => Promise<SessionStatus | null>;
  /** 把一次失败映射成可读文案（412 有专门说法）。 */
  describe: (error: unknown) => string;
  /** 是否是版本冲突（调用方据此保留输入并提示重新读取）。 */
  isConflict: (error: unknown) => boolean;
}

export function useAdminSession(): AdminSessionState {
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

  const describe = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiClientError) {
        if (error.status === 412) {
          return "内容已在别处更新（版本冲突）。请重新读取最新版本后再提交，未保存的输入会保留。";
        }
        if (error.status === 428) {
          return "缺少版本条件，请重新读取这条动态再提交。";
        }
        if (error.status === 401) return "登录已失效，请到 /admin/login 重新登录。";
        if (error.status === 403) return "请求来源或 CSRF 校验失败，请刷新页面后重试。";
        if (error.status === 409) return error.message || "当前状态不允许这个操作。";
        if (error.status === 413) return "图片太大：单张上限 8 MiB。";
        if (error.status === 415) return "图片格式不支持：只接受 JPEG / PNG / WebP。";
        if (error.status === 422) return "提交的内容不合法，请检查字段提示。";
        return error.message || `操作失败（HTTP ${error.status}）。`;
      }
      if (error instanceof ApiTransportError) return "无法连接到服务，请检查网络后重试。";
      return "操作失败，请稍后重试。";
    },
    [],
  );

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

/** 会话中途失效时重新取一次预登录会话（与登录页同一策略）。 */
export function shouldRefreshSession(error: unknown): boolean {
  return needsFreshSession(error);
}
