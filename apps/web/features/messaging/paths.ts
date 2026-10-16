/**
 * 角色消息的 URL 构造（浏览器端与服务端共用；没有 `fetch`，两端都能安全 import）。
 *
 * 两条与「不要泄漏」有关的规则（08 §2）：
 *  - **canonical URL 只有角色 id**，没有 conversation UUID、没有消息内容、
 *    没有会话凭证。分享角色入口不会分享聊天记录。
 *  - 手机 URL 用 `phone=ins&screen=conversation&item=<character_id>`，
 *    由原宿主管理返回（本模块只负责拼串，不碰 history）。
 */

export const MESSAGING_API = "/messaging";

export const SESSION_PATH = `${MESSAGING_API}/session`;
export const STATUS_PATH = `${MESSAGING_API}/status`;
export const CHARACTERS_PATH = `${MESSAGING_API}/characters`;
export const CONVERSATIONS_PATH = `${MESSAGING_API}/conversations`;
export const ADMIN_OVERVIEW_PATH = "/admin/messaging/overview";

/** canonical：INS 消息页签（角色列表）。 */
export const MESSAGES_APP_PATH = "/apps/ins/messages";

/** canonical：某个角色的一对一会话。 */
export function conversationAppPath(characterId: string): string {
  return `${MESSAGES_APP_PATH}/${encodeURIComponent(characterId)}`;
}

export function conversationApiPath(conversationId: string): string {
  return `${CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}`;
}

export type ConversationAction = "choice" | "messages" | "resume" | "restart";

export function conversationActionPath(
  conversationId: string,
  action: ConversationAction,
): string {
  return `${conversationApiPath(conversationId)}/${action}`;
}

/**
 * 手机宿主用的目标（`features/phone/types.ts` 的 URL 字段）。
 *
 * 只声明「打开哪个角色」，不携带任何会话状态。
 */
export function phoneConversationTarget(characterId: string): {
  phone: string;
  screen: string;
  item: string;
} {
  return { phone: "ins", screen: "conversation", item: characterId };
}

/** 会话内每条消息的锚点 id（滚动定位用；不含任何内容）。 */
export function messageAnchor(messageId: string): string {
  return `msg-${messageId}`;
}
