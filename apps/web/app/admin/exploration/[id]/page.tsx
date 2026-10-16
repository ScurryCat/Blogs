"use client";

/**
 * 管理端问题记录详情 `/admin/exploration/<id>`（T09）。
 *
 * 只读外壳 + 客户端编辑器：真正的权限、CSRF、版本条件与「已解决必须有结果说明」
 * 都在 FastAPI。未登录时明确说明，而不是显示一个假装能用的按钮（01 §3）。
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import "@/features/exploration/exploration.css";
import { RecordWorkspace } from "@/features/exploration/admin/record-workspace";
import { useMementosAdminSession } from "@/features/exploration/admin/session";
import { ADMIN_EXPLORATION_PAGE } from "@/features/exploration/paths";

export default function AdminExplorationDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const recordId = typeof params?.id === "string" ? params.id : "";
  const { session, phase, message, describe, isConflict } = useMementosAdminSession();

  if (phase === "loading") {
    return <p className="pme-hint">正在读取站主会话…</p>;
  }

  if (phase === "unavailable" || !session) {
    return (
      <section className="pme-wrap" role="alert">
        <h1 className="pme-title">无法读取会话</h1>
        <p className="pme-hint">{message ?? "服务暂时不可用。"}</p>
        <p className="pme-hint">
          请先到 <Link href="/admin/login">站主登录</Link> 建立会话。
        </p>
      </section>
    );
  }

  if (!session.authenticated) {
    return (
      <section className="pme-wrap" role="status">
        <h1 className="pme-title">需要站主登录</h1>
        <p className="pme-hint">
          管理接口只接受已登录的站主会话。请到 <Link href="/admin/login">站主登录</Link>。
        </p>
      </section>
    );
  }

  return (
    <div className="pme-wrap">
      <header className="pme-bar">
        <div>
          <p className="pme-kicker">{"// ADMIN · MEMENTO"}</p>
          <h1 className="pme-title">编辑问题记录</h1>
          <p className="pme-lead">
            <Link href={ADMIN_EXPLORATION_PAGE}>← 回到问题记录列表</Link>
          </p>
        </div>
      </header>
      {recordId ? (
        <RecordWorkspace
          csrfToken={session.csrf_token}
          describeError={describe}
          isConflict={isConflict}
          createMode={false}
          recordId={recordId}
        />
      ) : (
        <p className="pme-alert" role="alert">
          地址里缺少记录 ID。
        </p>
      )}
    </div>
  );
}
