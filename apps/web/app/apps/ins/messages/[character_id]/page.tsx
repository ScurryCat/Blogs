/**
 * 一对一角色会话 `/apps/ins/messages/<character_id>`（T08 独占路由）。
 *
 * URL 只表达**角色与界面**：没有 conversation UUID、没有消息内容、没有会话凭证
 * （08 §2）。因此把链接分享给别人不会带过去任何聊天记录 —— 对方打开时拿到的是
 * 他自己的一段全新会话。
 *
 * 非法角色标识在这里就 `notFound()`（服务端组件，返回真正的 404 状态码），
 * 不做「模糊匹配」，也不执行任意路径。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { InsMessagesApp } from "@/features/messaging/ins-integration";
import { normalizeCharacterId } from "@/features/messaging/types";
import "@/features/messaging/messaging.css";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "角色消息",
  description: "一段非官方同人的角色会话；预设剧情由本站写好，自由聊天由 AI 生成。",
};

interface PageProps {
  params: Promise<{ character_id: string }>;
}

export default async function InsConversationPage({ params }: PageProps): Promise<ReactNode> {
  const { character_id } = await params;
  const characterId = normalizeCharacterId(character_id);
  if (characterId === null) notFound();
  return (
    <AppPageShell>
      <InsMessagesApp characterId={characterId} />
    </AppPageShell>
  );
}
