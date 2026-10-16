/**
 * 站主登录 / 会话的前端接口（T01 最小登录页用）。
 *
 * 边界（01 §2 / 05 §5）：
 *  - 一律通过共享 API 客户端 `lib/api/client.ts` 访问同源 `/api/v1`；
 *  - 读取（GET /auth/session）会退避重试一次；登录 / 注销是写操作，**不自动重试**（05 §10）；
 *  - CSRF token 由服务端随 `GET /auth/session` 返回，写在请求体的 `csrf_token` 字段里；
 *    服务端同样接受 `X-CSRF-Token` 请求头（共享客户端加上 headers 选项后可直接切换）；
 *  - 会话凭证只存在服务端下发的 HttpOnly Cookie 里，前端**不写 localStorage / sessionStorage**。
 */

import { apiRequest } from "@/lib/api/client";

export const AUTH_PATHS = {
  session: "/auth/session",
  login: "/auth/login",
  logout: "/auth/logout",
} as const;

export interface SessionUser {
  id: string;
  username: string;
}

export interface SessionStatus {
  authenticated: boolean;
  user: SessionUser | null;
  csrf_token: string;
  expires_at: string | null;
  prelogin: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

/** 读取会话状态；没有会话时服务端会建立 10 分钟预登录会话并下发 CSRF token。 */
export function fetchSession(signal?: AbortSignal): Promise<SessionStatus> {
  return apiRequest<SessionStatus>(AUTH_PATHS.session, { signal });
}

export function login(
  credentials: LoginCredentials,
  csrfToken: string,
  signal?: AbortSignal,
): Promise<SessionStatus> {
  return apiRequest<SessionStatus>(AUTH_PATHS.login, {
    method: "POST",
    body: {
      username: credentials.username,
      password: credentials.password,
      csrf_token: csrfToken,
    },
    signal,
  });
}

/** 注销。204 时共享客户端返回 undefined。 */
export function logout(csrfToken: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>(AUTH_PATHS.logout, {
    method: "POST",
    body: { csrf_token: csrfToken },
    signal,
  });
}
