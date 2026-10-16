"use client";

/**
 * 作品管理的会话状态：**复用** `features/gallery/admin/session.ts`。
 *
 * 为什么不复制一份：那个 hook 只依赖 T01 的公开接口（`features/auth/api.ts` 与
 * `lib/api/client.ts`），与相册本身无关；复制第二份只会在「412 文案」这类细节上
 * 慢慢漂移。两个管理页面因此共享同一套会话 / CSRF / 错误映射。
 *
 * 边界不变：隐藏入口不是安全边界，权限永远由 FastAPI 判断（01 §3）。
 */

export {
  useShowcaseAdminSession as useProjectAdminSession,
  fieldMessages,
} from "@/features/gallery/admin/session";
export type { AdminSessionState } from "@/features/gallery/admin/session";
