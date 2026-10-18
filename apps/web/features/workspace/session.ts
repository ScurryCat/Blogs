"use client";

/**
 * 站主身份探针（P5 第一批 · 契约 §4.2 / §9.1）。
 *
 * 为什么不用 `GET /auth/session` 判断访客身份：那个接口会给每个匿名访客建立
 * 10 分钟预登录会话（持续 DB 写放大）。C1 新增了无副作用探针
 * `GET /api/v1/auth/owner-status`（读会话、不创建、不写字）。
 *
 * 行为：
 *  - 模块级缓存 + 在途去重：多个组件同时挂载只发一次探针；
 *  - **确认 `authenticated===true` 之后**才再读一次 `GET /auth/session` 拿完整会话
 *    （编辑器写请求需要的 CSRF token 在那里）；匿名分支绝不调用 `/auth/session`；
 *  - 形状不对（缺 `authenticated` 布尔值）按 `failed` 处理，**只有 `owner` 才渲染入口**，
 *    未知响应对匿名访客不会显示任何站主入口；
 *  - 401 / 主动退出后调用 `resetOwnerSessionCache()` 让缓存失效。
 */

import { useEffect, useSyncExternalStore } from "react";

import { apiRequest } from "@/lib/api/client";
import { fetchSession, type SessionStatus, type SessionUser } from "@/features/auth/api";

/** 无副作用站主探针（C1 实现）。 */
export const OWNER_STATUS_PATH = "/auth/owner-status";

export type OwnerSessionStatus = "loading" | "anonymous" | "owner" | "failed";

export interface OwnerSessionState {
  status: OwnerSessionStatus;
  /** 只有在 `status === "owner"` 时非空，且是完整会话（含 `csrf_token`）。 */
  session: SessionStatus | null;
}

export interface OwnerProbe {
  authenticated: boolean;
  user: SessionUser | null;
}

/** 服务端渲染时的稳定快照（避免 hydration 不一致）。 */
export const INITIAL_OWNER_SESSION: OwnerSessionState = { status: "loading", session: null };

let snapshot: OwnerSessionState = INITIAL_OWNER_SESSION;
let inflight: Promise<OwnerSessionState> | null = null;
/** 每次 reset 自增：旧请求回来时若代号变了就直接丢弃，不写回过期状态。 */
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: OwnerSessionState): OwnerSessionState {
  snapshot = next;
  for (const listener of listeners) listener();
  return snapshot;
}

/** 读取当前快照（非 React 环境/引擎内部用，例如取 CSRF）。 */
export function getOwnerSessionState(): OwnerSessionState {
  return snapshot;
}

/** `useSyncExternalStore` 的订阅函数（不建议业务直接调用）。 */
export function subscribeOwnerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 让缓存失效（401、主动退出登录、登录成功后使用）。
 *
 * 注意：不会中止已经在途的请求，但通过 `generation` 丢弃它们的返回值。
 */
export function resetOwnerSessionCache(): void {
  generation += 1;
  inflight = null;
  publish(INITIAL_OWNER_SESSION);
}

/**
 * 读取站主身份（模块级缓存 + 在途去重）。
 *
 * - `loading` 只在首次/重置后出现；`anonymous` / `owner` 是缓存终态；
 * - `failed`（网络错误/响应形状不对）**不缓存**，下次挂载会重试（只读探针，重试安全）。
 */
export async function loadOwnerSession(): Promise<OwnerSessionState> {
  if (snapshot.status === "owner" || snapshot.status === "anonymous") return snapshot;
  if (inflight) return inflight;

  const currentGeneration = generation;
  inflight = (async (): Promise<OwnerSessionState> => {
    try {
      const probe = await apiRequest<OwnerProbe>(OWNER_STATUS_PATH);
      if (currentGeneration !== generation) return snapshot;
      // 形状不对（缺 authenticated 布尔值）→ failed：未知响应不能当作「确认未登录」，
      // 更不能因此渲染/不渲染任何需要授权的入口。
      if (!probe || typeof probe.authenticated !== "boolean") {
        return publish({ status: "failed", session: null });
      }
      if (!probe.authenticated) {
        return publish({ status: "anonymous", session: null });
      }
      // 已确认是站主才读完整会话：匿名访客永远不会走到这里（不建立预登录会话）。
      const session = await fetchSession();
      if (currentGeneration !== generation) return snapshot;
      if (session.authenticated !== true) {
        return publish({ status: "anonymous", session: null });
      }
      return publish({ status: "owner", session });
    } catch (error) {
      if (currentGeneration !== generation) return snapshot;
      if (error instanceof DOMException && error.name === "AbortError") return snapshot;
      return publish({ status: "failed", session: null });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 强制重新读取（失败重试、登录后刷新用）。 */
export async function refreshOwnerSession(): Promise<OwnerSessionState> {
  resetOwnerSessionCache();
  return loadOwnerSession();
}

/** 站主会话失效（401）专用错误：编辑器据此停止自动保存并提示重新登录。 */
export class OwnerSessionExpiredError extends Error {
  constructor() {
    super("登录已失效，请重新登录。");
    this.name = "OwnerSessionExpiredError";
  }
}

/**
 * 取写请求用的 CSRF token（`useWorkDraft` 内部使用）。
 *
 * 优先用模块缓存；缓存未就绪时复用 `loadOwnerSession()`（仍然先探针后会话，匿名不会建会话）。
 * 拿不到就抛 `OwnerSessionExpiredError`，由自动保存引擎转成「登录已失效，本机输入已保留」。
 */
export async function getOwnerCsrfToken(): Promise<string> {
  const current = await loadOwnerSession();
  const token = current.status === "owner" ? current.session?.csrf_token : null;
  if (!token) throw new OwnerSessionExpiredError();
  return token;
}

/**
 * React hook：订阅站主身份。
 *
 * 返回 `{status, session}`：
 *  - `loading`：探针进行中（服务端渲染也是这个状态）；
 *  - `anonymous`：确认未登录；
 *  - `owner`：确认已登录，`session` 可用（含 CSRF）；
 *  - `failed`：探针/会话读取失败或响应形状不对（不渲染入口）。
 */
export function useOwnerSession(): OwnerSessionState {
  const state = useSyncExternalStore(
    subscribeOwnerSession,
    getOwnerSessionState,
    () => INITIAL_OWNER_SESSION,
  );

  // 挂载时触发读取；缓存命中时 loadOwnerSession 直接返回快照，不发请求。
  // 失败态不缓存：重新挂载（或 reset 后回到 loading）会再试一次（只读探针，重试安全）。
  useEffect(() => {
    if (state.status === "owner" || state.status === "anonymous") return;
    void loadOwnerSession();
  }, [state.status]);

  return state;
}
