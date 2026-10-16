/**
 * 管理后台外壳（所有权 T02；`app/admin/login/` 的登录视图归 T01）。
 *
 * 这里只提供**外壳**：标题、返回站点、内容区与「隐藏按钮不是安全边界」的说明。
 * 真正的鉴权、会话与权限判断在 FastAPI（01 §3），本布局不做任何访问控制，
 * 也不声称已经保护了下面的页面。
 *
 * T01 可在此布局内放 `app/admin/login/page.tsx`；需要改外壳结构时按集成交付单申请。
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

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
        <nav aria-label="管理导航">
          <Link href="/">回到站点</Link>
        </nav>
      </header>
      <div className="admin-body">{children}</div>
      <p className="admin-note">
        本页只是前端外壳：隐藏入口、手机 manifest 里的标记都不是安全边界，
        写操作一律由后端验证站主会话（01 §3）。
      </p>
    </div>
  );
}
