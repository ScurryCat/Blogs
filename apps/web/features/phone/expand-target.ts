/**
 * 手机「展开查看」的目的地（02 §4 / 03 §1）。
 *
 * 展开查看必须把**当前手机上下文**带进 canonical 页面：对 INS 会话来说，
 * 只展开到 `manifest.canonical_path`（`/apps/ins`）会丢掉角色和会话，
 * 草稿虽然按角色持久化，用户却找不到刚才那段聊天。因此这里按应用声明
 * 「展开到哪一屏」：
 *
 *  - INS + `screen=conversation&item=<role>` → `/apps/ins/messages/<role>`
 *  - INS + `screen=messages`               → `/apps/ins/messages`
 *  - 其他（含 INS 的 feed/detail/saved）    → `manifest.canonical_path`
 *
 * 纯函数：宿主只负责调用 `host.openSiteContent({destination, source: "phone-link"})`，
 * 不在这里新造 URL 查询参数，也不碰 history。角色 id 先过
 * `normalizeCharacterId`，非法 item（例如 `../x`）回落到 canonical，不拼任意路径。
 */

import { MESSAGES_APP_PATH, conversationAppPath } from "@/features/messaging/paths";
import { normalizeCharacterId } from "@/features/messaging/types";

import type { PhoneAppManifest, PhoneUrlState } from "./types";

/** INS 的稳定应用 id（与 `features/ins/phone-manifest.tsx` 的 `INS_APP_ID` 一致）。 */
export const INS_PHONE_APP_ID = "ins";

export function expandDestination(
  manifest: PhoneAppManifest,
  state: PhoneUrlState | null,
): string {
  // 只处理「当前 URL 确实停在这个应用上」的情况；状态缺失或不一致时保守回 canonical。
  if (manifest.id !== INS_PHONE_APP_ID || state === null || state.phone !== INS_PHONE_APP_ID) {
    return manifest.canonical_path;
  }

  if (state.screen === "conversation") {
    const characterId = normalizeCharacterId(state.item);
    return characterId === null ? manifest.canonical_path : conversationAppPath(characterId);
  }

  if (state.screen === "messages") {
    return MESSAGES_APP_PATH;
  }

  return manifest.canonical_path;
}
