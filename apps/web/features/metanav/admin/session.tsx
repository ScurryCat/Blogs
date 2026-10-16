"use client";

/**
 * 管理端共用：会话 / CSRF 读取与错误展示。
 *
 *  - 管理端点全部要求站主会话；页面**不做**访问控制（01 §3：隐藏按钮不是安全边界），
 *    只是在未登录时给出「去登录」的入口，真实权限由 FastAPI 判定；
 *  - CSRF token 随 `GET /auth/session` 下发（T01 契约），写请求把它放在 JSON body；
 *  - 412（版本冲突）时**保留未保存的输入**，只提示并让站主重新读取（05 §7）。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchSession, type SessionStatus } from "@/features/auth/api";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { ApiClientError } from "@/lib/api/client";

export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: SessionStatus }
  | { status: "failed"; message: string };

export function useAdminSession(): { state: SessionState; reload: () => void } {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    fetchSession(controller.signal)
      .then((session) => {
        if (!cancelled) setState({ status: "ready", session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof ApiClientError
            ? `读取会话失败（HTTP ${error.status} · ${error.code}）`
            : "连不上服务，无法确认登录状态。";
        setState({ status: "failed", message });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce]);

  const reload = useCallback(() => {
    // 在事件回调里置「加载中」，而不是在 effect 里同步改状态。
    setState({ status: "loading" });
    setNonce((value) => value + 1);
  }, []);
  return { state, reload };
}

export function AdminNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}): ReactNode {
  return (
    <p className="data-notice" role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/** 写操作的失败文案：区分版本冲突、缺条件、校验与其它故障。 */
export function describeWriteFailure(error: unknown): { message: string; conflict: boolean } {
  if (error instanceof ApiClientError) {
    if (error.status === 412) {
      return {
        message: "内容已在别处更新（412）。你的输入还留着：先重新读取最新版本，再决定要不要覆盖。",
        conflict: true,
      };
    }
    if (error.status === 428) {
      return { message: "缺少版本条件（428）：请重新读取这一条再提交。", conflict: true };
    }
    if (error.status === 401) {
      return { message: "需要站主登录（401）。", conflict: false };
    }
    if (error.status === 403) {
      return { message: `请求被拒绝（403 · ${error.code}）。`, conflict: false };
    }
    if (error.status === 409) {
      return { message: error.message, conflict: false };
    }
    if (error.status === 422) {
      const fields = Object.entries(error.fields)
        .map(([key, messages]) => `${key}：${messages.join("；")}`)
        .join(" / ");
      return { message: `字段校验失败（422）：${fields || error.message}`, conflict: false };
    }
    return { message: `保存失败（HTTP ${error.status} · ${error.code}）`, conflict: false };
  }
  return { message: "连不上服务，改动没有保存。", conflict: false };
}

export function unauthorisedHint(): ReactNode {
  return (
    <>
      还没有站主会话。
      <SiteLink href="/admin/login" source="top-nav">
        去登录
      </SiteLink>
    </>
  );
}
