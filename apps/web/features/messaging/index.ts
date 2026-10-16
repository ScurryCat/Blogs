/**
 * 角色消息模块的公开入口（T00 接线只需要这里的三个名字）。
 *
 * ```ts
 * import { MESSAGES_TAB, MESSAGING_PHONE_SCREENS, ConversationScreen } from "@/features/messaging";
 * ```
 *
 * 本模块**不导出**任何会话内容、凭证或内部状态 —— 接线方只能拿到
 * 页签描述、屏幕名与一个视图组件。
 */

export { MESSAGES_TAB, MessagesTabBody } from "./messages-tab";
export {
  MESSAGES_TAB_ID,
  MESSAGES_TAB_ORDER,
  MESSAGING_LIST_SCREEN,
  MESSAGING_CONVERSATION_SCREEN,
} from "./types";
export { MESSAGING_APP_SCREENS, MessagingPhoneView } from "./phone-view";
export { ConversationScreen } from "./conversation-screen";
export { ConversationView } from "./conversation-view";
export { CharacterList } from "./character-list";
export { MESSAGES_APP_PATH, conversationAppPath, phoneConversationTarget } from "./paths";
export type { Character, ConversationView as ConversationViewData, SessionView } from "./types";
