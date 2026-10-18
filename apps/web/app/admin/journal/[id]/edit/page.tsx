/**
 * `/admin/journal/[id]/edit`：手记独立编辑页（编辑已有）。
 *
 * 打开即创建/复用该手记的工作草稿（跨设备继续编辑）；编辑已公开手记时，
 * 「更新正式内容」（commit update）之前访客继续看到原版本。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { JournalEditEditor } from "@/features/journal/editor/editor-loaders";

export const metadata: Metadata = {
  title: "编辑手记",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditJournalPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <p className="data-notice" role="status">
          正在打开手记编辑器…
        </p>
      }
    >
      <JournalEditEditor entryId={decodeURIComponent(id)} />
    </Suspense>
  );
}
