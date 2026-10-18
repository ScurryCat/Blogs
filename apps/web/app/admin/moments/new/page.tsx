/**
 * INS 独立编辑页（新建）`/admin/moments/new`（P5 第一批 · C3）。
 *
 * 服务端只做路由与 metadata；编辑器在客户端（要读会话、工作草稿与 URL 上的 returnTo）。
 * `useSearchParams` 需要 Suspense 边界，这里包一层，避免构建期静态化报错。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { MomentEditorPage } from "@/features/ins/editor/moment-editor-page";

export const metadata: Metadata = {
  title: "新建动态",
  robots: { index: false, follow: false },
};

export default function NewMomentPage(): ReactNode {
  return (
    <Suspense fallback={<p className="ins-loading">正在打开编辑器…</p>}>
      <MomentEditorPage targetId={null} />
    </Suspense>
  );
}
