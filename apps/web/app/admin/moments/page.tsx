"use client";

/**
 * 管理端动态列表 `/admin/moments`（T03）。
 *
 * 边界（01 §3、05 §7）：
 *  - 这里**不做访问控制**：隐藏入口不是安全边界，读写权限一律由 FastAPI 判断；
 *    未登录时页面显示明确的失败原因，而不是假装没有动态；
 *  - 列表包含草稿（这是管理端点的用途），但公开 `/api/v1/moments` 永远不会返回草稿；
 *  - 发布 / 撤回 / 删除都要带 `If-Match`（见 `MomentWorkspace`），冲突时保留输入。
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { MomentWorkspace } from "@/features/ins/admin/moment-workspace";
import { useAdminSession } from "@/features/ins/admin/session";
import "@/features/ins/ins.css";

export default function AdminMomentsPage(): ReactNode {
  const { session, phase, message, describe, isConflict } = useAdminSession();

  if (phase === "loading") {
    return <p className="ins-loading">正在读取站主会话…</p>;
  }

  if (phase === "unavailable" || !session) {
    return (
      <section className="ins-state ins-state-error" role="alert">
        <p className="ins-state-kicker">NO SESSION</p>
        <h1>无法读取会话</h1>
        <p>{message ?? "服务暂时不可用。"}</p>
        <p>
          请先到 <Link href="/admin/login">站主登录</Link> 建立会话。
        </p>
      </section>
    );
  }

  if (!session.authenticated) {
    return (
      <section className="ins-state" role="status">
        <p className="ins-state-kicker">SIGN IN</p>
        <h1>需要站主登录</h1>
        <p>
          管理接口只接受已登录的站主会话。请到 <Link href="/admin/login">站主登录</Link>，
          登录后回到本页。
        </p>
        <p className="ins-admin-hint">
          说明：本页不做路由保护 —— 真正的权限判断在后端（01 §3）。
        </p>
      </section>
    );
  }

  return (
    <div>
      <header className="ins-admin-head">
        <h1>图文动态管理</h1>
        <p>
          以 <strong>{session.user?.username}</strong> 登录 ·
          <Link href="/apps/ins"> 看公开页面</Link>
        </p>
        {/* P5 第一批：新增独立编辑入口；下面的旧工作台继续保留（不删现有能力）。 */}
        <p className="ins-admin-head-entry">
          <Link className="ins-btn" href="/admin/moments/new">
            新建动态（独立编辑页）
          </Link>
        </p>
      </header>
      <MomentWorkspace
        csrfToken={session.csrf_token}
        describeError={describe}
        isConflict={isConflict}
      />
    </div>
  );
}
