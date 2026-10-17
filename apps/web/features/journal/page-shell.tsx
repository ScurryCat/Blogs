/**
 * 手记页面的外壳（服务端组件也能用，不导入任何 Hook）。
 *
 * 站点顶部 `.hud` 是 `position: fixed`，而 `app/apps/*` 的独立页历史上直接用了
 * `section.shell`，内容会从头开始、被固定导航压住。这里补上统一的上/下留白，
 * 只在手记的两个独立页使用；不写进 `app/globals.css`（全站样式归 T02 / 集成负责人）。
 */

import type { ReactNode } from "react";

import styles from "./journal.module.css";

export function JournalPageShell({ children }: { children: ReactNode }): ReactNode {
  return <section className={`shell ${styles.page}`}>{children}</section>;
}
