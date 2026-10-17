/**
 * 独立页 `/apps/leisure`（07 §7）。
 *
 * 手机里的内置应用与这一页渲染**同一个** `LeisureView`，差别只在注入的宿主。
 * 视图依赖浏览器同源 API 与 URL 状态，因此外壳是服务端组件，交互在客户端。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { LeisureStandalone } from "@/features/leisure/standalone";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "放课后",
  description: "追番与游戏记录：进度、评分、短评与长评链接。手动维护，不同步第三方账号。",
};

export default function LeisurePage(): ReactNode {
  return (
    <AppPageShell>
      {/* 视图用 `useSearchParams()` 读 `screen`，必须有 Suspense 边界。 */}
      <Suspense
        fallback={
          <p className="data-notice" role="status">
            正在读取放课后…
          </p>
        }
      >
        <LeisureStandalone />
      </Suspense>
    </AppPageShell>
  );
}
