/**
 * `/apps/leblanc`：勒布朗近况的**独立可见入口**（07 §3）。
 *
 * 为什么有这一页：勒布朗的正式位置是首页的一块（首页 `app/page.tsx` 归 T02，
 * 由集成方按交付单的接线申请挂载）。在首页接线之前，这一页让同一个
 * `LeblancView` 可以被直接访问、分享与真实浏览器验收 —— 组件本身与首页要用的是
 * **同一个**，不存在「验收用副本」。
 *
 * 页面是客户端组件：近况块各自读取同源 API，音乐块读根布局里那个唯一的 `<audio>`。
 * 一个应用 API 失败只让那一块降级，音乐与整页不受影响（验收 5）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LeblancView } from "@/features/leblanc/leblanc-view";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "勒布朗",
  description: "近况、最近一篇公开手记、正在追番与正在玩的游戏，以及现有的音乐控制。",
};

export default function LeblancPage(): ReactNode {
  return (
    <AppPageShell>
      <LeblancView />
    </AppPageShell>
  );
}
