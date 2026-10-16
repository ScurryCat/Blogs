"use client";

/**
 * 管理端作品列表 `/admin/projects`（T06）。
 *
 * 边界（01 §3、05 §7）：这里**不做访问控制**；未登录时显示明确原因与登录入口。
 * 列表包含草稿（管理端点的用途），公开 `/api/v1/projects` 只返回已发布。
 *
 * 页面同时提供「关联专题」下拉的候选：只列**当前公开**的专题（读 T04 的公开端点，
 * 草稿专题不会出现在这里，避免站主把作品挂到一个访客看不到的专题上还以为能用）。
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchAdminProjects } from "@/features/showcase/api";
import { useProjectAdminSession } from "@/features/showcase/admin/session";
import { ProjectWorkspace } from "@/features/showcase/admin/project-workspace";
import { fetchPalaceOptions } from "@/features/showcase/palace-options";
import type { AdminProject } from "@/features/showcase/types";
import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";

export default function AdminProjectsPage(): ReactNode {
  const { session, phase, message, describe, isConflict } = useProjectAdminSession();
  const [projects, setProjects] = useState<readonly AdminProject[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [palaces, setPalaces] = useState<readonly { id: string; slug: string; title: string }[]>([]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await fetchAdminProjects({ limit: 50 }, signal);
        setProjects(page.items);
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
    // 先 `await` 再 setState（同上）：异步回调里的 setState 不触发级联渲染。
    void (async () => {
      const options = await fetchPalaceOptions(controller.signal);
      setPalaces(options);
    })();
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
          <p className="pls-kicker">{"// ADMIN · PROJECTS"}</p>
          <h1 className="pls-title">作品管理</h1>
          <p className="pls-lead">
            以 <strong>{session.user?.username}</strong> 登录 ·
            <Link href="/showcase"> 看公开殿堂</Link> ·
            <Link href="/admin/albums"> 相册管理</Link>
          </p>
        </div>
        <button
          type="button"
          className="pls-button"
          onClick={() => setCreating((value) => !value)}
          data-new-project=""
        >
          {creating ? "收起新建表单" : "新建作品"}
        </button>
      </header>

      {creating ? (
        <section className="pls-section">
          <h2>新建作品</h2>
          <ProjectWorkspace
            csrfToken={session.csrf_token}
            describeError={describe}
            isConflict={isConflict}
            createMode
            palaceOptions={palaces}
          />
        </section>
      ) : null}

      {listError ? (
        <p className="pls-state-body" role="alert">
          {listError}
        </p>
      ) : null}

      {projects.length === 0 && !listError ? (
        <p className="pls-state-body">还没有作品。点上面的「新建作品」开始。</p>
      ) : (
        <table className="pls-table" data-admin-projects="">
          <caption className="pls-card-meta">
            公开殿堂只显示已发布的作品。撤回关联专题不会连带撤回作品。
          </caption>
          <thead>
            <tr>
              <th scope="col">作品</th>
              <th scope="col">一句话用途</th>
              <th scope="col">状态</th>
              <th scope="col">图片</th>
              <th scope="col">编辑</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} data-admin-project={project.slug}>
                <td>{project.title}</td>
                <td>{project.summary || "（未填写）"}</td>
                <td>{project.status === "published" ? "已发布" : "草稿"}</td>
                <td>
                  {project.images.length}
                  {project.images.some((image) => image.media_status !== "ready") ? (
                    <strong> · 有未就绪</strong>
                  ) : null}
                </td>
                <td>
                  <Link href={`/admin/projects/${project.id}`}>编辑</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
