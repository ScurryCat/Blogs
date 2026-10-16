/**
 * 管理页 `/admin/friends`（05 §7 的站主维护入口）。
 *
 * 只读外壳 + 客户端交互：真正的权限、CSRF、版本条件与校验都在 FastAPI。
 * 未登录时页面会明确提示去登录，而不是显示一个假装能用的按钮（01 §3）。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { FriendsAdmin } from "@/features/coop/admin/friends-admin";

export const metadata: Metadata = {
  title: "友链管理",
  robots: { index: false, follow: false },
};

export default function AdminFriendsPage(): ReactNode {
  return <FriendsAdmin />;
}
