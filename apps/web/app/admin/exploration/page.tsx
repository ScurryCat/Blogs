"use client";

/**
 * 管理端问题记录列表 `/admin/exploration`（T09）。
 *
 * 边界（01 §3、05 §7）：
 *  - 不在这里做访问控制：权限永远由 FastAPI 判断；未登录时明确说明；
 *  - 列表同时显示**发布状态**与**工作状态**两列 —— 这两个是独立的事实，
 *    混成一列会让站主以为「已解决」就等于「读者能看到」（验收 3）；
 *  - 关联数量之后标注「有草稿关联」，因为公开侧看不到那些（公开条件在服务端）。
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import "@/features/exploration/exploration.css";
import { fetchAdminRecords } from "@/features/exploration/api";
import { adminRecordPagePath } from "@/features/exploration/paths";
import { ADMIN_RECORD_PAGE_SIZE, type AdminRecord } from "@/features/exploration/types";
import { RecordWorkspace } from "@/features/exploration/admin/record-workspace";
import { useMementosAdminSession } from "@/features/exploration/admin/session";

export default function AdminExplorationPage(): ReactNode {
  const { session, phase, message, describe, isConflict } = useMementosAdminSession();
  const [records, setRecords] = useState<readonly AdminRecord[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await fetchAdminRecords({ limit: ADMIN_RECORD_PAGE_SIZE }, signal);
        setRecords(page.items);
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
    void (async () => {
      await Promise.resolve();
      await load(controller.signal);
    })();
    return () => controller.abort();
  }, [load, phase, session]);

  if (phase === "loading") {
    return <p className="pme-hint">正在读取站主会话…</p>;
  }

  if (phase === "unavailable" || !session) {
    return (
      <section className="pme-wrap" role="alert">
        <p className="pme-kicker">NO SESSION</p>
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
        <p className="pme-kicker">SIGN IN</p>
        <h1 className="pme-title">需要站主登录</h1>
        <p className="pme-hint">
          管理接口只接受已登录的站主会话。请到 <Link href="/admin/login">站主登录</Link>，
          登录后回到本页。
        </p>
        <p className="pme-hint">说明：本页不做路由保护 —— 真正的权限判断在后端（01 §3）。</p>
      </section>
    );
  }

  return (
    <div className="pme-wrap">
      <header className="pme-bar">
        <div>
          <p className="pme-kicker">{"// ADMIN · MEMENTOS"}</p>
          <h1 className="pme-title">问题记录管理</h1>
          <p className="pme-lead">
            以 <strong>{session.user?.username}</strong> 登录 ·
            <Link href="/apps/metanav/mementos"> 看公开问题记录</Link>
          </p>
        </div>
        <button
          className="pme-button"
          type="button"
          onClick={() => setCreating((value) => !value)}
          data-new-record=""
        >
          {creating ? "收起新建表单" : "新建问题记录"}
        </button>
      </header>

      {creating ? (
        <section className="pme-panel">
          <h2 className="pme-section-title">新建问题记录（总是先建成草稿 + 待探索）</h2>
          <RecordWorkspace
            csrfToken={session.csrf_token}
            describeError={describe}
            isConflict={isConflict}
            createMode
            onSaved={() => {
              setCreating(false);
              void load();
            }}
          />
        </section>
      ) : null}

      {listError ? (
        <p className="pme-alert" role="alert">
          {listError}
        </p>
      ) : null}

      {records.length === 0 && !listError ? (
        <p className="pme-hint">还没有问题记录。点上面的「新建问题记录」开始。</p>
      ) : (
        <table className="pme-table" data-admin-records="">
          <caption className="pme-hint">
            发布状态与工作状态是两件独立的事：把工作状态改成「已解决」不会让读者看到它。
          </caption>
          <thead>
            <tr>
              <th scope="col">标题</th>
              <th scope="col">工作状态</th>
              <th scope="col">发布</th>
              <th scope="col">关联</th>
              <th scope="col">编辑</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} data-admin-record={record.slug}>
                <td>{record.title}</td>
                <td>{record.work_status_label}</td>
                <td>{record.status === "published" ? "已发布" : "草稿"}</td>
                <td>
                  文章 {record.posts.length} · 作品 {record.projects.length}
                  {[...record.posts, ...record.projects].some((item) => item.status !== "published") ? (
                    <strong> · 有草稿关联</strong>
                  ) : null}
                </td>
                <td>
                  <Link href={adminRecordPagePath(record.id)}>编辑</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
