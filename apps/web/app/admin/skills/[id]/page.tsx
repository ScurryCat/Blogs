"use client";

/**
 * 管理端技能详情 `/admin/skills/<id>`（T09）。
 *
 * 只读外壳 + 客户端编辑器：真正的权限、CSRF、版本条件与发布门槛都在 FastAPI。
 * 未登录时明确说明，而不是显示一个假装能用的按钮（01 §3）。
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import "@/features/velvet/velvet.css";
import { SkillWorkspace } from "@/features/velvet/admin/skill-workspace";
import { useVelvetAdminSession } from "@/features/velvet/admin/session";
import { ADMIN_SKILLS_PAGE } from "@/features/velvet/paths";

export default function AdminSkillDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const skillId = typeof params?.id === "string" ? params.id : "";
  const { session, phase, message, describe, isConflict } = useVelvetAdminSession();

  if (phase === "loading") {
    return <p className="plv-hint">正在读取站主会话…</p>;
  }

  if (phase === "unavailable" || !session) {
    return (
      <section className="plv-room" role="alert">
        <h1 className="plv-title">无法读取会话</h1>
        <p className="plv-hint">{message ?? "服务暂时不可用。"}</p>
        <p className="plv-hint">
          请先到 <Link href="/admin/login">站主登录</Link> 建立会话。
        </p>
      </section>
    );
  }

  if (!session.authenticated) {
    return (
      <section className="plv-room" role="status">
        <h1 className="plv-title">需要站主登录</h1>
        <p className="plv-hint">
          管理接口只接受已登录的站主会话。请到 <Link href="/admin/login">站主登录</Link>。
        </p>
      </section>
    );
  }

  return (
    <div className="plv-room">
      <header className="plv-bar">
        <div>
          <p className="plv-kicker">{"// ADMIN · SKILL"}</p>
          <h1 className="plv-title">编辑技能</h1>
          <p className="plv-lead">
            <Link href={ADMIN_SKILLS_PAGE}>← 回到技能列表</Link>
          </p>
        </div>
      </header>
      {skillId ? (
        <SkillWorkspace
          csrfToken={session.csrf_token}
          describeError={describe}
          isConflict={isConflict}
          createMode={false}
          skillId={skillId}
        />
      ) : (
        <p className="plv-alert" role="alert">
          地址里缺少技能 ID。
        </p>
      )}
    </div>
  );
}
