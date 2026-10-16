"use client";

/**
 * 管理端相册详情 `/admin/albums/<id>`（T06）。
 *
 * 相册 id 是 UUID：非法 id 由后端统一 404（不给探测信号），这里只显示后端的真实反馈。
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";

import { AlbumWorkspace } from "@/features/gallery/admin/album-workspace";
import { useShowcaseAdminSession } from "@/features/gallery/admin/session";

export default function AdminAlbumDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const albumId = typeof params?.id === "string" ? params.id : "";
  const { session, phase, message, describe, isConflict } = useShowcaseAdminSession();

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
          <p className="pls-kicker">{"// ADMIN · ALBUM"}</p>
          <h1 className="pls-title">编辑相册</h1>
          <p className="pls-lead">
            <Link href="/admin/albums">← 回到相册列表</Link> ·
            <Link href="/showcase/photos"> 看公开照片墙</Link>
          </p>
        </div>
      </header>
      <AlbumWorkspace
        csrfToken={session.csrf_token}
        describeError={describe}
        isConflict={isConflict}
        createMode={false}
        albumId={albumId}
      />
    </div>
  );
}
