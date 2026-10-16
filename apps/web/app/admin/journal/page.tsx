/**
 * 管理页 `/admin/journal`（05 §7 的站主维护入口）。
 *
 * 只读外壳 + 客户端交互：真正的权限、CSRF、版本条件与发布门槛都在 FastAPI。
 * 未登录时页面明确说明，而不是显示一个假装能用的按钮（01 §3）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { JournalWorkspace } from "@/features/journal/admin/journal-workspace";

export const metadata: Metadata = {
  title: "手记管理",
  robots: { index: false, follow: false },
};

export default function AdminJournalPage(): ReactNode {
  return <JournalWorkspace />;
}
