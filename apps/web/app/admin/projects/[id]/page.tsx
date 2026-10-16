"use client";

/**
 * 管理端作品详情 `/admin/projects/<id>`（T06）。
 *
 * 作品 id 是 UUID：非法 id 由后端统一 404（不给探测信号），这里只显示后端的真实反馈。
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useProjectAdminSession } from "@/features/showcase/admin/session";
import { ProjectWorkspace } from "@/features/showcase/admin/project-workspace";
import { fetchPalaceOptions } from "@/features/showcase/palace-options";
import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";

export default function AdminProjectDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const projectId = typeof params?.id === "string" ? params.id : "";
  const { session, phase, message, describe, isConflict } = useProjectAdminSession();
  const [palaces, setPalaces] = useState<readonly { id: string; slug: string; title: string }[]>([]);

  useEffect(() => {
    if (phase !== "ready" || !session?.authenticated) return undefined;
    const controller = new AbortController();
    void (async () => setPalaces(await fetchPalaceOptions(controller.signal)))();
    return () => controller.abort();
  }, [phase, session]);

  if (phase === "loading") {
    return <p className="pls-card-meta">正在读取站主会话…</p>;
  }

  if (phase === "unavailable" || !session) {
    return (
      <section className="pls-state" role="alert">
        <p className="pls-state-kicker">NO SESSION</p>
        <h1 className="pls-state-title">无法读取会话</h1>
        <p className="pls-state-body">{message ?? "服务暂时不可用。"}</p>
        <p className="pls-state-body">
          请先到 <Link href="/admin/login">站主登录</Link> 建立会话。
        </p>
      </section>
    );
  }

  if (!session.authenticated) {
    return (
      <section className="pls-state" role="status">
        <p className="pls-state-kicker">SIGN IN</p>
        <h1 className="pls-state-title">需要站主登录</h1>
        <p className="pls-state-body">
          请到 <Link href="/admin/login">站主登录</Link> 后回到本页。
        </p>
      </section>
    );
  }

  return (
    <div className="pls-wrap">
      <header className="pls-bar">
        <div>
          <p className="pls-kicker">{"// ADMIN · PROJECT"}</p>
          <h1 className="pls-title">编辑作品</h1>
          <p className="pls-lead">
            <Link href="/admin/projects">← 回到作品列表</Link> ·
            <Link href="/showcase"> 看公开殿堂</Link>
          </p>
        </div>
      </header>
      <ProjectWorkspace
        csrfToken={session.csrf_token}
        describeError={describe}
        isConflict={isConflict}
        createMode={false}
        projectId={projectId}
        palaceOptions={palaces}
      />
    </div>
  );
}
