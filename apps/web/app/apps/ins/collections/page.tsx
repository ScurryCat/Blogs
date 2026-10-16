/**
 * 本机收藏页 `/apps/ins/collections`（T03）。
 *
 * 为什么单独做一个静态路由：动态详情是 `/apps/ins/<uuid>`，而收藏不是某一条内容，
 * 因此需要一段**不与 UUID 冲突的静态路径**。这里也是「`/apps/ins/messages` 之类的
 * 静态路由将来由 T08 接管」这条规则的实例：静态段优先，不会被 UUID 校验吞掉。
 *
 * 内容全部来自浏览器本机存储，因此这个页面不读服务端数据；每一条收藏在展示前会
 * 重新确认内容是否仍公开（03 §7）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { InsApp } from "@/features/ins/ins-app";
import { INS_SAVED_TAB } from "@/features/ins/composition";
import "@/features/ins/ins.css";

export const metadata: Metadata = {
  title: "本机收藏",
  description: "只保存在此浏览器里的图文收藏；再次打开会重新确认内容是否仍公开。",
  robots: { index: false, follow: false },
};

export default function InsCollectionsPage(): ReactNode {
  // initialTab 让壳直接落在「收藏」页签；收藏数据在客户端从本机存储读取。
  return <InsApp initialTab={INS_SAVED_TAB} />;
}
