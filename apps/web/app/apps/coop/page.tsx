/**
 * 独立页 `/apps/coop`（07 §7 的友链 canonical 入口）。
 *
 * 手机里的内置应用与这一页渲染**同一个** `CoopView`（SHARED-CONTRACTS §1），
 * 差别只在注入的宿主：这里用站点导航协调器 + URL 查询参数。视图依赖同源 API
 * 与 `useSearchParams()`，所以外壳是服务端组件、交互在客户端，并显式包 Suspense
 * 边界（否则整页会被迫变成动态渲染）。
 */

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { CoopStandalone } from "@/features/coop/standalone";

export const metadata: Metadata = {
  title: "协助者 · 友链",
  description: "真实站点的友链通讯录：按站主整理的顺序浏览，没有等级与访问量排名。",
};

export default function CoopPage(): ReactNode {
  return (
    <section className="shell">
      <Suspense
        fallback={
          <p className="data-notice" role="status">
            正在读取协助者…
          </p>
        }
      >
        <CoopStandalone />
      </Suspense>
      <p className="data-notice" role="note">
        这一页可以直接分享或加入书签：地址栏里的 <code>tag</code> 决定筛选，
        <code>item</code> 决定展开哪一条友链。名单里的每一条都是真实站点；
        角色消息属于同人剧情，与友链是两份数据。
      </p>
    </section>
  );
}
