/**
 * 管理页 `/admin/leisure`（05 §7 的站主维护入口）。
 *
 * 权限、CSRF、版本条件与类型字段守卫都在 FastAPI；本页只做交互与如实提示。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { LeisureWorkspace } from "@/features/leisure/admin/leisure-workspace";

export const metadata: Metadata = {
  title: "放课后管理",
  robots: { index: false, follow: false },
};

export default function AdminLeisurePage(): ReactNode {
  return (
    // 快捷更新区用 useSearchParams 读 returnTo（来自前台入口），必须有 Suspense 边界。
    <Suspense
      fallback={
        <p className="data-notice" role="status">
          正在打开放课后管理…
        </p>
      }
    >
      <LeisureWorkspace />
    </Suspense>
  );
}
