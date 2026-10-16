/**
 * 根布局。
 *
 * ⚠️ 所有权：**T02**（SHARED-CONTRACTS §2）。T00 只放一个能让 `next build` 通过的最小占位，
 * 由 T02 替换为持久外壳：`SiteRuntime` 客户端组件（AudioService / NavigationCoordinator /
 * PhoneProvider / Toast / OverlayManager），并保持根布局为 Server Component。
 *
 * 01 §4 的红线：不要把整棵树改成 `use client`；不要在每次挂载时新建播放器。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PHANTOM LOG",
  description: "怪盗手记 —— 课后据点",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
