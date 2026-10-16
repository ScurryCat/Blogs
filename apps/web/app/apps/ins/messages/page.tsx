/**
 * INS 消息页 `/apps/ins/messages`（T08 独占路由）。
 *
 * 这是 canonical 入口：渲染**同一个 INS 壳**，只是初始页签是「消息」。
 * 因此它和手机里的 INS 视图共用同一批组件与同一条公开接口（03 §1）。
 *
 * 服务端组件 + 客户端组合件的分工：
 *   - 本文件（服务端）只做路由与元数据；
 *   - `InsMessagesApp` 是客户端组合件 —— 页签描述里含 `render` / `isAvailable`
 *     两个**函数**，而 React 不允许把函数从服务端组件传给客户端组件，
 *     所以注入必须发生在客户端这一侧（见 `features/messaging/ins-integration.tsx`）。
 *
 * 会话本身不需要 SSR：它是按访客 Cookie 现场创建 / 读取的，服务端没有可预取的内容。
 *
 * 与 T03 的 `/apps/ins/<uuid>` 的关系：静态段优先于动态段，
 * 因此 `/apps/ins/messages` 不会被 `[id]` 吞掉（T03 已用 404 断言过这一点）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { InsMessagesApp } from "@/features/messaging/ins-integration";
import "@/features/messaging/messaging.css";

export const metadata: Metadata = {
  title: "角色消息",
  description:
    "本站自制的非官方同人角色会话：预设剧情由本站写好，自由聊天由 AI 生成。不接入任何真实社交平台。",
};

export default function InsMessagesPage(): ReactNode {
  return <InsMessagesApp />;
}
