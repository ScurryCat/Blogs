/**
 * IM 草稿（任务书 §3.3：「返回时保留…输入草稿」）。
 *
 * 为什么需要单独存：草稿原本是 `useConversation` 里的 `useState`，而控制器由
 * `conversation-screen` 创建 —— 离开会话时组件卸载，草稿随之消失；
 * 从角色列表点回来，输入框是空的。
 *
 * 存在 `sessionStorage`（按角色分键）：只在本标签页有效，关掉标签就没了 ——
 * 草稿不是要长期保存的数据，也不该在同一台设备的不同人之间串。
 * 存储不可用时安静降级：草稿丢失是体验问题，不能因此让聊天发不出去。
 */

const KEY_PREFIX = "msg.draft.v1";

export function draftKey(characterId: string): string {
  return `${KEY_PREFIX}:${characterId}`;
}

/** 读某个角色的草稿；没有或存储不可用都返回空串。 */
export function readDraft(characterId: string | null): string {
  if (!characterId) return "";
  try {
    return window.sessionStorage.getItem(draftKey(characterId)) ?? "";
  } catch {
    return "";
  }
}

/** 写草稿；空串表示清掉记录（发送成功、切回话题都会清）。 */
export function writeDraft(characterId: string | null, value: string): void {
  if (!characterId) return;
  try {
    if (value) window.sessionStorage.setItem(draftKey(characterId), value);
    else window.sessionStorage.removeItem(draftKey(characterId));
  } catch {
    // 配额满 / 隐私模式：忽略，不影响聊天本身。
  }
}
