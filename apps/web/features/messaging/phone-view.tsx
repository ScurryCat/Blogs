"use client";

/**
 * 角色消息的手机内置视图（`PhoneViewProps` 形状）。
 *
 * 宿主契约（`features/phone/types.ts`、02 §4）：
 *  - 只用 `PhoneViewProps` 的四个字段与 `host` 的八项能力；
 *  - **不碰全局 DOM、不锁 body、不新增 `<audio>`、不覆写 history**；
 *  - 非法 `item`（不是角色 id）显示「未找到」，**不执行任意路径**；
 *  - 音乐继续播放：本视图不创建、不播放任何音频。
 *
 * `screen` 与 `item` 的对应：
 *  - `messages`     角色列表（`item` 忽略）
 *  - `conversation` `item` 必须是角色 id（08 §2 的 `phone=ins&screen=conversation&item=<id>`）
 */

import { useCallback, type ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { CharacterList } from "./character-list";
import { ConversationScreen } from "./conversation-screen";
import { normalizeCharacterId } from "./types";

/** 与 `phone-app.tsx` 的 `screens` 保持一致。 */
export const MESSAGING_APP_SCREENS = ["messages", "conversation"] as const;

export function MessagingPhoneView({ screen, item, mode, host }: PhoneViewProps): ReactNode {
  const openCharacter = useCallback(
    (characterId: string) => {
      // 宿主管理返回与历史（02 §6）；应用只声明目的地。
      host.navigateScreen("conversation", characterId);
    },
    [host],
  );

  if (screen === "conversation") {
    const characterId = normalizeCharacterId(item);
    if (characterId === null) {
      return (
        <div className="msg-app">
          <div className="msg-state" role="status">
            <p className="msg-state-kicker">NOT FOUND</p>
            <h2>没有这个角色</h2>
            <p>链接里的角色标识不合法。</p>
            <button
              type="button"
              className="msg-btn"
              onClick={() => host.navigateScreen("messages")}
            >
              回到角色列表
            </button>
          </div>
        </div>
      );
    }
    return <ConversationScreen characterId={characterId} linkSource="phone-internal" />;
  }

  return (
    <div className="msg-app">
      <CharacterList linkSource="phone-internal" onOpen={openCharacter} />
      <p className="msg-phone-hint" role="note">
        {mode === "expanded"
          ? "展开视图：点角色进入会话，返回由手机统一处理。"
          : "点角色进入会话；返回由手机处理，音乐会继续播放。"}
      </p>
    </div>
  );
}

/** 独立入口（`phone-app.tsx` 也把它作为 default 导出，方便宿主直接 import）。 */
export default MessagingPhoneView;
