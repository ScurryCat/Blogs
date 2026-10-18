/**
 * 管理端创作台首页 `/admin`（P5 第一批 · 契约 §4.1 / §4.7）。
 *
 * 服务端组件只负责 metadata（`robots: noindex`）与组合客户端视图；
 * 所有站主身份判断、草稿与近期内容读取都在 `WorkspaceHome` 里用无副作用探针完成。
 * 本页不做任何访问控制：隐藏入口不是安全边界，管理接口仍由 FastAPI 验证站主会话。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { WorkspaceHome } from "@/features/workspace/workspace-home";

export const metadata: Metadata = {
  title: "创作台",
  robots: { index: false, follow: false },
};

export default function AdminWorkspacePage(): ReactNode {
  return <WorkspaceHome />;
}
