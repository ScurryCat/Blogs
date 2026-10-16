/**
 * 角色消息的浏览器端 API（T08）。
 *
 * 边界（SHARED-CONTRACTS §1）：
 *  - 只用 `lib/api/client.ts`（同源 `/api/v1`、`no-store`、读失败退避重试一次、写不重试）；
 *  - **不 import `lib/api/server.ts`**：那个模块在浏览器里会立即抛错。
 *
 * 写操作的两件必需的事，都是踩过的坑：
 *  1. **CSRF token 放 JSON body**（`csrf_token`）。共享客户端没有 `headers` 选项
 *     （T01 交付单 §7 第 6 条），而服务端同时接受 `X-CSRF-Token` 头与 body 字段。
 *     T03 就是因为漏了这一步，所有管理写操作在生产形态下都是 403。
 *  2. 访客会话要先 `POST /messaging/session` 拿到 token —— 那是唯一的引导接口。
 */

import { ApiClientError, apiRequest } from "@/lib/api/client";

import {
  CHARACTERS_PATH,
  CONVERSATIONS_PATH,
  SESSION_PATH,
  STATUS_PATH,
  conversationActionPath,
  conversationApiPath,
} from "./paths";
import type { Character, ConversationView, SessionView, StatusView } from "./types";

function withCsrf<T extends object>(csrfToken: string, payload: T): T & { csrf_token: string } {
  return { ...payload, csrf_token: csrfToken };
}

// --- 读取（不需要 CSRF）----------------------------------------------------

export function fetchStatus(signal?: AbortSignal): Promise<StatusView> {
  return apiRequest<StatusView>(STATUS_PATH, { signal });
}

export function fetchCharacters(signal?: AbortSignal): Promise<Character[]> {
  return apiRequest<Character[]>(CHARACTERS_PATH, { signal });
}

export function fetchConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationView> {
  return apiRequest<ConversationView>(conversationApiPath(conversationId), { signal });
}

// --- 会话引导 --------------------------------------------------------------

/** 建立 / 续期访客会话，返回 CSRF token 与角色目录。 */
export function openSession(signal?: AbortSignal): Promise<SessionView> {
  return apiRequest<SessionView>(SESSION_PATH, { method: "POST", body: {}, signal });
}

/** 立即清除该访客的全部角色消息（Cookie 也会被服务端清掉）。 */
export function clearSession(csrfToken: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>(SESSION_PATH, {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    signal,
  });
}

// --- 会话读写 --------------------------------------------------------------

export function createConversation(
  csrfToken: string,
  characterId: string,
  signal?: AbortSignal,
): Promise<ConversationView> {
  return apiRequest<ConversationView>(CONVERSATIONS_PATH, {
    method: "POST",
    body: withCsrf(csrfToken, { character_id: characterId }),
    signal,
  });
}

export function chooseOption(
  csrfToken: string,
  conversationId: string,
  payload: { choiceId: string; nodeId: string; nodeVersion: number; clientMessageId: string },
  signal?: AbortSignal,
): Promise<ConversationView> {
  return apiRequest<ConversationView>(conversationActionPath(conversationId, "choice"), {
    method: "POST",
    body: withCsrf(csrfToken, {
      choice_id: payload.choiceId,
      node_id: payload.nodeId,
      node_version: payload.nodeVersion,
      client_message_id: payload.clientMessageId,
    }),
    signal,
  });
}

/**
 * 自由输入。
 *
 * `client_request_id` 是幂等键，作用域限定到当前访客会话（08 §7）：
 * 网络重试或重复点击会先查已生成结果，**不会**重复调用上游。
 * 因此调用方必须为「同一条用户输入」复用同一个 id，不要每次重试都生成新的。
 */
export function sendMessage(
  csrfToken: string,
  conversationId: string,
  payload: { text: string; clientRequestId: string },
  signal?: AbortSignal,
): Promise<ConversationView> {
  return apiRequest<ConversationView>(conversationActionPath(conversationId, "messages"), {
    method: "POST",
    body: withCsrf(csrfToken, {
      text: payload.text,
      client_request_id: payload.clientRequestId,
    }),
    signal,
  });
}

export function resumeTopic(
  csrfToken: string,
  conversationId: string,
  nodeVersion: number,
  signal?: AbortSignal,
): Promise<ConversationView> {
  return apiRequest<ConversationView>(conversationActionPath(conversationId, "resume"), {
    method: "POST",
    body: withCsrf(csrfToken, { node_version: nodeVersion }),
    signal,
  });
}

export function restartStory(
  csrfToken: string,
  conversationId: string,
  nodeVersion: number,
  signal?: AbortSignal,
): Promise<ConversationView> {
  return apiRequest<ConversationView>(conversationActionPath(conversationId, "restart"), {
    method: "POST",
    body: withCsrf(csrfToken, { node_version: nodeVersion }),
    signal,
  });
}

export function clearConversation(
  csrfToken: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(conversationApiPath(conversationId), {
    method: "DELETE",
    body: withCsrf(csrfToken, {}),
    signal,
  });
}

// --- 错误判定（界面据此给出不同文案，而不是一句「出错了」）----------------

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

/** 剧情状态过期（409 `STORY_STATE_STALE`）：读取最新状态，**不**重复消费选项。 */
export function isStaleStory(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409 && error.code === "STORY_STATE_STALE";
}

/** 单会话一在途请求（409 `AI_IN_FLIGHT`）。 */
export function isInflightConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409 && error.code === "AI_IN_FLIGHT";
}

export { ApiClientError };
