"use client";

/**
 * INS 接线（T08 提供的**最小侵入**组合件）。
 *
 * 为什么需要这一层：`MESSAGES_TAB` 里含 `render` 与 `isAvailable` 两个**函数**。
 * React 不允许把函数从服务端组件传给客户端组件（「Functions cannot be passed directly
 * to Client Components」），而 T03 的 `app/apps/ins/page.tsx` 是服务端组件。
 * 因此在客户端这一侧把页签注入进去，服务端页面只需要换一个组件名即可：
 *
 * ```tsx
 * // app/apps/ins/page.tsx（T00 改两处：import 与 JSX 名称，其余 props 原样）
 * - import { InsApp } from "@/features/ins/ins-app";
 * + import { InsAppWithMessages } from "@/features/messaging/ins-integration";
 * - <InsApp tag={tag} … />
 * + <InsAppWithMessages tag={tag} … />
 * ```
 *
 * 本文件只做「组合」，不复制 T03 的任何实现，也不修改它的文件。
 */

import { useMemo, type ReactNode } from "react";

import { InsApp, type InsAppProps } from "@/features/ins/ins-app";
import type { InsTabContribution } from "@/features/ins/composition";

import { ConversationScreen } from "./conversation-screen";
import { MESSAGES_TAB } from "./messages-tab";
import { MESSAGES_TAB_ID } from "./types";

/** 把消息页签并入 INS：`/apps/ins` 与手机里的 INS 视图共用。 */
export function InsAppWithMessages(props: InsAppProps): ReactNode {
  const contributions = [MESSAGES_TAB];
  return <InsApp {...props} tabContributions={contributions} />;
}

export interface InsMessagesAppProps extends Omit<InsAppProps, "tabContributions" | "initialTab"> {
  /** 给了角色 id 就在消息页签里直接打开那段会话；没给就是角色列表。 */
  characterId?: string | null;
}

/**
 * 消息页签的独立入口：`/apps/ins/messages`（列表）与
 * `/apps/ins/messages/<character_id>`（一对一）共用它。
 *
 * 两处渲染的是**同一个壳与同一套组件**，因此手机与 canonical 页面内容一致（03 §1）。
 */
export function InsMessagesApp({ characterId = null, ...props }: InsMessagesAppProps): ReactNode {
  const contribution = useMemo<InsTabContribution>(() => {
    if (characterId === null) return MESSAGES_TAB;
    return {
      ...MESSAGES_TAB,
      // 同一个页签、同一套界面，只是内容换成某一段会话。
      // key 让会话组件按角色重挂：草稿、控制器状态都不会串到另一个人身上。
      render: () => (
        <ConversationScreen key={characterId} characterId={characterId} linkSource="phone-link" />
      ),
    };
  }, [characterId]);

  return (
    <InsApp
      {...props}
      initialTab={MESSAGES_TAB_ID}
      tabContributions={useMemo(() => [contribution], [contribution])}
    />
  );
}
