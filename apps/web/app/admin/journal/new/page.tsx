/**
 * `/admin/journal/new`：手记独立编辑页（新建）。
 *
 * 权限、版本条件、发布门槛都在 FastAPI；本页只做交互。`?date=YYYY-MM-DD` 从日历入口带入，
 * 缺省使用站点时区今天（由编辑器装载器从公开日历接口读取，前端不自己猜时区）。
 * `?returnTo=` 由 C2 的 `readReturnTo` 校验（白名单）；非法时编辑器返回 `/admin`。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { JournalNewEditor } from "@/features/journal/editor/editor-loaders";

export const metadata: Metadata = {
  title: "写手记",
  robots: { index: false, follow: false },
};

export default function NewJournalPage(): ReactNode {
  return (
    // 编辑器用 useSearchParams 读 date/returnTo，必须有 Suspense 边界。
    <Suspense
      fallback={
        <p className="data-notice" role="status">
          正在打开手记编辑器…
        </p>
      }
    >
      <JournalNewEditor />
    </Suspense>
  );
}
