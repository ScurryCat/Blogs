"use client";

/**
 * 消息页签的**组合契约实例**（供 T00 接线到 T03 的 InsShell；本包不修改 INS 壳）。
 *
 * 用法（T00 在 `app/apps/ins/page.tsx` 与 `features/ins/phone-app.tsx` 里加两行）：
 *
 * ```tsx
 * import { MESSAGES_TAB } from "@/features/messaging";
 * <InsApp tabContributions={[MESSAGES_TAB]} … />
 * ```
 *
 * 规则（`features/ins/composition.ts`）：
 *  - 页签 id 不能用内置的 `feed` / `saved`，否则 `resolveTabs` 会抛 `InsTabConflictError`；
 *    这里用的是 `messages`（T03 的单测里也是这个 id / order，两处一致）；
 *  - `order = 40`，排在相册（T06，30）之后；
 *  - `isAvailable()` 恒为 true：模块一旦接线就可用。**AI 是否可用是页签内部的事**
 *    （页内明确显示「自由聊天暂时不可用，预设剧情仍可继续」），
 *    而不是把整个消息页签藏起来 —— 藏起来会让访客以为「这个站没有角色消息」。
 */

import type { ReactNode } from "react";

import type { InsTabContribution, InsTabContext } from "@/features/ins/composition";

import { CharacterList } from "./character-list";
import { MESSAGES_TAB_ID, MESSAGES_TAB_ORDER } from "./types";

export function MessagesTabBody({ tag }: InsTabContext): ReactNode {
  // `tag` 是动态页签的筛选条件，与角色消息无关；显式忽略而不是透传，
  // 避免以后有人以为「消息也跟着标签筛选」。
  void tag;
  return (
    <div className="msg-app msg-app-tab">
      <CharacterList linkSource="phone-link" />
    </div>
  );
}

export const MESSAGES_TAB: InsTabContribution = {
  id: MESSAGES_TAB_ID,
  label: "消息",
  ariaLabel: "角色消息（非官方同人会话）",
  order: MESSAGES_TAB_ORDER,
  isAvailable: () => true,
  render: MessagesTabBody,
};

export { MESSAGES_TAB_ID, MESSAGES_TAB_ORDER };
