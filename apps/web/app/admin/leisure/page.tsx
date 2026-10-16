/**
 * 管理页 `/admin/leisure`（05 §7 的站主维护入口）。
 *
 * 权限、CSRF、版本条件与类型字段守卫都在 FastAPI；本页只做交互与如实提示。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LeisureWorkspace } from "@/features/leisure/admin/leisure-workspace";

export const metadata: Metadata = {
  title: "放课后管理",
  robots: { index: false, follow: false },
};

export default function AdminLeisurePage(): ReactNode {
  return <LeisureWorkspace />;
}
