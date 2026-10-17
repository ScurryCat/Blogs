/**
 * 独立页 `/apps/metanav`（设计 04 §4 的 canonical 入口）。
 *
 * 手机里的内置应用与这一页渲染**同一个** `MetanavView`（SHARED-CONTRACTS §1），
 * 差别只在注入的宿主：这里用站点的导航协调器、Toast 与本机状态。
 * 由于视图依赖浏览器同源 API 与 URL 状态，页面外壳是服务端组件，交互在客户端。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { MetanavStandalone } from "@/features/metanav/standalone";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "异世界导航",
  description: "专题殿堂、认知关键词定位与印象空间：可以直接用的专题导航。",
};

export default function MetanavPage(): ReactNode {
  return (
    <AppPageShell>
      {/*
        视图通过 `useSearchParams()` 读 `screen` / `item`，因此必须有 Suspense 边界，
        否则整页会被强制变成动态渲染（Next 的 CSR bailout）。静态外壳 + 客户端交互，
        与手机宿主的做法一致（T02 的 SiteRuntime 也是这么包的）。
      */}
      <Suspense
        fallback={
          <p className="data-notice" role="status">
            正在读取导航…
          </p>
        }
      >
        <MetanavStandalone />
      </Suspense>

      {/*
        印象空间入口（T09 交付，T00 接线）。
        07 §7 把印象空间描述为「导航内部的一层」，因此这里是导航页里的入口，
        而不是手机桌面上的独立图标（不登记 manifest）。
      */}
      <p className="pls-card-meta">
        遇到过的坑与查到的答案在
        {" "}
        <SiteLink href="/apps/metanav/mementos" source="phone-link">
          印象空间问题记录
        </SiteLink>
        。
      </p>
    </AppPageShell>
  );
}
