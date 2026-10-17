"use client";

/**
 * 管理端相册列表 `/admin/albums`（T06）。
 *
 * 边界（01 §3、05 §7）：
 *  - 这里**不做访问控制**：隐藏入口不是安全边界，读写权限一律由 FastAPI 判断；
 *    未登录时显示明确的失败原因与登录入口，而不是假装没有相册；
 *  - 列表包含草稿（这是管理端点的用途），公开 `/api/v1/gallery/albums` 永远只返回已发布；
 *  - 发布 / 撤回 / 删除都要带 `If-Match`（在 `AlbumWorkspace` 里），冲突时保留输入。
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchAdminAlbums } from "@/features/gallery/api";
import type { AdminAlbum } from "@/features/gallery/types";
import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";

import { AlbumWorkspace } from "@/features/gallery/admin/album-workspace";
import { useShowcaseAdminSession } from "@/features/gallery/admin/session";

export default function AdminAlbumsPage(): ReactNode {
  const { session, phase, message, describe, isConflict } = useShowcaseAdminSession();
  const [albums, setAlbums] = useState<readonly AdminAlbum[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await fetchAdminAlbums({ limit: 30 }, signal);
        setAlbums(page.items);
        setListError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setListError(describe(error));
      }
    },
    [describe],
  );

  useEffect(() => {
    if (phase !== "ready" || !session?.authenticated) return undefined;
    const controller = new AbortController();
    // 先 `await` 再 setState：effect 体里同步 setState 会触发级联渲染
    // （React Compiler 的 `react-hooks/set-state-in-effect`），
    // 而且「正在读取…」这一帧应该真的画出来，而不是被同步更新吃掉。
    void (async () => {
      await Promise.resolve();
      await load(controller.signal);
    })();
    return () => controller.abort();
  }, [load, phase, session]);

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
          管理接口只接受已登录的站主会话。请到 <Link href="/admin/login">站主登录</Link>，
          登录后回到本页。
        </p>
        <p className="pls-state-body">
          说明：本页不做路由保护 —— 真正的权限判断在后端（01 §3）。
        </p>
      </section>
    );
  }

  return (
    <div className="pls-wrap">
      <header className="pls-bar">
        <div>
          <p className="pls-kicker">{"// ADMIN · ALBUMS"}</p>
          <h1 className="pls-title">相册管理</h1>
          <p className="pls-lead">
            以 <strong>{session.user?.username}</strong> 登录 ·
            <Link href="/showcase/photos"> 看公开照片墙</Link>
          </p>
        </div>
        <button
          type="button"
          className="pls-button"
          onClick={() => setCreating((value) => !value)}
          data-new-album=""
        >
          {creating ? "收起新建表单" : "新建相册"}
        </button>
      </header>

      {creating ? (
        <section className="pls-section">
          <h2>新建相册</h2>
          <AlbumWorkspace
            csrfToken={session.csrf_token}
            describeError={describe}
            isConflict={isConflict}
            createMode
          />
        </section>
      ) : null}

      {listError ? (
        <p className="pls-state-body" role="alert">
          {listError}
        </p>
      ) : null}

      {albums.length === 0 && !listError ? (
        <p className="pls-state-body">还没有相册。点上面的「新建相册」开始。</p>
      ) : (
        <table className="pls-table" data-admin-albums="">
          <caption className="pls-card-meta">
            按站主维护的排序展示。公开照片墙只显示已发布的相册。
          </caption>
          <thead>
            <tr>
              <th scope="col">相册</th>
              <th scope="col">类型</th>
              <th scope="col">照片</th>
              <th scope="col">状态</th>
              <th scope="col">排序</th>
              <th scope="col">编辑</th>
            </tr>
          </thead>
          <tbody>
            {albums.map((album) => (
              <tr key={album.id} data-admin-album={album.slug}>
                <td>{album.title}</td>
                <td>{album.kind_label}</td>
                <td>
                  {album.photo_count}
                  {album.photos.some((photo) => photo.media_status !== "ready") ? (
                    <strong> · 有未就绪</strong>
                  ) : null}
                </td>
                <td>{album.status === "published" ? "已发布" : "草稿"}</td>
                <td>{album.position}</td>
                <td>
                  <Link href={`/admin/albums/${album.id}`}>编辑</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
