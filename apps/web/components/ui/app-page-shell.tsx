/**
 * 独立应用页（`/apps/*`）的统一外壳。
 *
 * 为什么需要：站点顶部 `.hud` 是 `position: fixed`，而 `app/apps/*` 的独立页历史上
 * 直接返回 `section.shell` 甚至裸组件，内容会从视口顶端开始、被固定导航压住
 * （第二轮交接单 §3.2 / N2 交付单 §8 都记录过：`/apps/leisure` 等同类页被顶栏压住）。
 * 手记当时只在自己的两个页面补了局部留白（`JournalPageShell`）；这里把同一规则
 * 收成一个共享外壳，供其余独立应用页复用，避免每个 App 各写一份 padding。
 *
 * 只负责**版式留白**，不改任何视图的宿主/数据逻辑；手机内置视图不使用它
 * （手机有自己的 `.pw-appbody` 容器）。
 */

import type { ReactNode } from "react";

export function AppPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <section className={`shell app-page${className ? ` ${className}` : ""}`}>{children}</section>;
}
