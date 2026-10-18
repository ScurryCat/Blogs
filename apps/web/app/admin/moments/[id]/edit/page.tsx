/**
 * INS 独立编辑页（编辑已有）`/admin/moments/<uuid>/edit`（P5 第一批 · C3）。
 *
 * - 非 UUID 直接 404（与 `/apps/ins/<uuid>` 的动态段规则一致，不吞静态路由）；
 * - 服务端只做路由与 metadata；读正式内容、复用工作草稿、显式提交都在客户端编辑器里；
 * - `useSearchParams`（returnTo、entry）需要 Suspense 边界。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { MomentEditorPage } from "@/features/ins/editor/moment-editor-page";
import { isMomentId } from "@/features/ins/types";

export const metadata: Metadata = {
  title: "编辑动态",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMomentPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!isMomentId(id)) notFound();

  return (
    <Suspense fallback={<p className="ins-loading">正在打开编辑器…</p>}>
      <MomentEditorPage targetId={id} />
    </Suspense>
  );
}
