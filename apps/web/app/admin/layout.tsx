/**
 * 管理后台外壳（所有权 T02；P5 由 C2 补创作台导航，不改任何业务页面的实际权限）。
 *
 * 这里只提供**外壳**：标题、导航、返回站点、内容区与「隐藏按钮不是安全边界」的说明。
 * 真正的鉴权、会话与权限判断在 FastAPI（01 §3），本布局不做任何访问控制，
 * 也不声称已经保护了下面的页面。
 *
 * `features/workspace/workspace.css` 只在这里引入：`ws-` 样式只作用于管理端，
 * 不会影响公开页面。
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "@/features/workspace/workspace.css";

export const metadata: Metadata = {
  title: { default: "管理", template: "%s · 管理 · PHANTOM LOG" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="admin-shell">
      <header className="admin-bar">
        <p className="kick">{"// Admin"}</p>
        <h1>怪盗手记 · 管理</h1>
        <nav aria-label="管理导航" className="admin-nav">
          <Link href="/admin">创作台</Link>
          <Link href="/admin/moments">动态</Link>
          <Link href="/admin/journal">手记</Link>
          <Link href="/admin/leisure">放课后</Link>
          <Link href="/admin/albums">相册</Link>
          <Link href="/admin#manage">更多管理</Link>
          <Link href="/">回到站点</Link>
        </nav>
      </header>
      <div className="admin-body">{children}</div>
      <p className="admin-note">
        本页只是前端外壳：隐藏入口、手机 manifest 里的标记都不是安全边界，
        写操作一律由后端验证站主会话（01 §3）。创作台的自动保存只写工作草稿，
        不会在用户明确提交前改变访客看到的内容。
      </p>
    </div>
  );
}
