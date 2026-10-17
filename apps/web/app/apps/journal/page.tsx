/**
 * 独立页 `/apps/journal`（07 §7 的 canonical 入口）。
 *
 * 手机里的内置应用与这一页渲染**同一个** `JournalView`，差别只在注入的宿主：
 * 这里用站点的导航协调器、Toast 与本机状态。视图依赖浏览器同源 API 与 URL 状态，
 * 因此外壳是服务端组件（静态），交互在客户端。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { JournalPageShell } from "@/features/journal/page-shell";
import { JournalStandalone } from "@/features/journal/standalone";

export const metadata: Metadata = {
  title: "手记",
  description: "按日期记录日常：心情、地点、照片与正文。附带只标记真实公开记录的日历。",
};

export default function JournalPage(): ReactNode {
  return (
    <JournalPageShell>
      {/*
        视图通过 `useSearchParams()` 读 `screen`，因此必须有 Suspense 边界，
        否则整页会被强制变成动态渲染（Next 的 CSR bailout）。
      */}
      <Suspense
        fallback={
          <p className="data-notice" role="status">
            正在读取手记…
          </p>
        }
      >
        <JournalStandalone />
      </Suspense>
    </JournalPageShell>
  );
}
