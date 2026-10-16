/**
 * 管理页 `/admin/palaces/[id]`：编辑与预览一座专题。
 *
 * `id` 是 UUID（05 §2：UUID 是业务 ID，slug 只用于公开 URL）。非法 UUID 由服务端 422 拒绝，
 * 页面显示明确的失败态而不是空表单。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PalaceAdminEditor } from "@/features/metanav/admin/palace-admin-editor";

export const metadata: Metadata = {
  title: "编辑专题",
  robots: { index: false, follow: false },
};

export default async function AdminPalacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <PalaceAdminEditor id={decodeURIComponent(id)} />;
}
