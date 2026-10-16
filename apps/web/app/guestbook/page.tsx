/**
 * 留言页 `/guestbook`（旧站 `guestbook.html`）。
 *
 * 边界：**本机留言仍是本机留言**（`store: 'local'`，只存在访客自己的浏览器里），
 * 迁移不把它偷偷变成共享留言；真正的公共留言要等后端契约与权限设计。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { GuestbookView } from "@/features/legacy/pages/guestbook-view";

export const metadata: Metadata = {
  title: "Guestbook",
  description: "留言板（示例模式：留言只保存在你自己的浏览器里）。",
};

export default function GuestbookPage(): ReactNode {
  return <GuestbookView />;
}
